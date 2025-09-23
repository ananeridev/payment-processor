import os from 'os'
import { JobRepository, PaymentRepository, AttemptsRepository, ProviderHealthRepository, OutboxRepository } from '../repositories/index.js'
import { routedPayment } from '../services/routingService.js'
import { nextDelaySec } from '../utils/index.js'
import { getConfig } from '../config.js'

// Função pura para criar ID do worker
const createWorkerId = () => `worker-${os.hostname()}-${process.pid}`

// Função pura para criar payload de pagamento
const createPaymentPayload = (payment) => ({
	amount_cents: payment.amount_cents,
	currency: payment.currency,
	payment_id: payment.id
})

// Função pura para determinar status da tentativa
const determineAttemptStatus = (response) => 
	response.ok ? 'ok' : (response.code === 599 ? 'timeout' : 'error')

// Função pura para determinar se deve finalizar
const shouldFinalize = (payment) => 
	payment.status === 'succeeded' || payment.status === 'failed'

// Função pura para determinar se deve falhar
const shouldFail = (attempts, maxAttempts) => attempts >= maxAttempts

// Função utilitária para sleep
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

class PaymentWorker {
	constructor() {
		this.workerId = createWorkerId()
		this.jobRepo = new JobRepository()
		this.paymentRepo = new PaymentRepository()
		this.attemptsRepo = new AttemptsRepository()
		this.healthRepo = new ProviderHealthRepository()
		this.outboxRepo = new OutboxRepository()
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
			const response = await routedPayment(payload, payment.idempotency_key)

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
