export default ({ pool, Payments, Jobs }) => ({
	async createPayment(amountCents, currency, idemKey) {
		const client = await pool.connect()
		try {
			await client.query('BEGIN')
			
			const payment = await Payments.insertOrTouch(amountCents, currency, idemKey, client)
			await Jobs.enqueue(payment.id, client)
			
			await client.query('COMMIT')
			return { id: payment.id, status: payment.status }
		} catch (error) {
			await client.query('ROLLBACK')
			throw error
		} finally {
			client.release()
		}
	},
	
	async getPayment(id) {
		return await Payments.getById(id)
	}
})
