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
- ChirpStack HTTP webhook ingestion with `DevEUI -> deviceId` mapping
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
- If your dashboard is hosted on another origin such as GitHub Pages, set `CORS_ALLOWED_ORIGINS` to that dashboard URL.

### HTTPS with Caddy

An optional `caddy` profile is included for public HTTPS termination:

```bash
docker compose -f docker-compose.prod.yml --profile https up -d --build
```

Requirements:

- `CADDY_DOMAIN` must point to your public IP with a public DNS `A` record.
- Public ports `80/tcp` and `443/tcp` must reach the machine running Docker.
- With VirtualBox NAT, forward host `80 -> guest 80` and host `443 -> guest 443`.
- On your router, forward public `80/443 -> Windows host 192.168.0.2:80/443`.

Recommended webhook URL for ChirpStack:

```text
https://<your-domain>/integrations/chirpstack
```

Do not use raw public IP for production HTTPS. Use a domain or a dynamic DNS hostname such as a DuckDNS subdomain.

### Cross-origin browser dashboard access

If you host a static dashboard on GitHub Pages or another origin, allow browser access explicitly:

```env
CORS_ALLOWED_ORIGINS=https://<your-dashboard-origin>
```

You can provide multiple origins as a comma-separated list.

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
- `PUT /devices/:deviceId/lorawan`
- `POST /uplinks`
- `POST /integrations/chirpstack`
- `GET /tokens/:tick`
- `GET /balances/:deviceId/:tick`
- `GET /transactions?deviceId=<hex>&tick=<TICK>&limit=50`
- `GET /health`

### Register device

```json
{
  "publicKeyRaw": "hex-or-base64",
  "wallet": "optional-solana-wallet",
  "lorawanDevEui": "optional-16-hex-dev-eui"
}
```

### Link LoRaWAN DevEUI to an existing device

```json
{
  "devEui": "6982686000009070"
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

### ChirpStack HTTP integration

Point the ChirpStack HTTP integration at:

```text
POST /integrations/chirpstack
```

The handler:

- accepts ChirpStack uplink events with `deviceInfo.devEui` and `data`
- resolves the registered lora20 device through the linked `lorawanDevEui`
- verifies the embedded `Ed25519` signature before mutating state
- ignores non-uplink events with `202 {"status":"ignored"}`

If `CHIRPSTACK_WEBHOOK_TOKEN` is set, provide it as:

- `Authorization: Bearer <token>`
- or `X-ChirpStack-Token: <token>`
- or `X-API-Key: <token>`
- or `?token=<token>` as a fallback

Before enabling the webhook, link the LoRaWAN `DevEUI` from ChirpStack to the already registered cryptographic `deviceId`:

```bash
curl -X PUT http://127.0.0.1:3000/devices/<deviceId>/lorawan \
  -H "Content-Type: application/json" \
  -d '{"devEui":"6982686000009070"}'
```

Minimal uplink body expected from ChirpStack:

```json
{
  "time": "2026-03-26T23:41:24.000Z",
  "deviceInfo": {
    "devEui": "6982686000009070",
    "deviceName": "heltec-v4-01"
  },
  "devAddr": "780002c7",
  "fCnt": 1,
  "fPort": 1,
  "dr": 5,
  "data": "hex-or-base64"
}
```

## Next recommended step

Add an authenticated device-registration flow, then start firmware work against the persisted indexer API.
