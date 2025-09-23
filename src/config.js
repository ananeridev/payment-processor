export function getConfig() {
    return {
    port: Number(process.env.PORT) || 3000,
    dbUrl: process.env.DB_URL,
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