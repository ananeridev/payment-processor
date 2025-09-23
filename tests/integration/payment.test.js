import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert'
import { query } from '../../src/db.js'
import { PaymentRepository, JobRepository, AttemptsRepository } from '../../src/repositories/index.js'
import { PaymentWorker } from '../../src/workers/worker.js'

describe('#Payment Integration Tests', () => {
	let paymentRepo
	let jobRepo
	let attemptsRepo

	before(async () => {
		await query('BEGIN')
		paymentRepo = new PaymentRepository()
		jobRepo = new JobRepository()
		attemptsRepo = new AttemptsRepository()
	})

	after(async () => {
		await query('ROLLBACK')
	})

	beforeEach(async () => {
		await query('DELETE FROM payments WHERE idempotency_key LIKE $1', ['test-%'])
		await query('DELETE FROM jobs WHERE payment_id IN (SELECT id FROM payments WHERE idempotency_key LIKE $1)', ['test-%'])
		await query('DELETE FROM payment_attempts WHERE payment_id IN (SELECT id FROM payments WHERE idempotency_key LIKE $1)', ['test-%'])
	})

	describe('#Payment Lifecycle', () => {
		it('should create payment with idempotency', async () => {
			const idempotencyKey = 'test-payment-1'
			const amount = 1000
			const currency = 'BRL'

			const payment = await paymentRepo.insertOrTouch(amount, currency, idempotencyKey)
			
			assert(payment)
			assert.strictEqual(payment.amount_cents, amount)
			assert.strictEqual(payment.currency, currency)
			assert.strictEqual(payment.status, 'pending')
			assert.strictEqual(payment.idempotency_key, idempotencyKey)
		})

		it('should handle idempotency correctly', async () => {
			const idempotencyKey = 'test-payment-2'
			const amount = 2000
			const currency = 'BRL'

			const payment1 = await paymentRepo.insertOrTouch(amount, currency, idempotencyKey)
			const payment2 = await paymentRepo.insertOrTouch(amount, currency, idempotencyKey)
			
			assert.strictEqual(payment1.id, payment2.id)
			assert(payment2.updated_at > payment1.updated_at)
		})

		it('should process payment status transitions', async () => {
			const idempotencyKey = 'test-payment-3'
			const payment = await paymentRepo.insertOrTouch(1000, 'BRL', idempotencyKey)
			
			await paymentRepo.markProcessing(payment.id)
			let updatedPayment = await paymentRepo.getById(payment.id)
			assert.strictEqual(updatedPayment.status, 'processing')
			
			await paymentRepo.markSucceeded(payment.id, 'PROVIDER_A', 'ext-123')
			updatedPayment = await paymentRepo.getById(payment.id)
			assert.strictEqual(updatedPayment.status, 'succeeded')
			assert.strictEqual(updatedPayment.provider_success, 'PROVIDER_A')
			assert.strictEqual(updatedPayment.external_payment_id, 'ext-123')
		})

		it('should handle payment failure', async () => {
			const idempotencyKey = 'test-payment-4'
			const payment = await paymentRepo.insertOrTouch(1000, 'BRL', idempotencyKey)
			
			await paymentRepo.markFailed(payment.id, 'Provider timeout')
			
			const updatedPayment = await paymentRepo.getById(payment.id)
			assert.strictEqual(updatedPayment.status, 'failed')
			assert.strictEqual(updatedPayment.last_error, 'Provider timeout')
		})
	})

	describe('#Job Processing', () => {
		it('should enqueue and process payment jobs', async () => {
			const payment = await paymentRepo.insertOrTouch(1000, 'BRL', 'test-job-1')
			
			await jobRepo.enqueue(payment.id)
			
			const { rows } = await query(
				'SELECT * FROM jobs WHERE payment_id = $1',
				[payment.id]
			)
			assert.strictEqual(rows.length, 1)
			assert.strictEqual(rows[0].status, 'queued')
		})

		it('should prevent duplicate job creation', async () => {
			const payment = await paymentRepo.insertOrTouch(1000, 'BRL', 'test-job-2')
			
			await jobRepo.enqueue(payment.id)
			await jobRepo.enqueue(payment.id)
			
			const { rows } = await query(
				'SELECT COUNT(*) as count FROM jobs WHERE payment_id = $1',
				[payment.id]
			)
			assert.strictEqual(parseInt(rows[0].count), 1)
		})

		it('should record payment attempts', async () => {
			const payment = await paymentRepo.insertOrTouch(1000, 'BRL', 'test-attempt-1')
			
			await attemptsRepo.record(
				payment.id,
				'PROVIDER_A',
				'ok',
				200,
				150,
				null
			)
			
			const { rows } = await query(
				'SELECT * FROM payment_attempts WHERE payment_id = $1',
				[payment.id]
			)
			assert.strictEqual(rows.length, 1)
			assert.strictEqual(rows[0].provider, 'PROVIDER_A')
			assert.strictEqual(rows[0].status, 'ok')
			assert.strictEqual(rows[0].http_status, 200)
			assert.strictEqual(rows[0].latency_ms, 150)
		})
	})

	describe('#Worker Integration', () => {
		it('should initialize worker with all dependencies', async () => {
			const worker = new PaymentWorker()
			
			assert(worker.workerId)
			assert(worker.jobRepo)
			assert(worker.paymentRepo)
			assert(worker.attemptsRepo)
			assert(worker.healthRepo)
			assert(worker.outboxRepo)
			assert(worker.config)
		})

		it('should handle job processing workflow', async () => {
			const payment = await paymentRepo.insertOrTouch(1000, 'BRL', 'test-worker-1')
			await jobRepo.enqueue(payment.id)
			
			const worker = new PaymentWorker()
			const job = await worker.jobRepo.lockNext(worker.workerId)
			
			assert(job)
			assert.strictEqual(job.payment_id, payment.id)
			assert.strictEqual(job.status, 'processing')
		})
	})

	describe('#Data Integrity', () => {
		it('should handle concurrent payment creation', async () => {
			const idempotencyKey = 'test-concurrent-1'
			const promises = Array.from({ length: 5 }, () => 
				paymentRepo.insertOrTouch(1000, 'BRL', idempotencyKey)
			)

			const results = await Promise.all(promises)
			const uniqueIds = new Set(results.map(p => p.id))
			
			assert.strictEqual(uniqueIds.size, 1)
		})

		it('should maintain referential integrity', async () => {
			const payment = await paymentRepo.insertOrTouch(1000, 'BRL', 'test-integrity-1')
			await jobRepo.enqueue(payment.id)
			await attemptsRepo.record(payment.id, 'PROVIDER_A', 'ok', 200, 100, null)
			
			const { rows: jobRows } = await query(
				'SELECT j.* FROM jobs j JOIN payments p ON j.payment_id = p.id WHERE p.id = $1',
				[payment.id]
			)
			assert.strictEqual(jobRows.length, 1)
			
			const { rows: attemptRows } = await query(
				'SELECT pa.* FROM payment_attempts pa JOIN payments p ON pa.payment_id = p.id WHERE p.id = $1',
				[payment.id]
			)
			assert.strictEqual(attemptRows.length, 1)
		})

		it('should handle non-existent payment gracefully', async () => {
			const payment = await paymentRepo.getById(99999)
			assert.strictEqual(payment, null)
		})
	})
})
