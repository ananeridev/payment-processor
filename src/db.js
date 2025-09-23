const { Pool } = require('pg')
const { getConfig } = require('./config')

const pool = new Pool({ connectionString: getConfig().dbUrl })

function query(sql, params) {
	return pool.query(sql, params)
}

module.exports = { pool, query }
