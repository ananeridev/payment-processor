import Payments from '../repositories/paymentRepository.js'
import Jobs from '../repositories/jobRepository.js'
import { pool } from '../db.js'

async function createPayment(amountCents, currency, idemKey) {
	const client = await pool.connect()
	try {
		await client.query('BEGIN')
		
		const payment = await Payments.insertOrTouch(amountCents, currency, idemKey, client)
		await Jobs.enqueue(payment.id, client)
		
		await client.query('COMMIT')
		return { id: payment.id, status: payment.status }
	} catch (error) {
		await client.query('ROLLBACK')
		throw error
	} finally {
		client.release()
	}
}

async function getPayment(id) {
	return await Payments.getById(id)
}

export default { createPayment, getPayment }
