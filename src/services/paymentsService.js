import Payments from '../repositories/paymentRepository.js'
import Jobs from '../repositories/jobRepository.js'

async function createPayment(amountCents, currency, idemKey) {
	const p = await Payments.insertOrTouch(amountCents, currency, idemKey)
	await Jobs.enqueue(p.id)
	return { id: p.id, status: p.status }
}

async function getPayment(id) {
	const p = await Payments.getById(id)
	return p
}

export default { createPayment, getPayment }
