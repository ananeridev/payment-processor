export function errorHandler(err, req, res, _next) {
	console.error(err)
	const status = err.status || 500
	res.status(status).json({ error: err.message || 'internal' })
}

export default { errorHandler }