import { query } from '../db.js'

async function add(paymentId, type, payload) {
	await query(
		`INSERT INTO outbox_events (payment_id, type, payload) VALUES ($1,$2,$3)`,
		[paymentId, type, payload]
	)
}

export default { add }
