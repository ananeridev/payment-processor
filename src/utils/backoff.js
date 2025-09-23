function nextDelaySec(attempts) {
	const base = Math.min(2 ** attempts, 60)
	const jitter = Math.floor(Math.random() * 3)
	return base + jitter
}

export default { nextDelaySec }
