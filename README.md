# Payment Processor

A robust payment processing system with modular architecture, functional programming, and comprehensive testing using node test runner.

## Features

- **ES Modules** with native Node.js 20.6+ dotenv support
- **Functional Programming** with pure functions and composition
- **Modular Architecture** with organized structure
- **Comprehensive Testing** including integration, load, and stress tests
- **Idempotency** for safe operations
- **Circuit Breaker** protection against external provider failures
- **Async Worker System** for payment processing


### Prerequisites
- Node.js 20.6+
- PostgreSQL
- K6 (for load testing)

### Installations

```bash
git clone <repository-url>
cd payment-processor
npm install
brew install k6 
cp env.example .env
```
### Running

```bash
npm run dev or start
npm run worker
```

## API

### Create Payment

```http
POST /payments
Content-Type: application/json
Idempotency-Key: unique-key-123

<img width="671" height="227" alt="Screenshot 2025-09-23 at 12 43 22" src="https://github.com/user-attachments/assets/cca0656a-acfa-49d1-bc08-8a4fb4c4f18c" />

### Get Payment

```http
GET /payments/{id}
```
<img width="653" height="279" alt="Screenshot 2025-09-23 at 12 43 41" src="https://github.com/user-attachments/assets/d3925aae-e325-499f-9811-6e5f2699c30c" />

## Testing

```bash
npm run test:integration

npm run test:load
npm run test:stress
npm run test:concurrency

npm run test:all
```

## Performance Targets collected

- Payment creation: < 1.5s (P95)
- Payment retrieval: < 500ms (P95)
- Error rate: < 5%
- Throughput: > 100 req/s
- Idempotency: 100% maintained

## Arch

1. **Create** payment via API
2. **Validate** idempotency key
3. **Queue** payment job
4. **Process** asynchronously via worker
5. **Route** to best available provider
6. **Execute** payment
7. **Update** status in database
8. **Notify** via outbox events

