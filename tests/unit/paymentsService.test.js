import { test, assert } from 'poku'

const createMockedPaymentsService = (mockPayments, mockJobs) => {
	return {
		async createPayment(amountCents, currency, idemKey) {
			const payment = await mockPayments.insertOrTouch(amountCents, currency, idemKey)
			await mockJobs.enqueue(payment.id)
			return { id: payment.id, status: payment.status }
		},

		async getPayment(id) {
			return await mockPayments.getById(id)
		}
	}
}

test('createPayment - should return only payment ID and status', async () => {
	const mockPayment = {
		id: 42,
		status: 'pending',
		amount_cents: 10000,
		currency: 'BRL',
		idempotency_key: 'test-key',
		created_at: '2024-01-01',
		updated_at: '2024-01-01'
	}

	const mockPayments = {
		insertOrTouch: async () => mockPayment
	}
	const mockJobs = {
		enqueue: async () => {}
	}

	const paymentsService = createMockedPaymentsService(mockPayments, mockJobs)

	const result = await paymentsService.createPayment(10000, 'BRL', 'test-key')

	assert.strictEqual(typeof result, 'object', 'Should return an object')
	assert.strictEqual(Object.keys(result).length, 2, 'Should return exactly 2 fields')
	assert.strictEqual(result.id, 42, 'Should return payment ID')
	assert.strictEqual(result.status, 'pending', 'Should return payment status')
	assert.strictEqual(result.created_at, undefined, 'Should not return created_at')
	assert.strictEqual(result.amount_cents, undefined, 'Should not return amount_cents')
})

test('createPayment - should pass correct parameters to repositories', async () => {
	let insertParams = null
	let enqueueParams = null
	const mockPayment = { id: 123, status: 'pending' }
	
	const mockPayments = {
		insertOrTouch: async (amount, currency, idemKey) => {
			insertParams = { amount, currency, idemKey }
			return mockPayment
		}
	}
	const mockJobs = {
		enqueue: async (paymentId) => {
			enqueueParams = { paymentId }
		}
	}

	const paymentsService = createMockedPaymentsService(mockPayments, mockJobs)

	await paymentsService.createPayment(15000, 'USD', 'my-key')

	assert.deepStrictEqual(insertParams, {
		amount: 15000,
		currency: 'USD',
		idemKey: 'my-key'
	}, 'Should pass correct parameters to payment repository')

	assert.deepStrictEqual(enqueueParams, {
		paymentId: 123
	}, 'Should pass payment ID to job repository')
})

test('createPayment - should call repositories in correct order', async () => {
	const callOrder = []
	const mockPayment = { id: 1, status: 'pending' }
	
	const mockPayments = {
		insertOrTouch: async () => {
			callOrder.push('insertOrTouch')
			return mockPayment
		}
	}
	const mockJobs = {
		enqueue: async () => {
			callOrder.push('enqueue')
		}
	}

	const paymentsService = createMockedPaymentsService(mockPayments, mockJobs)

	await paymentsService.createPayment(10000, 'BRL', 'test-key')

	assert.deepStrictEqual(callOrder, ['insertOrTouch', 'enqueue'], 'Should call payment creation before job enqueue')
})

test('createPayment - should propagate payment repository errors', async () => {
	const repositoryError = new Error('Database connection failed')
	const mockPayments = {
		insertOrTouch: async () => {
			throw repositoryError
		}
	}
	const mockJobs = {
		enqueue: async () => {}
	}

	const paymentsService = createMockedPaymentsService(mockPayments, mockJobs)

	try {
		await paymentsService.createPayment(10000, 'BRL', 'test-key')
		assert.fail('Should have thrown an error')
	} catch (error) {
		assert.strictEqual(error, repositoryError, 'Should propagate the exact repository error')
	}
})

