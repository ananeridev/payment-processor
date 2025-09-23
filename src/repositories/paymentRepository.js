import { query } from '../db.js'

async function insertOrTouch(amount, currency, idemKey) {
	const sql = `
		INSERT INTO payments (amount_cents, currency, status, idempotency_key)
		VALUES ($1, COALESCE($2,'BRL'), 'pending', $3)
		ON CONFLICT (idempotency_key) DO UPDATE SET updated_at = now()
		RETURNING *`
	const { rows } = await query(sql, [amount, currency, idemKey])
	return rows[0]
}

async function getById(id) {
	const { rows } = await query(`SELECT * FROM payments WHERE id = $1`, [id])
	return rows[0] || null
}

async function markProcessing(id) {
	await query(`UPDATE payments SET status = 'processing', updated_at = now() WHERE id = $1`, [id])
}

async function markSucceeded(id, provider, externalId) {
	await query(
		`UPDATE payments SET status='succeeded', provider_success=$2, external_payment_id=$3, last_error=NULL, updated_at=now() WHERE id=$1`,
		[id, provider || null, externalId || null]
	)
}

async function markFailed(id, reason) {
	await query(`UPDATE payments SET status='failed', last_error=$2, updated_at=now() WHERE id=$1`, [id, reason || null])
}

export default {
	insertOrTouch,
	getById,
	markProcessing,
	markSucceeded,
	markFailed
}
