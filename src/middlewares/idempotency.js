export function requireIdempotencyKey(req, res, next) {
	const key = req.get('Idempotency-Key')
	return key ? next() : res.status(400).json({ error: 'Idempotency-Key header required' })
}

export default { requireIdempotencyKey }