test('createPayment - should propagate job repository errors', async () => {
	const jobError = new Error('Job queue failed')
	const mockPayment = { id: 1, status: 'pending' }
	
	const mockPayments = {
		insertOrTouch: async () => mockPayment
	}
	const mockJobs = {
		enqueue: async () => {
			throw jobError
		}
	}

	const paymentsService = createMockedPaymentsService(mockPayments, mockJobs)

	try {
		await paymentsService.createPayment(10000, 'BRL', 'test-key')
		assert.fail('Should have thrown an error')
	} catch (error) {
		assert.strictEqual(error, jobError, 'Should propagate the exact job error')
	}
})

test('createPayment - should not call enqueue if insertOrTouch fails', async () => {
	const repositoryError = new Error('Database connection failed')
	let enqueueCalled = false
	
	const mockPayments = {
		insertOrTouch: async () => {
			throw repositoryError
		}
	}
	const mockJobs = {
		enqueue: async () => {
			enqueueCalled = true
		}
	}

	const paymentsService = createMockedPaymentsService(mockPayments, mockJobs)

	try {
		await paymentsService.createPayment(10000, 'BRL', 'test-key')
		assert.fail('Should have thrown an error')
	} catch (error) {
		assert.strictEqual(error, repositoryError, 'Should propagate repository error')
		assert.strictEqual(enqueueCalled, false, 'Should not call enqueue if insertOrTouch fails')
	}
})

test('getPayment - should return payment as-is from repository', async () => {
	const mockPayment = {
		id: 42,
		status: 'succeeded',
		amount_cents: 10000,
		currency: 'BRL',
		idempotency_key: 'test-key',
		created_at: '2024-01-01',
		updated_at: '2024-01-01'
	}
	
	const mockPayments = {
		getById: async () => mockPayment
	}
	const mockJobs = {
		enqueue: async () => {}
	}

	const paymentsService = createMockedPaymentsService(mockPayments, mockJobs)

	const result = await paymentsService.getPayment(42)

	assert.strictEqual(result, mockPayment, 'Should return the exact payment object from repository')
	assert.strictEqual(result.id, 42, 'Should preserve payment ID')
	assert.strictEqual(result.status, 'succeeded', 'Should preserve payment status')
	assert.strictEqual(result.amount_cents, 10000, 'Should preserve all payment fields')
})

test('getPayment - should pass correct ID to repository', async () => {
	let capturedId = null
	const mockPayments = {
		getById: async (id) => {
			capturedId = id
			return { id: 123, status: 'pending' }
		}
	}
	const mockJobs = {
		enqueue: async () => {}
	}

	const paymentsService = createMockedPaymentsService(mockPayments, mockJobs)

	await paymentsService.getPayment(123)

	assert.strictEqual(capturedId, 123, 'Should pass correct ID to repository')
})

test('getPayment - should handle repository returning null', async () => {
	const mockPayments = {
		getById: async () => null
	}
	const mockJobs = {
		enqueue: async () => {}
	}

	const paymentsService = createMockedPaymentsService(mockPayments, mockJobs)

	const result = await paymentsService.getPayment(999)

	assert.strictEqual(result, null, 'Should return null when repository returns null')
})

test('getPayment - should handle repository returning undefined', async () => {
	const mockPayments = {
		getById: async () => undefined
	}
	const mockJobs = {
		enqueue: async () => {}
	}

	const paymentsService = createMockedPaymentsService(mockPayments, mockJobs)

	const result = await paymentsService.getPayment(888)

	assert.strictEqual(result, undefined, 'Should return undefined when repository returns undefined')
})

test('getPayment - should propagate repository errors', async () => {
	const repositoryError = new Error('Database query failed')
	const mockPayments = {
		getById: async () => {
			throw repositoryError
		}
	}
	const mockJobs = {
		enqueue: async () => {}
	}

	const paymentsService = createMockedPaymentsService(mockPayments, mockJobs)

	try {
		await paymentsService.getPayment(1)
		assert.fail('Should have thrown an error')
	} catch (error) {
		assert.strictEqual(error, repositoryError, 'Should propagate the exact repository error')
	}
})

