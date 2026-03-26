# lora20 indexer

Phase 1 foundation for the off-chain indexer that treats signed LoRaWAN uplinks as token inscription events.

## Why this stack

- `Node.js 22` is already available locally, so the project can start immediately without waiting on toolchain installs.
- Native `crypto` gives us `Ed25519` verification without external dependencies.
- Native `http` and `node:test` keep the first phase bootstrappable while the protocol is still moving.

## Current scope

- Binary parser for `DEPLOY`, `MINT`, `TRANSFER`, and `CONFIG`
- `Ed25519` signature verification
- Strict per-device nonce checks
- Deterministic state machine for token balances and supply
- Webhook-style uplink receiver
- Minimal read API for tokens, balances, and transaction history
- Persistent PostgreSQL store with transactional updates

## Protocol assumptions used here

- `device_id` is the first 8 bytes of `SHA-256(raw_public_key)`, encoded as lowercase hex.
- The uplink envelope includes `deviceId` as a lookup hint so the indexer can choose the correct public key before signature verification.
- All token amounts are unsigned 64-bit big-endian integers.
- `nonce` is an unsigned 32-bit big-endian integer.
- `TO` is currently treated as an 8-byte recipient `device_id`.
- `nonce` advances only on accepted transactions. Rejected transactions are recorded, but they do not burn the sender nonce.

## Local commands

```bash
npm install
npm test
npm run start
docker compose up --build
```

## Docker deployment

For a Debian host with Docker and Compose installed:

```bash
cp .env.example .env
docker compose -f docker-compose.prod.yml up -d --build
```

This starts:

- `indexer` on port `3000`
- `postgres` in a private Compose network

Notes:

- `STORE_BACKEND=postgres` is the default in `.env.example`.
- Indexer state persists across restarts in PostgreSQL.
- Do not expose PostgreSQL publicly unless you have a reason to do so.

### Debian quick install

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-v2
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
```

After re-login:

```bash
git clone <your-repo-url> lora20
cd lora20
cp .env.example .env
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
curl http://127.0.0.1:3000/health
```

## API surface

- `POST /devices/register`
- `POST /uplinks`
- `GET /tokens/:tick`
- `GET /balances/:deviceId/:tick`
- `GET /transactions?deviceId=<hex>&tick=<TICK>&limit=50`
- `GET /health`

### Register device

```json
{
  "publicKeyRaw": "hex-or-base64",
  "wallet": "optional-solana-wallet"
}
```

### Ingest uplink

```json
{
  "deviceId": "8-byte-id-in-hex",
  "payload": "hex-or-base64",
  "receivedAt": "2026-03-26T14:00:00.000Z",
  "networkMetadata": {
    "fPort": 1,
    "gateway": "helium"
  }
}
```

## Next recommended step

Add an authenticated device-registration flow, then start firmware work against the persisted indexer API.
