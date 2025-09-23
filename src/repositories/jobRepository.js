import { query } from '../db.js'

async function enqueue(paymentId) {
	const sql = `
		INSERT INTO jobs (payment_id, run_at, status)
		SELECT $1, now(), 'queued'
		WHERE NOT EXISTS (
		  SELECT 1 FROM jobs WHERE payment_id = $1 AND status IN ('queued','processing')
		)`
	await query(sql, [paymentId])
}

async function lockNext(workerId) {
	const sql = `
		WITH next AS (
			SELECT id FROM jobs
			WHERE status='queued' AND run_at <= now()
			ORDER BY run_at
			FOR UPDATE SKIP LOCKED
			LIMIT 1
		)
		UPDATE jobs j
		SET status='processing', locked_at=now(), locked_by=$1
		FROM next n
		WHERE j.id = n.id
		RETURNING j.*`
	const { rows } = await query(sql, [workerId])
	return rows[0] || null
}

async function finalize(jobId, status) {
	await query(`UPDATE jobs SET status=$2 WHERE id=$1`, [jobId, status])
}

async function retry(jobId, attempts, delaySec) {
	await query(
		`UPDATE jobs SET attempts=$2, status='queued', run_at=now() + ($3 || ' seconds')::interval WHERE id=$1`,
		[jobId, attempts, String(delaySec)]
	)
}

export default { enqueue, lockNext, finalize, retry }