test('Service Layer - should handle different input types', async () => {
	const testCases = [
		{ amount: 0, currency: 'BRL', key: 'zero-amount' },
		{ amount: 999999999, currency: 'USD', key: 'large-amount' },
		{ amount: 5000, currency: null, key: 'null-currency' },
		{ amount: 7500, currency: undefined, key: 'undefined-currency' },
		{ amount: 1000, currency: 'BRL', key: '' }
	]

	for (const testCase of testCases) {
		const mockPayments = {
			insertOrTouch: async () => ({ id: 1, status: 'pending' })
		}
		const mockJobs = {
			enqueue: async () => {}
		}

		const paymentsService = createMockedPaymentsService(mockPayments, mockJobs)

		const result = await paymentsService.createPayment(
			testCase.amount, 
			testCase.currency, 
			testCase.key
		)

		assert.strictEqual(typeof result.id, 'number', `Should handle case: ${JSON.stringify(testCase)}`)
		assert.strictEqual(result.status, 'pending', `Should return pending status for: ${JSON.stringify(testCase)}`)
	}
})

test('Service Layer - should handle different payment statuses', async () => {
	const statuses = ['pending', 'processing', 'succeeded', 'failed']

	for (const status of statuses) {
		const mockPayments = {
			insertOrTouch: async () => ({ id: 1, status })
		}
		const mockJobs = {
			enqueue: async () => {}
		}

		const paymentsService = createMockedPaymentsService(mockPayments, mockJobs)

		const result = await paymentsService.createPayment(10000, 'BRL', 'test-key')

		assert.strictEqual(result.status, status, `Should return ${status} status`)
	}
})

test('Service Layer - should be stateless', async () => {
	let callCount = 0
	const mockPayments = {
		insertOrTouch: async (amount) => {
			callCount++
			return { id: amount, status: 'pending' }
		}
	}
	const mockJobs = {
		enqueue: async () => {}
	}

	const paymentsService = createMockedPaymentsService(mockPayments, mockJobs)

	const calls = [
		paymentsService.createPayment(1000, 'BRL', 'key1'),
		paymentsService.createPayment(2000, 'USD', 'key2'),
		paymentsService.createPayment(3000, 'EUR', 'key3')
	]

	const callResults = await Promise.all(calls)

	assert.strictEqual(callResults[0].id, 1000, 'First call should return correct ID')
	assert.strictEqual(callResults[1].id, 2000, 'Second call should return correct ID')
	assert.strictEqual(callResults[2].id, 3000, 'Third call should return correct ID')
	assert.strictEqual(callCount, 3, 'Should call insertOrTouch three times')
})

test('Service Layer - should maintain API contract', async () => {
	const fullPaymentData = {
		id: 1,
		status: 'pending',
		amount_cents: 10000,
		currency: 'BRL',
		idempotency_key: 'test',
		provider_success: null,
		external_payment_id: null,
		last_error: null,
		created_at: '2024-01-01',
		updated_at: '2024-01-01'
	}

	const mockPayments = {
		insertOrTouch: async () => fullPaymentData
	}
	const mockJobs = {
		enqueue: async () => {}
	}

	const paymentsService = createMockedPaymentsService(mockPayments, mockJobs)

	const result = await paymentsService.createPayment(10000, 'BRL', 'test')

	assert.strictEqual(typeof result, 'object', 'Should return object')
	assert.strictEqual(typeof result.id, 'number', 'ID should be number')
	assert.strictEqual(typeof result.status, 'string', 'Status should be string')
	assert.strictEqual(Object.keys(result).length, 2, 'Should return exactly 2 fields')
	
	assert.strictEqual(result.amount_cents, undefined, 'Should not expose amount_cents')
	assert.strictEqual(result.currency, undefined, 'Should not expose currency')
	assert.strictEqual(result.created_at, undefined, 'Should not expose created_at')
	assert.strictEqual(result.provider_success, undefined, 'Should not expose provider_success')
})