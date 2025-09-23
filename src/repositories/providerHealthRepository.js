import { query } from '../db.js'

async function getAll() {
	const { rows } = await query(`SELECT * FROM provider_health`)
	return rows
}

async function maybeHalfOpen() {
	await query(
		`UPDATE provider_health
		 SET state='half_open'
		 WHERE state='open' AND cooldown_until IS NOT NULL AND now() >= cooldown_until`
	)
}

async function recordSuccess(provider) {
	await query(
		`UPDATE provider_health
		 SET success_count=success_count+1, failure_count=0, state='closed', last_success_at=now(), cooldown_until=NULL
		 WHERE provider=$1`,
		[provider]
	)
}

async function recordFailure(provider) {
	await query(
		`UPDATE provider_health
		 SET failure_count=failure_count+1,
		     last_failure_at=now(),
		     state = CASE WHEN failure_count + 1 >= 3 THEN 'open' ELSE state END,
		     cooldown_until = CASE WHEN failure_count + 1 >= 3 THEN now() + interval '30 seconds' ELSE cooldown_until END
		 WHERE provider=$1`,
		[provider]
	)
}

export default { getAll, maybeHalfOpen, recordSuccess, recordFailure }
