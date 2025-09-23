import http from 'k6/http'
import { check, sleep } from 'k6'
import { Rate, Counter, Trend } from 'k6/metrics'

const idempotencyViolations = new Counter('idempotency_violations')
const duplicatePayments = new Counter('duplicate_payments')
const concurrencyErrors = new Rate('concurrency_errors')
const responseTimeVariation = new Trend('response_time_variation')

export const options = {
  scenarios: {
    idempotency_test: {
      executor: 'constant-vus',
      vus: 10,
      duration: '2m',
      exec: 'testIdempotency',
    },
    concurrent_creation: {
      executor: 'constant-vus',
      vus: 50,
      duration: '2m',
      exec: 'testConcurrentCreation',
    },
    concurrent_retrieval: {
      executor: 'constant-vus',
      vus: 30,
      duration: '2m',
      exec: 'testConcurrentRetrieval',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<2000'],
    http_req_failed: ['rate<0.05'],
    idempotency_violations: ['count==0'],
    concurrency_errors: ['rate<0.02'],
  },
}

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000'

let sharedPaymentId = null
let sharedIdempotencyKey = null

export function setup() {
  const payload = { amount_cents: 1000, currency: 'BRL' }
  const idempotencyKey = `setup-${Date.now()}`
  
  const response = http.post(`${BASE_URL}/payments`, JSON.stringify(payload), {
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
  })
  
  if (response.status === 202) {
    const payment = JSON.parse(response.body)
    sharedPaymentId = payment.id
    sharedIdempotencyKey = idempotencyKey
  }
  
  return { sharedPaymentId, sharedIdempotencyKey }
}

export function testIdempotency() {
  const payload = { amount_cents: 2000, currency: 'BRL' }
  const idempotencyKey = `idempotency-test-${Date.now()}`
  
  const responses = []
  for (let i = 0; i < 5; i++) {
    const response = http.post(`${BASE_URL}/payments`, JSON.stringify(payload), {
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
    })
    responses.push(response)
  }
  
  const paymentIds = responses
    .filter(r => r.status === 202)
    .map(r => JSON.parse(r.body).id)
  
  const uniqueIds = new Set(paymentIds)
  
  const idempotencyCheck = check(responses[0], {
    'all responses have same payment ID': () => uniqueIds.size === 1,
    'all responses are successful': () => responses.every(r => r.status === 202),
  })
  
  if (uniqueIds.size > 1) {
    idempotencyViolations.add(1)
    duplicatePayments.add(uniqueIds.size - 1)
  }
  
  concurrencyErrors.add(!idempotencyCheck)
  
  sleep(0.1)
}

export function testConcurrentCreation() {
  const payload = {
    amount_cents: Math.floor(Math.random() * 10000) + 100,
    currency: 'BRL'
  }
  const idempotencyKey = `concurrent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  
  const startTime = Date.now()
  const response = http.post(`${BASE_URL}/payments`, JSON.stringify(payload), {
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
  })
  const duration = Date.now() - startTime
  
  responseTimeVariation.add(duration)
  
  const success = check(response, {
    'payment creation succeeds': (r) => r.status === 202,
    'response time is consistent': (r) => r.timings.duration < 2000,
    'response has valid data': (r) => {
      try {
        const body = JSON.parse(r.body)
        return body.id && body.status === 'pending'
      } catch {
        return false
      }
    },
  })
  
  concurrencyErrors.add(!success)
  
  sleep(Math.random() * 0.5 + 0.1)
}

export function testConcurrentRetrieval(data) {
  if (!data.sharedPaymentId) {
    console.error('No shared payment ID available for retrieval test')
    return
  }
  
  const startTime = Date.now()
  const response = http.get(`${BASE_URL}/payments/${data.sharedPaymentId}`)
  const duration = Date.now() - startTime
  
  responseTimeVariation.add(duration)
  
  const success = check(response, {
    'payment retrieval succeeds': (r) => r.status === 200,
    'retrieval is fast': (r) => r.timings.duration < 1000,
    'retrieved data is consistent': (r) => {
      try {
        const body = JSON.parse(r.body)
        return body.id === data.sharedPaymentId
      } catch {
        return false
      }
    },
  })
  
  concurrencyErrors.add(!success)
  
  sleep(Math.random() * 0.3 + 0.05)
}

export function handleSummary(data) {
  const totalRequests = data.metrics.http_reqs.values.count
  const violations = data.metrics.idempotency_violations.values.count
  const duplicates = data.metrics.duplicate_payments.values.count
  const concurrencyErrorRate = (data.metrics.concurrency_errors.values.rate * 100).toFixed(2)
  
  return {
    'concurrency-test-results.json': JSON.stringify(data, null, 2),
    stdout: `
=== CONCURRENCY TEST RESULTS ===
Total requests: ${totalRequests}
Idempotency violations: ${violations}
Duplicate payments: ${duplicates}
Concurrency error rate: ${concurrencyErrorRate}%
Average response time: ${data.metrics.http_req_duration.values.avg.toFixed(2)}ms
P95 response time: ${data.metrics.http_req_duration.values['p(95)'].toFixed(2)}ms
Response time variation: ${data.metrics.response_time_variation.values.avg.toFixed(2)}ms
Throughput: ${(totalRequests / (data.metrics.iteration_duration.values.max / 1000)).toFixed(2)} req/s

=== CONCURRENCY ANALYSIS ===
${violations === 0 ? '✅ Idempotency maintained correctly' : '❌ Idempotency violations detected'}
${duplicates === 0 ? '✅ No duplicate payments' : '❌ Duplicate payments detected'}
${concurrencyErrorRate < 2 ? '✅ Low concurrency error rate' : '❌ High concurrency error rate'}
    `,
  }
}
