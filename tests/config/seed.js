import { query } from '../../src/db.js'
import { paymentPayloads } from './testData.js'

const isTestEnv = process.env.NODE_ENV === 'test'

const log = (...args) => {
	if (!isTestEnv) {
		console.log(...args)
	}
}

export async function runSeed() {
	if (!isTestEnv) {
		console.error('Seed script can only be run in test environment (NODE_ENV=test)')
		process.exit(1)
	}

	try {
		await query('DELETE FROM payment_attempts')
		await query('DELETE FROM jobs')
		await query('DELETE FROM payments')
		await query('DELETE FROM provider_health')
	} catch (error) {
		// Ignore errors if tables don't exist yet
	}

	const paymentsToSeed = [
		{ ...paymentPayloads.valid, status: 'pending', idempotency_key: 'seed-payment-1' },
		{ ...paymentPayloads.differentCurrencies('USD'), status: 'processing', idempotency_key: 'seed-payment-2' },
		{ ...paymentPayloads.idempotency, status: 'succeeded', idempotency_key: 'seed-payment-3' },
		{ ...paymentPayloads.integrationFlow, status: 'failed', idempotency_key: 'seed-payment-4' },
	]

	for (const p of paymentsToSeed) {
		await query(`
			INSERT INTO payments (amount_cents, currency, status, idempotency_key, created_at, updated_at)
			VALUES ($1, $2, $3, $4, now(), now())
			ON CONFLICT (idempotency_key) DO NOTHING
		`, [p.amount_cents, p.currency, p.status, p.idempotency_key])
	}
	
	const { rows: payments } = await query('SELECT id FROM payments WHERE idempotency_key LIKE $1 ORDER BY id', ['seed-payment-%'])
	
	if (payments.length >= 3) {
		await query(`
			INSERT INTO jobs (payment_id, run_at, status, created_at) VALUES
			($1, now(), 'queued', now()),
			($2, now(), 'processing', now())
			ON CONFLICT DO NOTHING
		`, [payments[0].id, payments[1].id])
		
		await query(`
			INSERT INTO payment_attempts (payment_id, provider, status, latency_ms, created_at) VALUES
			($1, 'A', 'failed', 1500, now()),
			($2, 'B', 'succeeded', 800, now())
			ON CONFLICT DO NOTHING
		`, [payments[1].id, payments[2].id])
	}
	
	await query(`
		INSERT INTO provider_health (provider, state, success_count, failure_count) VALUES
		('A', 'closed', 0, 0),
		('B', 'closed', 0, 0)
		ON CONFLICT (provider) DO NOTHING
	`)
}

async function run() {
	try {
		await runSeed()
		log('Test database seeded successfully!')
		process.exit(0)
	} catch (error) {
		console.error('Error seeding database:', error)
		process.exit(1)
	}
}

const currentFileUrl = new URL(import.meta.url).pathname
const scriptPath = process.argv[1]
if (process.argv[1] && currentFileUrl.endsWith(scriptPath)) {
	run()
}
