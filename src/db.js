import { getConfig } from './config.js'
import { Pool } from 'pg'

const pool = new Pool({ connectionString: getConfig().dbUrl })

function query(sql, params) {
	return pool.query(sql, params)
}

export { pool, query }
