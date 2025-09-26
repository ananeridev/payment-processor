import { getConfig } from './config.js'
import { Pool } from 'pg'

const connectionString = getConfig().dbUrl
const pool = new Pool({ connectionString })

function query(sql, params) {
	return pool.query(sql, params)
}

async function waitForDb(maxAttempts = 5, delay = 1000) {
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			const testPool = new Pool({ connectionString: getConfig().dbUrl })
			const client = await testPool.connect()
			await client.query('SELECT 1')
			client.release()
			await testPool.end()
			return true
		} catch (error) {
			if (error.code === 'ECONNREFUSED') {
				throw new Error('Database connection refused. Is the database running?');
			}

			if (attempt === maxAttempts) {
				throw new Error(`Database not ready after ${maxAttempts} attempts`)
			}
			await new Promise(resolve => setTimeout(resolve, delay))
		}
	}
}

async function closeDb() {
	await pool.end()
}

export { pool, query, waitForDb, closeDb }