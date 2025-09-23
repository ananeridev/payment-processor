const express = require('express')
const { buildPaymentsRouter } = require('./routes/payments.routes')
const { errorHandler } = require('./middlewares/error-handler')

function buildApp() {
	const app = express()
	app.use(express.json())
	app.use('/payments', buildPaymentsRouter())
	app.use(errorHandler)
	return app
}

export default { buildApp }
