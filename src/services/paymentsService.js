import Payments from '../repositories/paymentRepository.js'
import Jobs from '../repositories/jobRepository.js'

async function createPayment(amountCents, currency, idemKey) {
	const payment = await Payments.insertOrTouch(amountCents, currency, idemKey)
	await Jobs.enqueue(payment.id)
	return { id: payment.id, status: payment.status }
}

async function getPayment(id) {
	return await Payments.getById(id)
}

export default { createPayment, getPayment }
