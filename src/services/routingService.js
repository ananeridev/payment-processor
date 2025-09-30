export default ({ getConfig, callProvider, HealthRepo, sleep }) => {
	async function chooseProviders() {
		await HealthRepo.maybeHalfOpen()
		const rows = await HealthRepo.getAll()
		const healthMap = Object.fromEntries(rows.map(r => [r.provider, r]))

		const { providers } = getConfig()
		const candidates = providers
			.filter(p => {
				const h = healthMap[p.name]
				return h && (h.state === 'closed' || h.state === 'half_open')
			})
			.sort((a, b) => a.feeBps - b.feeBps)

		return { preferred: candidates[0] || null, backup: candidates[1] || null }
	}

	async function routedPayment(payload, idemKey) {
		const { hedgeDelayMs, providers } = getConfig()
		const { preferred, backup } = await chooseProviders()

		if (!preferred) {
			const [r1, r2] = await Promise.allSettled([
				callProvider(providers[0], payload, idemKey),
				callProvider(providers[1], payload, idemKey)
			])
			const rr1 = r1.status === 'fulfilled' ? r1.value : null
			const rr2 = r2.status === 'fulfilled' ? r2.value : null
			
			if (rr1 && rr1.success) return pick(providers[0].name, rr1)
			if (rr2 && rr2.success) return pick(providers[1].name, rr2)

			return rr1 || rr2
		}

		const p1 = callProvider(preferred, payload, idemKey)
		let p2 = null
		if (backup) {
			await sleep(hedgeDelayMs)
			p2 = callProvider(backup, payload, idemKey)
		}
		const first = await Promise.race([wrap(p1, preferred.name), p2 ? wrap(p2, backup.name) : never()])
		return first
	}

	function wrap(promise, label) {
		return promise.then(x => ({ label, ...x }))
	}

	function never() {
		return new Promise(() => {})
	}

	function pick(label, res) {
		return res ? { label, ...res } : null
	}

	return { routedPayment }
}
