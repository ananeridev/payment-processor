// validar que le do test corretamente quando for rodar os testes e2e
export function getConfig() {
    const dbUrl = process.env.NODE_ENV === 'test' 
        ? process.env.TEST_DATABASE_URL 
        : process.env.DB_URL

    return {
        port: Number(process.env.PORT) || 3000,
        dbUrl: dbUrl,
        providers: [
            { name: 'A', url: process.env.PROVIDER_A_URL, feeBps: Number(process.env.PROVIDER_A_FEE_BPS) || 150 },
            { name: 'B', url: process.env.PROVIDER_B_URL, feeBps: Number(process.env.PROVIDER_B_FEE_BPS) || 150 },
        ],
        httpTimeoutMs: 5000,
        hedgeDelayMs: 1200,
        maxAttempts: 3,
    }
}

export default { getConfig}