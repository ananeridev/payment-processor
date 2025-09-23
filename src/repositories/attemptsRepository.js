import { query } from '../db.js'

async function record(paymentId, provider, status, httpStatus, latencyMs, errorMessage) {
	await query(
		`INSERT INTO payment_attempts (payment_id, provider, status, http_status, latency_ms, error_message)
		 VALUES ($1,$2,$3,$4,$5,$6)`,
		[paymentId, provider, status, httpStatus || null, latencyMs || null, errorMessage || null]
	)
}

export default { record }
