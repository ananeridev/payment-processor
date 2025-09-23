CREATE TABLE IF NOT EXISTS payments (
    id SERIAL PRIMARY KEY,
    amount_cents INTEGER NOT NULL,
    currency VARCHAR(3) DEFAULT 'BRL',
    status VARCHAR(20) DEFAULT 'pending',
    idempotency_key VARCHAR(255) UNIQUE NOT NULL,
    provider_success VARCHAR(50),
    external_payment_id VARCHAR(255),
    last_error TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS jobs (
    id SERIAL PRIMARY KEY,
    payment_id INTEGER REFERENCES payments(id),
    status VARCHAR(20) DEFAULT 'queued',
    attempts INTEGER DEFAULT 0,
    run_at TIMESTAMP DEFAULT NOW(),
    locked_at TIMESTAMP,
    locked_by VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment_attempts (
    id SERIAL PRIMARY KEY,
    payment_id INTEGER REFERENCES payments(id),
    provider VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL,
    http_status INTEGER,
    latency_ms INTEGER,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS provider_health (
    provider VARCHAR(50) PRIMARY KEY,
    state VARCHAR(20) DEFAULT 'closed',
    success_count INTEGER DEFAULT 0,
    failure_count INTEGER DEFAULT 0,
    last_success_at TIMESTAMP,
    last_failure_at TIMESTAMP,
    cooldown_until TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS outbox_events (
    id SERIAL PRIMARY KEY,
    payment_id INTEGER REFERENCES payments(id),
    type VARCHAR(50) NOT NULL,
    payload JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO provider_health (provider, state) VALUES 
    ('A', 'closed'),
    ('B', 'closed')
ON CONFLICT (provider) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_payments_idempotency_key ON payments(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_jobs_status_run_at ON jobs(status, run_at);
CREATE INDEX IF NOT EXISTS idx_jobs_locked_by ON jobs(locked_by);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_payment_id ON payment_attempts(payment_id);
CREATE INDEX IF NOT EXISTS idx_outbox_events_payment_id ON outbox_events(payment_id);
