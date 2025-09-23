import http from 'k6/http'
import { check, sleep } from 'k6'
import { Rate, Trend } from 'k6/metrics'

const errorRate = new Rate('errors')
const paymentCreationTime = new Trend('payment_creation_time')
const paymentRetrievalTime = new Trend('payment_retrieval_time')

export const options = {
  stages: [
    { duration: '2m', target: 10 },
    { duration: '5m', target: 10 },
    { duration: '2m', target: 50 },
    { duration: '5m', target: 50 },
    { duration: '2m', target: 100 },
    { duration: '5m', target: 100 },
    { duration: '2m', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000'],
    http_req_failed: ['rate<0.1'],
    errors: ['rate<0.05'],
    payment_creation_time: ['p(95)<1500'],
    payment_retrieval_time: ['p(95)<500'],
  },
}

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000'

function generateIdempotencyKey() {
  return `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

function generatePaymentPayload() {
  const amounts = [1000, 2500, 5000, 10000, 25000]
  const currencies = ['BRL', 'USD', 'EUR']
  
  return {
    amount_cents: amounts[Math.floor(Math.random() * amounts.length)],
    currency: currencies[Math.floor(Math.random() * currencies.length)]
  }
}

export default function () {
  const idempotencyKey = generateIdempotencyKey()
  const payload = generatePaymentPayload()

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
        return body.id === paymentId
      } catch {
        return false
      }
    },
  })

  errorRate.add(!idempotencySuccess)

  sleep(Math.random() * 2 + 0.5)
}

export function handleSummary(data) {
  return {
    'load-test-results.json': JSON.stringify(data, null, 2),
    stdout: `
=== LOAD TEST RESULTS ===
Total duration: ${data.metrics.iteration_duration.values.avg.toFixed(2)}ms
Iterations: ${data.metrics.iterations.values.count}
HTTP error rate: ${(data.metrics.http_req_failed.values.rate * 100).toFixed(2)}%
Custom error rate: ${(data.metrics.errors.values.rate * 100).toFixed(2)}%
Average creation time: ${data.metrics.payment_creation_time.values.avg.toFixed(2)}ms
Average retrieval time: ${data.metrics.payment_retrieval_time.values.avg.toFixed(2)}ms
P95 creation: ${data.metrics.payment_creation_time.values['p(95)'].toFixed(2)}ms
P95 retrieval: ${data.metrics.payment_retrieval_time.values['p(95)'].toFixed(2)}ms
    `,
  }
}
