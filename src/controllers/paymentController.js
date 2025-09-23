import paymentService from '../services/paymentsService.js'

async function create(req, res, next) {
	try {
		const idem = req.get('Idempotency-Key')
		const { amount_cents, currency } = req.body || {}
		if (!Number.isInteger(amount_cents) || amount_cents <= 0) {
			return res.status(400).json({ error: 'amount_cents > 0 required' })
		}
		const out = await paymentService.createPayment(amount_cents, currency, idem)
		res.status(202).json(out)
	} catch (e) {
		next(e)
	}
}

async function getById(req, res, next) {
	try {
		const p = await paymentService.getPayment(req.params.id)
		if (!p) return res.status(404).json({ error: 'not found' })
		res.json({
			id: p.id,
			amount_cents: p.amount_cents,
			currency: p.currency,
			status: p.status,
			provider: p.provider_success,
			external_payment_id: p.external_payment_id,
			last_error: p.last_error
		})
	} catch (e) {
		next(e)
	}
}

export default { create, getById }
