export const validCurrencies = ['BRL', 'USD', 'EUR', 'GBP', 'JPY']

export const paymentPayloads = {
  valid: {
    amount_cents: 50000,
    currency: 'BRL'
  },
  differentCurrencies: (currency) => ({
    amount_cents: 25000,
    currency: currency
  }),
  nullCurrency: {
    amount_cents: 15000,
    currency: null
  },
  missingAmount: {
    currency: 'BRL'
  },
  zeroAmount: {
    amount_cents: 0,
    currency: 'BRL'
  },
  negativeAmount: {
    amount_cents: -1000,
    currency: 'BRL'
  },
  stringAmount: {
    amount_cents: 'invalid',
    currency: 'BRL'
  },
  idempotency: {
    amount_cents: 30000,
    currency: 'EUR'
  },
  integrationFlow: {
    amount_cents: 75000,
    currency: 'USD'
  }
}
