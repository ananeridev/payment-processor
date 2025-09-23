import http from 'k6/http'
import { check, sleep } from 'k6'
import { Rate, Counter } from 'k6/metrics'

// Métricas customizadas
const errorRate = new Rate('errors')
const timeoutRate = new Rate('timeouts')
const successCounter = new Counter('successful_payments')
const concurrentRequests = new Counter('concurrent_requests')

// Configuração do teste de stress
export const options = {
  stages: [
    { duration: '1m', target: 20 }, // Ramp up rápido
    { duration: '2m', target: 50 }, // Aumentar carga
    { duration: '3m', target: 100 }, // Carga alta
    { duration: '2m', target: 200 }, // Carga muito alta
    { duration: '1m', target: 300 }, // Pico de stress
    { duration: '2m', target: 200 }, // Reduzir um pouco
    { duration: '1m', target: 0 }, // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<5000'], // Mais tolerante para stress test
    http_req_failed: ['rate<0.2'], // Até 20% de erro é aceitável em stress
    errors: ['rate<0.15'], // 15% de erro customizado
    timeouts: ['rate<0.1'], // Máximo 10% de timeouts
  },
}

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000'

// Função para gerar payload de stress
function generateStressPayload() {
  return {
    amount_cents: Math.floor(Math.random() * 100000) + 100, // 1 a 1000 reais
    currency: 'BRL'
  }
}

// Função para gerar chave de idempotência
function generateIdempotencyKey() {
  return `stress-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

export default function () {
  const idempotencyKey = generateIdempotencyKey()
  const payload = generateStressPayload()

  // Teste de criação com timeout curto
  const createResponse = http.post(`${BASE_URL}/payments`, JSON.stringify(payload), {
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    timeout: '3s', // Timeout curto para simular stress
  })

  const createSuccess = check(createResponse, {
    'payment creation succeeds': (r) => r.status === 202,
    'response time is reasonable': (r) => r.timings.duration < 3000,
  })

  if (createResponse.status === 0) {
    timeoutRate.add(1)
    errorRate.add(1)
    return
  }

  errorRate.add(!createSuccess)
  
  if (createSuccess) {
    successCounter.add(1)
    const paymentId = JSON.parse(createResponse.body).id

    // Teste de consulta rápida
    const retrieveResponse = http.get(`${BASE_URL}/payments/${paymentId}`, {
      timeout: '2s'
    })

    const retrieveSuccess = check(retrieveResponse, {
      'payment retrieval succeeds': (r) => r.status === 200,
      'retrieval is fast': (r) => r.timings.duration < 1000,
    })

    errorRate.add(!retrieveSuccess)
  }

  // Simular comportamento realista com pausas variáveis
  const pauseTime = Math.random() * 1 + 0.1 // 0.1 a 1.1 segundos
  sleep(pauseTime)
}

// Teste de concorrência extrema
export function setup() {
  console.log('Iniciando teste de stress...')
  return { startTime: Date.now() }
}

export function teardown(data) {
  const duration = (Date.now() - data.startTime) / 1000
  console.log(`Teste de stress concluído em ${duration.toFixed(2)} segundos`)
}

export function handleSummary(data) {
  const totalRequests = data.metrics.http_reqs.values.count
  const successfulPayments = data.metrics.successful_payments.values.count
  const errorPercentage = (data.metrics.errors.values.rate * 100).toFixed(2)
  const timeoutPercentage = (data.metrics.timeouts.values.rate * 100).toFixed(2)
  
  return {
    'stress-test-results.json': JSON.stringify(data, null, 2),
    stdout: `
=== RESULTADOS DO TESTE DE STRESS ===
Total de requisições: ${totalRequests}
Pagamentos bem-sucedidos: ${successfulPayments}
Taxa de sucesso: ${((successfulPayments / totalRequests) * 100).toFixed(2)}%
Taxa de erro: ${errorPercentage}%
Taxa de timeout: ${timeoutPercentage}%
Duração média das requisições: ${data.metrics.http_req_duration.values.avg.toFixed(2)}ms
P95 das requisições: ${data.metrics.http_req_duration.values['p(95)'].toFixed(2)}ms
P99 das requisições: ${data.metrics.http_req_duration.values['p(99)'].toFixed(2)}ms
Throughput: ${(totalRequests / (data.metrics.iteration_duration.values.max / 1000)).toFixed(2)} req/s
    `,
  }
}
