const express = require('express')
import { requireIdempotencyKey } from '../middlewares/idempotency.js'
import PaymentsController from '../controllers/paymentController.js'

function buildPaymentsRouter() {
	const r = express.Router()
	r.post('/', requireIdempotencyKey, PaymentsController.create)
	r.get('/:id', PaymentsController.getById)
	return r
}

export default { buildPaymentsRouter }
