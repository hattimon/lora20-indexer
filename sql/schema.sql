CREATE TABLE IF NOT EXISTS devices (
  device_id BYTEA PRIMARY KEY,
  wallet TEXT,
  auto_mint_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  auto_mint_interval_seconds INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS device_public_keys (
  device_id BYTEA PRIMARY KEY REFERENCES devices(device_id) ON DELETE CASCADE,
  public_key_raw BYTEA NOT NULL UNIQUE,
  public_key_hash BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS device_nonces (
  device_id BYTEA PRIMARY KEY REFERENCES devices(device_id) ON DELETE CASCADE,
  last_nonce BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tokens (
  tick CHAR(4) PRIMARY KEY,
  created_by_device_id BYTEA NOT NULL REFERENCES devices(device_id),
  max_supply NUMERIC(20, 0) NOT NULL,
  limit_per_mint NUMERIC(20, 0) NOT NULL,
  total_supply NUMERIC(20, 0) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (max_supply > 0),
  CHECK (limit_per_mint > 0),
  CHECK (total_supply >= 0),
  CHECK (total_supply <= max_supply),
  CHECK (limit_per_mint <= max_supply)
);

CREATE TABLE IF NOT EXISTS balances (
  device_id BYTEA NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  tick CHAR(4) NOT NULL REFERENCES tokens(tick) ON DELETE CASCADE,
  balance NUMERIC(20, 0) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (device_id, tick),
  CHECK (balance >= 0)
);

CREATE TABLE IF NOT EXISTS events (
  event_id UUID PRIMARY KEY,
  status TEXT NOT NULL,
  rejection_reason TEXT,
  device_id BYTEA,
  op SMALLINT NOT NULL,
  tick CHAR(4),
  amount NUMERIC(20, 0),
  max_supply NUMERIC(20, 0),
  limit_per_mint NUMERIC(20, 0),
  nonce BIGINT,
  recipient_device_id BYTEA,
  config JSONB,
  payload BYTEA NOT NULL,
  signature BYTEA,
  payload_digest TEXT,
  network_metadata JSONB,
  received_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status IN ('accepted', 'rejected'))
);

CREATE INDEX IF NOT EXISTS idx_events_device_id ON events(device_id);
CREATE INDEX IF NOT EXISTS idx_events_tick ON events(tick);
CREATE INDEX IF NOT EXISTS idx_events_received_at ON events(received_at DESC);
