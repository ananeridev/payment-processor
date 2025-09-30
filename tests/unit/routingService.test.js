import { describe, it, assert } from 'poku'
import routingServiceFactory from '../../src/services/routingService.js'

describe('Routing Service', () => {
	// Mock providers, C is cheapest
	const mockProviderA = { name: 'A', feeBps: 100 }
	const mockProviderB = { name: 'B', feeBps: 120 }
	const mockProviderC = { name: 'C', feeBps: 90 }

	const basePayload = { amount_cents: 1000, currency: 'BRL' }

	it('should choose the cheapest provider when all are healthy', async () => {
		const callProviderCalls = []
		const mockGetConfig = () => ({
			hedgeDelayMs: 50,
			providers: [mockProviderA, mockProviderB, mockProviderC]
		})
		const mockHealthRepo = {
			maybeHalfOpen: async () => {},
			getAll: async () => [
				{ provider: 'A', state: 'closed' },
				{ provider: 'B', state: 'closed' },
				{ provider: 'C', state: 'closed' }
			]
		}
		const mockCallProvider = async (provider) => {
			callProviderCalls.push(provider.name)
			return { success: true }
		}
		const service = routingServiceFactory({
			getConfig: mockGetConfig,
			HealthRepo: mockHealthRepo,
			callProvider: mockCallProvider,
			sleep: async () => {}
		})

		const result = await service.routedPayment(basePayload, 'test-key')

		assert.strictEqual(result.label, 'C')
		assert.strictEqual(callProviderCalls[0], 'C')
	})

	it('should use backup provider if preferred fails', async () => {
		const callProviderCalls = []
		const mockGetConfig = () => ({
			hedgeDelayMs: 50,
			providers: [mockProviderA, mockProviderC] // C is cheaper preferred, A is backup
		})
		const mockHealthRepo = {
			maybeHalfOpen: async () => {},
			getAll: async () => [
				{ provider: 'C', state: 'closed' }, // Preferred
				{ provider: 'A', state: 'closed' }  // Backup
			]
		}
		const mockCallProvider = async (provider) => {
			callProviderCalls.push(provider.name)
			if (provider.name === 'C') {
				// Simulate slow failure for C
				await new Promise(r => setTimeout(r, 100))
				return { success: false, error: 'timeout' }
			}
			return { success: true } // A succeeds
		}
		const service = routingServiceFactory({
			getConfig: mockGetConfig,
			HealthRepo: mockHealthRepo,
			callProvider: mockCallProvider,
			sleep: async () => {}
		})

		const result = await service.routedPayment(basePayload, 'test-key')

		assert.strictEqual(result.success, true)
		assert.strictEqual(result.label, 'A')
		assert.deepStrictEqual(callProviderCalls, ['C', 'A'])
	})

	it('should handle case where no providers are healthy', async () => {
		const callProviderCalls = []
		const mockGetConfig = () => ({
			providers: [mockProviderA, mockProviderB]
		})
		const mockHealthRepo = {
			maybeHalfOpen: async () => {},
			getAll: async () => [
				{ provider: 'A', state: 'open' },
				{ provider: 'B', state: 'open' }
			]
		}
		const mockCallProvider = async (provider) => {
			callProviderCalls.push(provider.name)
			if (provider.name === 'A') return { success: false } // A fails
			return { success: true } // B succeeds
		}
		const service = routingServiceFactory({
			getConfig: mockGetConfig,
			HealthRepo: mockHealthRepo,
			callProvider: mockCallProvider,
			sleep: async () => {}
		})

		const result = await service.routedPayment(basePayload, 'test-key')

		assert.strictEqual(result.success, true)
		assert.strictEqual(result.label, 'B')
		assert.deepStrictEqual(callProviderCalls, ['A', 'B'])
	})

	it('should handle no healthy providers where first provider succeeds', async () => {
		const callProviderCalls = []
		const mockGetConfig = () => ({ providers: [mockProviderA, mockProviderB] })
		const mockHealthRepo = {
			maybeHalfOpen: async () => {},
			getAll: async () => [] // No healthy providers
		}
		const mockCallProvider = async (provider) => {
			callProviderCalls.push(provider.name)
			return { success: true } // A succeeds
		}
		const service = routingServiceFactory({
			getConfig: mockGetConfig,
			HealthRepo: mockHealthRepo,
			callProvider: mockCallProvider,
			sleep: async () => {}
		})

		const result = await service.routedPayment(basePayload, 'test-key')

		assert.strictEqual(result.success, true)
		assert.strictEqual(result.label, 'A')
		assert.deepStrictEqual(callProviderCalls, ['A', 'B'])
	})

	it('should handle no healthy providers where both fail', async () => {
		const mockGetConfig = () => ({ providers: [mockProviderA, mockProviderB] })
		const mockHealthRepo = {
			maybeHalfOpen: async () => {},
			getAll: async () => [] // No healthy providers just for unit test
		}
		const mockCallProvider = async () => ({ success: false, error: 'failed' })
		const service = routingServiceFactory({
			getConfig: mockGetConfig,
			HealthRepo: mockHealthRepo,
			callProvider: mockCallProvider,
			sleep: async () => {}
		})

		const result = await service.routedPayment(basePayload, 'test-key')

		assert.strictEqual(result.success, false)
	})

	it('should handle having a preferred but no backup provider', async () => {
		const callProviderCalls = []
		const mockGetConfig = () => ({
			hedgeDelayMs: 50,
			providers: [mockProviderC] // Only C is available
		})
		const mockHealthRepo = {
			maybeHalfOpen: async () => {},
			getAll: async () => [{ provider: 'C', state: 'closed' }]
		}
		const mockCallProvider = async (provider) => {
			callProviderCalls.push(provider.name)
			return { success: true }
		}
		const service = routingServiceFactory({
			getConfig: mockGetConfig,
			HealthRepo: mockHealthRepo,
			callProvider: mockCallProvider,
			sleep: async () => {}
		})

		const result = await service.routedPayment(basePayload, 'test-key')

		assert.strictEqual(result.success, true)
		assert.strictEqual(result.label, 'C')
		assert.strictEqual(callProviderCalls.length, 1)
	})
})
