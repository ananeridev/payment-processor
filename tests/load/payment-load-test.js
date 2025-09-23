import http from 'k6/http'
import { check, sleep } from 'k6'
import { Rate, Trend } from 'k6/metrics'

// Métricas customizadas
const errorRate = new Rate('errors')
const paymentCreationTime = new Trend('payment_creation_time')
const paymentRetrievalTime = new Trend('payment_retrieval_time')

// Configuração do teste
export const options = {
  stages: [
    { duration: '2m', target: 10 }, // Ramp up para 10 usuários
    { duration: '5m', target: 10 }, // Manter 10 usuários
    { duration: '2m', target: 50 }, // Ramp up para 50 usuários
    { duration: '5m', target: 50 }, // Manter 50 usuários
    { duration: '2m', target: 100 }, // Ramp up para 100 usuários
    { duration: '5m', target: 100 }, // Manter 100 usuários
    { duration: '2m', target: 0 }, // Ramp down para 0 usuários
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000'], // 95% das requisições devem ser < 2s
    http_req_failed: ['rate<0.1'], // Taxa de erro < 10%
    errors: ['rate<0.05'], // Taxa de erro customizada < 5%
    payment_creation_time: ['p(95)<1500'], // 95% das criações < 1.5s
    payment_retrieval_time: ['p(95)<500'], // 95% das consultas < 500ms
  },
}

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000'

// Função para gerar chave de idempotência única
function generateIdempotencyKey() {
  return `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

// Função para gerar payload de pagamento
function generatePaymentPayload() {
  const amounts = [1000, 2500, 5000, 10000, 25000] // Valores em centavos
  const currencies = ['BRL', 'USD', 'EUR']
  
  return {
    amount_cents: amounts[Math.floor(Math.random() * amounts.length)],
    currency: currencies[Math.floor(Math.random() * currencies.length)]
  }
}

export default function () {
  const idempotencyKey = generateIdempotencyKey()
  const payload = generatePaymentPayload()

  // Teste 1: Criar pagamento
  const createStartTime = Date.now()
  const createResponse = http.post(`${BASE_URL}/payments`, JSON.stringify(payload), {
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
  })

  const createDuration = Date.now() - createStartTime
  paymentCreationTime.add(createDuration)

  const createSuccess = check(createResponse, {
    'payment creation status is 202': (r) => r.status === 202,
    'payment creation has valid response': (r) => {
      try {
        const body = JSON.parse(r.body)
        return body.id && body.status === 'pending'
      } catch {
        return false
      }
    },
  })

  errorRate.add(!createSuccess)

  if (!createSuccess) {
    console.error(`Payment creation failed: ${createResponse.status} - ${createResponse.body}`)
    return
  }

  const paymentId = JSON.parse(createResponse.body).id

  // Teste 2: Consultar pagamento
  const retrieveStartTime = Date.now()
  const retrieveResponse = http.get(`${BASE_URL}/payments/${paymentId}`)
  const retrieveDuration = Date.now() - retrieveStartTime
  paymentRetrievalTime.add(retrieveDuration)

  const retrieveSuccess = check(retrieveResponse, {
    'payment retrieval status is 200': (r) => r.status === 200,
    'payment retrieval has valid data': (r) => {
      try {
        const body = JSON.parse(r.body)
        return body.id === paymentId && 
               body.amount_cents === payload.amount_cents &&
               body.currency === payload.currency
      } catch {
        return false
      }
    },
  })

  errorRate.add(!retrieveSuccess)

  if (!retrieveSuccess) {
    console.error(`Payment retrieval failed: ${retrieveResponse.status} - ${retrieveResponse.body}`)
  }

  // Teste 3: Testar idempotência (criar pagamento com mesma chave)
  const duplicateResponse = http.post(`${BASE_URL}/payments`, JSON.stringify(payload), {
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
  })

  const idempotencySuccess = check(duplicateResponse, {
    'idempotency works correctly': (r) => {
      try {
        const body = JSON.parse(r.body)
        return body.id === paymentId // Deve retornar o mesmo ID
      } catch {
        return false
      }
    },
  })

  errorRate.add(!idempotencySuccess)

  // Aguardar um pouco antes da próxima iteração
  sleep(Math.random() * 2 + 0.5) // Entre 0.5 e 2.5 segundos
}

export function handleSummary(data) {
  return {
    'load-test-results.json': JSON.stringify(data, null, 2),
    stdout: `
=== RESULTADOS DO TESTE DE CARGA ===
Duração total: ${data.metrics.iteration_duration.values.avg.toFixed(2)}ms
Iterações: ${data.metrics.iterations.values.count}
Taxa de erro HTTP: ${(data.metrics.http_req_failed.values.rate * 100).toFixed(2)}%
Taxa de erro customizada: ${(data.metrics.errors.values.rate * 100).toFixed(2)}%
Tempo médio de criação: ${data.metrics.payment_creation_time.values.avg.toFixed(2)}ms
Tempo médio de consulta: ${data.metrics.payment_retrieval_time.values.avg.toFixed(2)}ms
P95 criação: ${data.metrics.payment_creation_time.values['p(95)'].toFixed(2)}ms
P95 consulta: ${data.metrics.payment_retrieval_time.values['p(95)'].toFixed(2)}ms
    `,
  }
}
