import { createHash } from "node:crypto";
import pg from "pg";
import { OP_NAMES } from "../protocol/constants.js";
import { hex } from "../protocol/encoding.js";
import { RuleViolationError } from "../protocol/errors.js";

const { Pool } = pg;

export class PostgresStore {
  constructor({ pool, client = null }) {
    this.kind = "postgres";
    this.pool = pool;
    this.client = client;
  }

  static async connect({ connectionString }) {
    const pool = new Pool({
      connectionString
    });

    const store = new PostgresStore({ pool });
    await store.ping();
    await store.ensureSchema();
    return store;
  }

  async ensureSchema() {
    await this.query(`
      ALTER TABLE devices
      ADD COLUMN IF NOT EXISTS lorawan_dev_eui BYTEA
    `);

    await this.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_lorawan_dev_eui
      ON devices (lorawan_dev_eui)
      WHERE lorawan_dev_eui IS NOT NULL
    `);
  }

  async withTransaction(callback) {
    if (this.client) {
      return callback(this);
    }

    const client = await this.pool.connect();
    const transactionalStore = new PostgresStore({
      pool: this.pool,
      client
    });

    try {
      await client.query("BEGIN");
      const result = await callback(transactionalStore);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async ping() {
    await this.query("SELECT 1");
  }

  async registerDevice({ deviceId, publicKeyRaw, wallet = null, lorawanDevEui = null }) {
    return this.withTransaction(async (tx) => {
      try {
        await tx.query(
          `
            INSERT INTO devices (
              device_id,
              lorawan_dev_eui,
              wallet,
              auto_mint_enabled,
              auto_mint_interval_seconds
            )
            VALUES (
              decode($1, 'hex'),
              CASE WHEN $2::text IS NULL THEN NULL ELSE decode($2::text, 'hex') END,
              $3,
              FALSE,
              NULL
            )
          `,
          [deviceId, lorawanDevEui, wallet]
        );

        await tx.query(
          `
            INSERT INTO device_public_keys (
              device_id,
              public_key_raw,
              public_key_hash
            )
            VALUES (
              decode($1, 'hex'),
              decode($2, 'hex'),
              decode($3, 'hex')
            )
          `,
          [deviceId, hex(publicKeyRaw), createHash("sha256").update(publicKeyRaw).digest("hex")]
        );

        await tx.query(
          `
            INSERT INTO device_nonces (
              device_id,
              last_nonce
            )
            VALUES (decode($1, 'hex'), NULL)
          `,
          [deviceId]
        );
      } catch (error) {
        if (error.code === "23505") {
          if (String(error.constraint).includes("lorawan_dev_eui")) {
            throw new RuleViolationError(
              `LoRaWAN DevEUI ${lorawanDevEui} is already linked to another device`,
              "lorawan_dev_eui_already_registered"
            );
          }

          throw new RuleViolationError(`Device ${deviceId} is already registered`, "device_already_registered");
        }

        throw error;
      }

      return tx.getDevice(deviceId);
    });
  }

  async getDevice(deviceId, { forUpdate = false } = {}) {
    const result = await this.query(
      `
        SELECT
          encode(d.device_id, 'hex') AS device_id,
          encode(k.public_key_raw, 'hex') AS public_key_raw,
          encode(d.lorawan_dev_eui, 'hex') AS lorawan_dev_eui,
          d.wallet,
          d.auto_mint_enabled,
          d.auto_mint_interval_seconds,
          n.last_nonce,
          d.created_at,
          d.updated_at
        FROM devices d
        JOIN device_public_keys k ON k.device_id = d.device_id
        LEFT JOIN device_nonces n ON n.device_id = d.device_id
        WHERE d.device_id = decode($1, 'hex')
        ${forUpdate ? "FOR UPDATE OF d" : ""}
      `,
      [deviceId]
    );

    return result.rows[0] ? mapDeviceRow(result.rows[0]) : null;
  }

  async getDeviceByLorawanDevEui(lorawanDevEui, { forUpdate = false } = {}) {
    const result = await this.query(
      `
        SELECT
          encode(d.device_id, 'hex') AS device_id,
          encode(k.public_key_raw, 'hex') AS public_key_raw,
          encode(d.lorawan_dev_eui, 'hex') AS lorawan_dev_eui,
          d.wallet,
          d.auto_mint_enabled,
          d.auto_mint_interval_seconds,
          n.last_nonce,
          d.created_at,
          d.updated_at
        FROM devices d
        JOIN device_public_keys k ON k.device_id = d.device_id
        LEFT JOIN device_nonces n ON n.device_id = d.device_id
        WHERE d.lorawan_dev_eui = decode($1, 'hex')
        ${forUpdate ? "FOR UPDATE OF d" : ""}
      `,
      [lorawanDevEui]
    );

    return result.rows[0] ? mapDeviceRow(result.rows[0]) : null;
  }

  async saveDevice(device) {
    try {
      await this.query(
        `
          UPDATE devices
          SET
            lorawan_dev_eui = CASE WHEN $2::text IS NULL THEN NULL ELSE decode($2::text, 'hex') END,
            wallet = $3,
            auto_mint_enabled = $4,
            auto_mint_interval_seconds = $5,
            updated_at = NOW()
          WHERE device_id = decode($1, 'hex')
        `,
        [
          device.deviceId,
          device.lorawanDevEui,
          device.wallet,
          device.autoMintEnabled,
          device.autoMintIntervalSeconds
        ]
      );
    } catch (error) {
      if (error.code === "23505" && String(error.constraint).includes("lorawan_dev_eui")) {
        throw new RuleViolationError(
          `LoRaWAN DevEUI ${device.lorawanDevEui} is already linked to another device`,
          "lorawan_dev_eui_already_registered"
        );
      }

      throw error;
    }

    await this.query(
      `
        INSERT INTO device_nonces (
          device_id,
          last_nonce,
          updated_at
        )
        VALUES (decode($1, 'hex'), $2, NOW())
        ON CONFLICT (device_id)
        DO UPDATE SET
          last_nonce = EXCLUDED.last_nonce,
          updated_at = NOW()
      `,
      [device.deviceId, device.lastNonce]
    );

    return this.getDevice(device.deviceId);
  }

  async createToken(token) {
    try {
      await this.query(
        `
          INSERT INTO tokens (
            tick,
            created_by_device_id,
            max_supply,
            limit_per_mint,
            total_supply,
            created_at,
            updated_at
          )
          VALUES (
            $1,
            decode($2, 'hex'),
            $3,
            $4,
            $5,
            $6,
            $7
          )
        `,
        [
          token.tick,
          token.createdByDeviceId,
          token.maxSupply.toString(),
          token.limitPerMint.toString(),
          token.totalSupply.toString(),
          token.createdAt,
          token.updatedAt
        ]
      );
    } catch (error) {
      if (error.code === "23505") {
        throw new RuleViolationError(`Token ${token.tick} already exists`, "token_already_exists");
      }

      throw error;
    }

    return this.getToken(token.tick);
  }

  async getToken(tick, { forUpdate = false } = {}) {
    const result = await this.query(
      `
        SELECT
          tick,
          encode(created_by_device_id, 'hex') AS created_by_device_id,
          max_supply,
          limit_per_mint,
          total_supply,
          created_at,
          updated_at
        FROM tokens
        WHERE tick = $1
        ${forUpdate ? "FOR UPDATE" : ""}
      `,
      [tick]
    );

    return result.rows[0] ? mapTokenRow(result.rows[0]) : null;
  }

  async listTokens({ search, limit = 100 } = {}) {
    const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 100;
    const normalizedSearch = search ? String(search).toUpperCase() : null;
    const params = normalizedSearch ? [normalizedSearch, safeLimit] : [safeLimit];
    const where = normalizedSearch ? "WHERE tick LIKE ($1::text || '%')" : "";
    const limitPlaceholder = normalizedSearch ? "$2" : "$1";

    const result = await this.query(
      `
        SELECT
          tick,
          encode(created_by_device_id, 'hex') AS created_by_device_id,
          max_supply,
          limit_per_mint,
          total_supply,
          created_at,
          updated_at
        FROM tokens
        ${where}
        ORDER BY updated_at DESC, tick ASC
        LIMIT ${limitPlaceholder}
      `,
      params
    );

    return result.rows.map(mapTokenRow);
  }

  async saveToken(token) {
    await this.query(
      `
        UPDATE tokens
        SET
          max_supply = $2,
          limit_per_mint = $3,
          total_supply = $4,
          updated_at = NOW()
        WHERE tick = $1
      `,
      [
        token.tick,
        token.maxSupply.toString(),
        token.limitPerMint.toString(),
        token.totalSupply.toString()
      ]
    );

    return this.getToken(token.tick);
  }

  async getBalance(deviceId, tick) {
    const result = await this.query(
      `
        SELECT balance
        FROM balances
        WHERE device_id = decode($1, 'hex') AND tick = $2
      `,
      [deviceId, tick]
    );

    return result.rows[0] ? BigInt(result.rows[0].balance) : 0n;
  }

  async listBalances(deviceId, { limit = 100 } = {}) {
    const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 100;
    const result = await this.query(
      `
        SELECT
          b.tick,
          b.balance,
          t.tick AS token_tick,
          encode(t.created_by_device_id, 'hex') AS created_by_device_id,
          t.max_supply,
          t.limit_per_mint,
          t.total_supply,
          t.created_at,
          t.updated_at
        FROM balances b
        LEFT JOIN tokens t ON t.tick = b.tick
        WHERE b.device_id = decode($1, 'hex')
          AND b.balance <> 0
        ORDER BY b.updated_at DESC, b.tick ASC
        LIMIT $2
      `,
      [deviceId, safeLimit]
    );

    return result.rows.map((row) => ({
      tick: row.tick.trim(),
      balance: BigInt(row.balance),
      token: row.token_tick ? mapTokenRow(row) : null
    }));
  }

  async addBalance(deviceId, tick, delta) {
    const result = await this.query(
      `
        INSERT INTO balances (
          device_id,
          tick,
          balance,
          updated_at
        )
        VALUES (
          decode($1, 'hex'),
          $2,
          $3,
          NOW()
        )
        ON CONFLICT (device_id, tick)
        DO UPDATE SET
          balance = balances.balance + EXCLUDED.balance,
          updated_at = NOW()
        RETURNING balance
      `,
      [deviceId, tick, BigInt(delta).toString()]
    );

    return BigInt(result.rows[0].balance);
  }

  async appendEvent(event) {
    await this.query(
      `
        INSERT INTO events (
          event_id,
          status,
          rejection_reason,
          device_id,
          op,
          tick,
          amount,
          max_supply,
          limit_per_mint,
          nonce,
          recipient_device_id,
          config,
          payload,
          signature,
          payload_digest,
          network_metadata,
          received_at,
          created_at
        )
        VALUES (
          $1,
          $2,
          $3,
          CASE WHEN $4::text IS NULL THEN NULL ELSE decode($4::text, 'hex') END,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
          CASE WHEN $11::text IS NULL THEN NULL ELSE decode($11::text, 'hex') END,
          $12::jsonb,
          decode($13, 'hex'),
          decode($14, 'hex'),
          $15,
          $16::jsonb,
          $17,
          $18
        )
      `,
      [
        event.id,
        event.status,
        event.rejectionReason,
        event.deviceId,
        event.op,
        event.tick,
        stringifyBigIntOrNull(event.amount),
        stringifyBigIntOrNull(event.maxSupply),
        stringifyBigIntOrNull(event.limitPerMint),
        event.nonce,
        event.recipientDeviceId,
        event.config ? JSON.stringify(event.config) : null,
        event.payloadHex,
        event.signatureHex,
        event.payloadDigest,
        event.networkMetadata ? JSON.stringify(event.networkMetadata) : null,
        event.receivedAt,
        event.createdAt
      ]
    );

    return event;
  }

  async listTransactions({ deviceId, tick, limit = 50 } = {}) {
    const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 50;
    const clauses = [];
    const params = [];

    if (deviceId) {
      params.push(deviceId);
      clauses.push(`(device_id = decode($${params.length}, 'hex') OR recipient_device_id = decode($${params.length}, 'hex'))`);
    }

    if (tick) {
      params.push(tick);
      clauses.push(`tick = $${params.length}`);
    }

    params.push(safeLimit);

    const result = await this.query(
      `
        SELECT
          event_id,
          status,
          rejection_reason,
          encode(device_id, 'hex') AS device_id,
          op,
          tick,
          amount,
          max_supply,
          limit_per_mint,
          nonce,
          encode(recipient_device_id, 'hex') AS recipient_device_id,
          config,
          encode(payload, 'hex') AS payload_hex,
          encode(signature, 'hex') AS signature_hex,
          payload_digest,
          network_metadata,
          received_at,
          created_at
        FROM events
        ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
        ORDER BY received_at DESC, created_at DESC
        LIMIT $${params.length}
      `,
      params
    );

    return result.rows.map(mapEventRow);
  }

  async close() {
    if (!this.client && this.pool) {
      await this.pool.end();
    }
  }

  async query(text, params = []) {
    return (this.client ?? this.pool).query(text, params);
  }
}

function mapDeviceRow(row) {
    return {
      deviceId: row.device_id,
      publicKeyRaw: Buffer.from(row.public_key_raw, "hex"),
      lorawanDevEui: row.lorawan_dev_eui,
      wallet: row.wallet,
    lastNonce: row.last_nonce === null ? null : Number(row.last_nonce),
    autoMintEnabled: row.auto_mint_enabled,
    autoMintIntervalSeconds: row.auto_mint_interval_seconds,
    registeredAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function mapTokenRow(row) {
  return {
    tick: row.tick.trim(),
    createdByDeviceId: row.created_by_device_id,
    maxSupply: BigInt(row.max_supply),
    limitPerMint: BigInt(row.limit_per_mint),
    totalSupply: BigInt(row.total_supply),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function mapEventRow(row) {
  return {
    id: row.event_id,
    status: row.status,
    rejectionReason: row.rejection_reason,
    deviceId: row.device_id,
    op: row.op,
    opName: OP_NAMES[row.op] ?? "UNKNOWN",
    tick: row.tick?.trim() ?? null,
    amount: row.amount === null ? null : BigInt(row.amount),
    maxSupply: row.max_supply === null ? null : BigInt(row.max_supply),
    limitPerMint: row.limit_per_mint === null ? null : BigInt(row.limit_per_mint),
    nonce: row.nonce === null ? null : Number(row.nonce),
    recipientDeviceId: row.recipient_device_id,
    config: row.config,
    payloadHex: row.payload_hex,
    signatureHex: row.signature_hex,
    payloadDigest: row.payload_digest,
    networkMetadata: row.network_metadata,
    receivedAt: toIsoString(row.received_at),
    createdAt: toIsoString(row.created_at)
  };
}

function toIsoString(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function stringifyBigIntOrNull(value) {
  return value === null || value === undefined ? null : value.toString();
}
