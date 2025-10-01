import os from 'os'
import Jobs from '../repositories/jobRepository.js'
import Payments from '../repositories/paymentRepository.js'
import Attempts from '../repositories/attemptsRepository.js'
import Outbox from '../repositories/outbocRepository.js'
import HealthRepo from '../repositories/providerHealthRepository.js'
import { getConfig } from '../config.js'
import { callProvider } from '../providers/providerClient.js'
import routingServiceFactory from '../services/routingService.js'

/**
 * Create a worker id
 * @returns {string}
 */
const createWorkerId = () => `worker-${os.hostname()}-${process.pid}`

/**
 * Create a payment payload
 * @param {Object} payment
 * @returns {Object}
 */
const createPaymentPayload = (payment) => ({
	amount_cents: payment.amount_cents,
	currency: payment.currency,
	payment_id: payment.id
})

const determineAttemptStatus = (response) => 
	response.ok ? 'ok' : (response.code === 599 ? 'timeout' : 'error')

const shouldFinalize = (payment) => 
	payment.status === 'succeeded' || payment.status === 'failed'

const shouldFail = (attempts, maxAttempts) => attempts >= maxAttempts

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))
const routingService = routingServiceFactory({ getConfig, callProvider, HealthRepo, sleep })

class PaymentWorker {
	constructor() {
		this.workerId = createWorkerId()
		this.jobRepo = Jobs
		this.paymentRepo = Payments
		this.attemptsRepo = Attempts
		this.healthRepo = HealthRepo
		this.outboxRepo = Outbox
		this.config = getConfig()
	}

	async processJob(job) {
		try {
			const payment = await this.paymentRepo.getById(job.payment_id)
			
			if (!payment) {
				await this.jobRepo.finalize(job.id, 'dead')
				return
			}

			if (shouldFinalize(payment)) {
				await this.jobRepo.finalize(job.id, 'done')
				return
			}

			await this.paymentRepo.markProcessing(payment.id)

			const payload = createPaymentPayload(payment)
			const response = await routingService.routedPayment(payload, payment.idempotency_key)

			const attemptStatus = determineAttemptStatus(response)
			await this.attemptsRepo.record(
				payment.id,
				response.label || 'UNKNOWN',
				attemptStatus,
				response.code,
				response.latency,
				response.body?.error
			)

			if (response.ok) {
				await this.handleSuccess(payment, response, job)
			} else {
				await this.handleFailure(payment, response, job)
			}
		} catch (error) {
			console.error('Worker error:', error)
			await this.jobRepo.finalize(job.id, 'dead')
		}
	}

	async handleSuccess(payment, response, job) {
		const provider = (response.label || '').toUpperCase()
		await this.healthRepo.recordSuccess(provider)
		await this.paymentRepo.markSucceeded(payment.id, provider, response.body?.external_id)
		await this.outboxRepo.add(payment.id, 'payment_succeeded', {
			provider: response.label,
			external_id: response.body?.external_id
		})
		await this.jobRepo.finalize(job.id, 'done')
	}

	async handleFailure(payment, response, job) {
		const provider = (response.label || '').toUpperCase()
		await this.healthRepo.recordFailure(provider)

		const attempts = job.attempts + 1
		if (shouldFail(attempts, this.config.maxAttempts)) {
			await this.paymentRepo.markFailed(payment.id, response.body?.error || 'max_retries')
			await this.outboxRepo.add(payment.id, 'payment_failed', {
				error: response.body?.error || 'max_retries'
			})
			await this.jobRepo.finalize(job.id, 'dead')
		} else {
			const delaySec = nextDelaySec(attempts)
			await this.jobRepo.retry(job.id, attempts, delaySec)
		}
	}

	async run() {
		console.log(`Worker ${this.workerId} started`)
		
		while (true) {
			const job = await this.jobRepo.lockNext(this.workerId)
			
			if (!job) {
				await sleep(300)
				continue
			}

			await this.processJob(job)
		}
	}

}

export { PaymentWorker }
export default PaymentWorker

const worker = new PaymentWorker()
worker.run().catch(console.error)
