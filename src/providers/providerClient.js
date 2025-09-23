import { getConfig } from '../config.js'

// Função pura para criar timeout
const createTimeout = (ms) => {
	const controller = new AbortController()
	const timeoutId = setTimeout(() => controller.abort(), ms)
	return { 
		signal: controller.signal, 
		cancel: () => clearTimeout(timeoutId) 
	}
}

// Função pura para criar headers
const createHeaders = (idempotencyKey) => ({
	'Content-Type': 'application/json',
	'Idempotency-Key': idempotencyKey
})

// Função pura para criar request options
const createRequestOptions = (payload, idempotencyKey, signal) => ({
	method: 'POST',
	headers: createHeaders(idempotencyKey),
	body: JSON.stringify(payload),
	signal
})

// Função pura para processar resposta
const processResponse = async (response, startTime) => {
	const latency = Date.now() - startTime
	const body = await response.json().catch(() => ({}))
	return { 
		ok: response.ok, 
		code: response.status, 
		body, 
		latency 
	}
}

// Função pura para processar erro
const processError = (error, startTime) => {
	const latency = Date.now() - startTime
	const isAbort = error.name === 'AbortError'
	return { 
		ok: false, 
		code: isAbort ? 599 : 598, 
		body: { error: error.message }, 
		latency 
	}
}

// Função principal para chamar provider
const callProvider = async (provider, payload, idempotencyKey) => {
	const { httpTimeoutMs } = getConfig()
	const timeout = createTimeout(httpTimeoutMs)
	const startTime = Date.now()
	
	try {
		const requestOptions = createRequestOptions(payload, idempotencyKey, timeout.signal)
		const response = await fetch(provider.url, requestOptions)
		return await processResponse(response, startTime)
	} catch (error) {
		return processError(error, startTime)
	} finally {
		timeout.cancel()
	}
}

class ProviderClient {
	static async call(provider, payload, idempotencyKey) {
		return callProvider(provider, payload, idempotencyKey)
	}
}

export { callProvider, ProviderClient }
export default ProviderClient
