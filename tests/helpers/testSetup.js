if (!process.env.NODE_ENV) {
	process.env.NODE_ENV = 'test'
}

import { waitForDb, closeDb } from '../../src/db.js'

let dbSetupComplete = false

export async function setupTestDatabase() {
	if (dbSetupComplete) {
		return
	}
	
	await waitForDb(5, 1000)
	dbSetupComplete = true
}

export async function teardownTestDatabase() {
	await closeDb()
}

export function ensureTestEnvironment() {
	if (process.env.NODE_ENV !== 'test') {
		throw new Error('Tests should only run in NODE_ENV=test environment')
	}
}
