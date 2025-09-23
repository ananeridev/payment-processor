import express from 'express'
import { buildPaymentsRouter } from './routes/paymentsRoute.js'
import { errorHandler } from './middlewares/errorHandler.js'

export function buildApp() {
	const app = express()
	app.use(express.json())
	app.use('/payments', buildPaymentsRouter())
	app.use(errorHandler)
	return app
}