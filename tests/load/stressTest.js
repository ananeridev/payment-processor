import http from 'k6/http'
import { check, sleep } from 'k6'
import { Rate, Counter } from 'k6/metrics'

const errorRate = new Rate('errors')
const timeoutRate = new Rate('timeouts')
const successCounter = new Counter('successful_payments')
const concurrentRequests = new Counter('concurrent_requests')

export const options = {
  stages: [
    { duration: '1m', target: 20 },
    { duration: '2m', target: 50 },
    { duration: '3m', target: 100 },
    { duration: '2m', target: 200 },
    { duration: '1m', target: 300 },
    { duration: '2m', target: 200 },
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<5000'],
    http_req_failed: ['rate<0.2'],
    errors: ['rate<0.15'],
    timeouts: ['rate<0.1'],
  },
}

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000'

function generateStressPayload() {
  return {
    amount_cents: Math.floor(Math.random() * 100000) + 100,
    currency: 'BRL'
  }
}

function generateIdempotencyKey() {
  return `stress-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

export default function () {
  const idempotencyKey = generateIdempotencyKey()
  const payload = generateStressPayload()

  const createResponse = http.post(`${BASE_URL}/payments`, JSON.stringify(payload), {
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    timeout: '3s',
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

    const retrieveResponse = http.get(`${BASE_URL}/payments/${paymentId}`, {
      timeout: '2s'
    })

    const retrieveSuccess = check(retrieveResponse, {
      'payment retrieval succeeds': (r) => r.status === 200,
      'retrieval is fast': (r) => r.timings.duration < 1000,
    })

    errorRate.add(!retrieveSuccess)
  }

  const pauseTime = Math.random() * 1 + 0.1
  sleep(pauseTime)
}

export function setup() {
  console.log('Starting stress test...')
  return { startTime: Date.now() }
}

export function teardown(data) {
  const duration = (Date.now() - data.startTime) / 1000
  console.log(`Stress test completed in ${duration.toFixed(2)} seconds`)
}

export function handleSummary(data) {
  const totalRequests = data.metrics.http_reqs.values.count
  const successfulPayments = data.metrics.successful_payments.values.count
  const errorPercentage = (data.metrics.errors.values.rate * 100).toFixed(2)
  const timeoutPercentage = (data.metrics.timeouts.values.rate * 100).toFixed(2)
  
  return {
    'stress-test-results.json': JSON.stringify(data, null, 2),
    stdout: `
=== STRESS TEST RESULTS ===
Total requests: ${totalRequests}
Successful payments: ${successfulPayments}
Success rate: ${((successfulPayments / totalRequests) * 100).toFixed(2)}%
Error rate: ${errorPercentage}%
Timeout rate: ${timeoutPercentage}%
Average request duration: ${data.metrics.http_req_duration.values.avg.toFixed(2)}ms
P95 request duration: ${data.metrics.http_req_duration.values['p(95)'].toFixed(2)}ms
P99 request duration: ${data.metrics.http_req_duration.values['p(99)'].toFixed(2)}ms
Throughput: ${(totalRequests / (data.metrics.iteration_duration.values.max / 1000)).toFixed(2)} req/s
    `,
  }
}
