import { query } from '../db.js'

async function insertOrTouch(amount, currency, idemKey, client = null) {
	const queryFn = client ? client.query.bind(client) : query
	const sql = `
		INSERT INTO payments (amount_cents, currency, status, idempotency_key)
		VALUES ($1, COALESCE($2,'BRL'), 'pending', $3)
		ON CONFLICT (idempotency_key) DO UPDATE SET updated_at = now()
		RETURNING *`
	const { rows } = await queryFn(sql, [amount, currency, idemKey])
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

async function cleanupTestData(pattern = 'test-%') {
	const { Pool } = await import('pg')
	const { getConfig } = await import('../config.js')
	const cleanupPool = new Pool({ connectionString: getConfig().dbUrl })
	
	try {
		const client = await cleanupPool.connect()
		await client.query('BEGIN')
		
		const { rows: paymentIds } = await client.query('SELECT id FROM payments WHERE idempotency_key LIKE $1', [pattern])
		
		if (paymentIds.length > 0) {
			const ids = paymentIds.map(row => row.id)
			await client.query('DELETE FROM payment_attempts WHERE payment_id = ANY($1)', [ids])
			await client.query('DELETE FROM jobs WHERE payment_id = ANY($1)', [ids])
			await client.query('DELETE FROM payments WHERE id = ANY($1)', [ids])
		}
		
		await client.query('COMMIT')
		client.release()
	} catch (error) {
		try {
			const client = await cleanupPool.connect()
			await client.query('ROLLBACK')
			client.release()
		} catch (rollbackError) {
			// Ignore rollback errors
		}
		throw error
	} finally {
		await cleanupPool.end()
	}
}

export default {
	insertOrTouch,
	getById,
	markProcessing,
	markSucceeded,
	markFailed,
	cleanupTestData
}
