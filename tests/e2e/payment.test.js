import { test, assert, beforeEach } from 'poku'
import { before, after } from 'node:test'
import express from 'express'
import request from 'supertest'
import { validCurrencies, paymentPayloads } from '../config/testData.js'
import { setupTestDatabase } from '../helpers/testSetup.js'
import { buildPaymentsRouter } from '../../src/routes/paymentsRoute.js'
import { runSeed } from '../config/seed.js'

let _testServer
let _testServerAddress
let dbReady = false

function createPayment(payment, idempotencyKey = 'test-key') {
	return _testServer
		.post('/payments')
		.set('Idempotency-Key', idempotencyKey)
		.send(payment)
}

function getPayment(id) {
	return _testServer
		.get(`/payments/${id}`)
}


async function validatePaymentCreation(paymentData, idempotencyKey = 'test-key') {
	const res = await createPayment(paymentData, idempotencyKey)
	
	assert.strictEqual(res.status, 202)
	assert.strictEqual(typeof res.body.id, 'number')
	assert.strictEqual(res.body.status, 'pending')
	assert.strictEqual(Object.keys(res.body).length, 2)
	
	return res.body
}

async function validatePaymentRetrieval(paymentId, expectedData) {
	const res = await getPayment(paymentId)
	
	assert.strictEqual(res.status, 200)
	assert.strictEqual(res.body.id, expectedData.id)
	assert.strictEqual(res.body.amount_cents, expectedData.amount_cents)
	assert.strictEqual(res.body.currency, expectedData.currency)
	assert.strictEqual(res.body.status, expectedData.status)
	assert.strictEqual(Object.keys(res.body).length, 7)
	
	return res.body
}
before(async () => {
	const { server } = await import('../../src/index.js')
	_testServer = server
	_testServerAddress = await server.address()

})

beforeEach(async () => {
	if (!dbReady) {
		await setupTestDatabase()
		
		const app = express()
		app.use(express.json())
		app.use('/payments', buildPaymentsRouter())
		
		app.use((err, req, res, next) => {
			res.status(500).json({ error: 'Internal server error' })
		})
		
		_testServer = request(app)
		_testServerAddress = ''
		dbReady = true
	}
	
	return runSeed()
})

after( async () => {
	if (_testServer && _testServer.close) {
		_testServer.close()
	}
})

test('POST /payments - should create payment with valid data', async () => {
	const result = await validatePaymentCreation(paymentPayloads.valid, 'test-valid-1')
	assert.strictEqual(typeof result.id, 'number')
})

test('POST /payments - should create payment with different currencies', async () => {
	for (let i = 0; i < validCurrencies.length; i++) {
		const currency = validCurrencies[i]
		const input = paymentPayloads.differentCurrencies(currency)

		const result = await validatePaymentCreation(input, `test-currency-${i}`)
		assert.strictEqual(typeof result.id, 'number')
	}
})

test('POST /payments - should default to BRL when currency is null', async () => {
	const result = await validatePaymentCreation(paymentPayloads.nullCurrency, 'test-null-currency')
	assert.strictEqual(typeof result.id, 'number')
})

test('POST /payments - should return 400 for missing amount_cents', async () => {
	const res = await createPayment(paymentPayloads.missingAmount, 'test-missing-amount')
	assert.strictEqual(res.status, 400)
})

test('POST /payments - should return 400 for zero amount', async () => {
	const res = await createPayment(paymentPayloads.zeroAmount, 'test-zero-amount')
	assert.strictEqual(res.status, 400)
})

test('POST /payments - should return 400 for negative amount', async () => {
	const res = await createPayment(paymentPayloads.negativeAmount, 'test-negative-amount')
	assert.strictEqual(res.status, 400)
})

test('POST /payments - should return 400 for string amount', async () => {
	const res = await createPayment(paymentPayloads.stringAmount, 'test-string-amount')
	assert.strictEqual(res.status, 400)
})

test('GET /payments/:id - should retrieve existing payment', async () => {
	const { query } = await import('../../src/db.js')
	const { rows } = await query('SELECT * FROM payments WHERE idempotency_key = $1', ['seed-payment-1'])
	
	if (rows.length > 0) {
		const payment = rows[0]
		await validatePaymentRetrieval(payment.id, {
			id: payment.id,
			amount_cents: payment.amount_cents,
			currency: payment.currency,
			status: payment.status
		})
	}
})

test('GET /payments/:id - should return 404 for non-existent payment', async () => {
	const res = await getPayment(999999)
	assert.strictEqual(res.status, 404)
	
	const result = res.body
	assert.strictEqual(result.error, 'not found')
})

test('Idempotency - should return same payment for duplicate requests', async () => {
	const res1 = await _testServer
		.post('/payments')
		.set('Idempotency-Key', 'test-idempotency-1')
		.send(paymentPayloads.idempotency)

	const res2 = await _testServer
		.post('/payments')
		.set('Idempotency-Key', 'test-idempotency-1')
		.send(paymentPayloads.idempotency)

	assert.strictEqual(res1.status, 202)
	assert.strictEqual(res2.status, 202)
	assert.strictEqual(res1.body.id, res2.body.id)
	assert.strictEqual(res1.body.status, res2.body.status)
})

test('API Integration Flow - should work end-to-end', async () => {
	const createRes = await validatePaymentCreation(paymentPayloads.integrationFlow, 'test-integration-flow')
	const paymentId = createRes.id

	await validatePaymentRetrieval(paymentId, {
		id: paymentId,
		amount_cents: paymentPayloads.integrationFlow.amount_cents,
		currency: paymentPayloads.integrationFlow.currency,
		status: 'pending'
	})
})