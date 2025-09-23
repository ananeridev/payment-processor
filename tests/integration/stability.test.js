import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'
import { query } from '../../src/db.js'
import { PaymentRepository, JobRepository, AttemptsRepository, ProviderHealthRepository, OutboxRepository } from '../../src/repositories/index.js'

describe('#Payment Processor Stability Tests', () => {
	let paymentRepo
	let jobRepo
	let attemptsRepo
	let healthRepo
	let outboxRepo

	before(async () => {
		await query('BEGIN')
		paymentRepo = new PaymentRepository()
		jobRepo = new JobRepository()
		attemptsRepo = new AttemptsRepository()
		healthRepo = new ProviderHealthRepository()
		outboxRepo = new OutboxRepository()
	})

	after(async () => {
		await query('ROLLBACK')
	})

	describe('#Concurrent Operations', () => {
		it('should handle concurrent payments with same idempotency key', async () => {
			const idempotencyKey = 'concurrent-test-1'
			const amount = 1000
			const currency = 'BRL'

			const promises = Array.from({ length: 10 }, () => 
				paymentRepo.insertOrTouch(amount, currency, idempotencyKey)
			)

			const results = await Promise.all(promises)
			const firstPayment = results[0]
			const allSame = results.every(payment => payment.id === firstPayment.id)
			
			assert(allSame, 'All concurrent requests should return the same payment')
			assert.strictEqual(firstPayment.amount_cents, amount)
			assert.strictEqual(firstPayment.currency, currency)
		})

		it('should handle concurrent payments with different idempotency keys', async () => {
			const promises = Array.from({ length: 50 }, (_, i) => 
				paymentRepo.insertOrTouch(1000 + i, 'BRL', `concurrent-test-${i}`)
			)

			const results = await Promise.all(promises)
			const uniqueIds = new Set(results.map(p => p.id))
			assert.strictEqual(uniqueIds.size, 50, 'All payments should have unique IDs')
		})

		it('should handle concurrent job operations', async () => {
			const payment = await paymentRepo.insertOrTouch(1000, 'BRL', 'concurrent-job-test')
			
			const promises = Array.from({ length: 5 }, () => 
				jobRepo.enqueue(payment.id)
			)

			await Promise.all(promises)
			
			const { rows } = await query(
				'SELECT COUNT(*) as count FROM jobs WHERE payment_id = $1',
				[payment.id]
			)
			assert.strictEqual(parseInt(rows[0].count), 1)
		})
	})

	describe('#Database Consistency', () => {
		it('should maintain consistency during concurrent status updates', async () => {
			const payment = await paymentRepo.insertOrTouch(1000, 'BRL', 'consistency-test')
			
			const updatePromises = [
				paymentRepo.markProcessing(payment.id),
				paymentRepo.markSucceeded(payment.id, 'PROVIDER_A', 'ext-123')
			]

			await Promise.all(updatePromises)
			
			const finalPayment = await paymentRepo.getById(payment.id)
			assert(finalPayment)
			assert.strictEqual(finalPayment.status, 'succeeded')
		})

		it('should handle provider health updates correctly', async () => {
			const provider = 'PROVIDER_A'
			
			await healthRepo.recordSuccess(provider)
			await healthRepo.recordFailure(provider)
			await healthRepo.recordSuccess(provider)
			
			const { rows } = await query(
				'SELECT * FROM provider_health WHERE provider = $1',
				[provider]
			)
			assert.strictEqual(rows.length, 1)
			assert(rows[0].success_count >= 2)
		})

		it('should handle outbox operations correctly', async () => {
			const payment = await paymentRepo.insertOrTouch(1000, 'BRL', 'outbox-test')
			
			await outboxRepo.add(payment.id, 'payment_succeeded', { provider: 'PROVIDER_A' })
			await outboxRepo.add(payment.id, 'payment_failed', { error: 'timeout' })
			
			const { rows } = await query(
				'SELECT * FROM outbox_events WHERE payment_id = $1',
				[payment.id]
			)
			assert.strictEqual(rows.length, 2)
		})
	})

	describe('#Bulk Operations', () => {
		it('should handle large batch of payments', async () => {
			const promises = Array.from({ length: 1000 }, (_, i) => 
				paymentRepo.insertOrTouch(1000 + i, 'BRL', `bulk-test-${i}`)
			)

			const results = await Promise.all(promises)
			assert.strictEqual(results.length, 1000)
			
			const uniqueIds = new Set(results.map(p => p.id))
			assert.strictEqual(uniqueIds.size, 1000)
		})

		it('should handle bulk job creation', async () => {
			const payments = []
			for (let i = 0; i < 100; i++) {
				const payment = await paymentRepo.insertOrTouch(1000 + i, 'BRL', `bulk-job-${i}`)
				payments.push(payment)
			}

			const jobPromises = payments.map(p => jobRepo.enqueue(p.id))
			await Promise.all(jobPromises)
			
			const { rows } = await query('SELECT COUNT(*) as count FROM jobs')
			assert(parseInt(rows[0].count) >= 100)
		})

		it('should handle bulk attempt recording', async () => {
			const payment = await paymentRepo.insertOrTouch(1000, 'BRL', 'bulk-attempt-test')
			
			const attemptPromises = Array.from({ length: 50 }, (_, i) => 
				attemptsRepo.record(payment.id, `PROVIDER_${i % 2}`, 'ok', 200, 100 + i, null)
			)

			await Promise.all(attemptPromises)
			
			const { rows } = await query(
				'SELECT COUNT(*) as count FROM payment_attempts WHERE payment_id = $1',
				[payment.id]
			)
			assert.strictEqual(parseInt(rows[0].count), 50)
		})
	})

	describe('#Resource Management', () => {
		it('should not leak memory during bulk operations', async () => {
			const initialMemory = process.memoryUsage()
			
			const promises = Array.from({ length: 1000 }, (_, i) => 
				paymentRepo.insertOrTouch(1000 + i, 'BRL', `memory-test-${i}`)
			)

			await Promise.all(promises)
			
			if (global.gc) {
				global.gc()
			}
			
			const finalMemory = process.memoryUsage()
			const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed
			
			assert(memoryIncrease < 100 * 1024 * 1024, 'Memory usage should not increase excessively')
		})

		it('should handle large payment amounts', async () => {
			const largeAmount = 999999999
			const payment = await paymentRepo.insertOrTouch(largeAmount, 'BRL', 'large-amount-test')
			
			assert(payment)
			assert.strictEqual(payment.amount_cents, largeAmount)
		})

		it('should handle long idempotency keys', async () => {
			const longKey = 'a'.repeat(255)
			const payment = await paymentRepo.insertOrTouch(1000, 'BRL', longKey)
			
			assert(payment)
			assert.strictEqual(payment.idempotency_key, longKey)
		})
	})

	describe('#Error Handling', () => {
		it('should handle invalid payment data gracefully', async () => {
			try {
				await paymentRepo.insertOrTouch(null, 'BRL', 'invalid-test')
				assert.fail('Should have thrown error')
			} catch (error) {
				assert(error)
			}
		})

		it('should handle non-existent payment operations', async () => {
			const nonExistentId = 99999
			
			await paymentRepo.markProcessing(nonExistentId)
			await paymentRepo.markSucceeded(nonExistentId, 'PROVIDER_A', 'ext-123')
			await paymentRepo.markFailed(nonExistentId, 'error')
			
			const payment = await paymentRepo.getById(nonExistentId)
			assert.strictEqual(payment, null)
		})

		it('should handle database constraint violations', async () => {
			const idempotencyKey = 'constraint-test'
			
			await paymentRepo.insertOrTouch(1000, 'BRL', idempotencyKey)
			
			try {
				await paymentRepo.insertOrTouch(2000, 'USD', idempotencyKey)
				assert.fail('Should have thrown constraint violation')
			} catch (error) {
				assert(error)
			}
		})
	})

	describe('#Transaction Isolation', () => {
		it('should maintain isolation between concurrent transactions', async () => {
			const payment1 = await paymentRepo.insertOrTouch(1000, 'BRL', 'isolation-test-1')
			const payment2 = await paymentRepo.insertOrTouch(2000, 'BRL', 'isolation-test-2')
			
			const promises = [
				paymentRepo.markProcessing(payment1.id),
				paymentRepo.markSucceeded(payment2.id, 'PROVIDER_A', 'ext-123')
			]

			await Promise.all(promises)
			
			const finalPayment1 = await paymentRepo.getById(payment1.id)
			const finalPayment2 = await paymentRepo.getById(payment2.id)
			
			assert.strictEqual(finalPayment1.status, 'processing')
			assert.strictEqual(finalPayment2.status, 'succeeded')
		})
	})
})
