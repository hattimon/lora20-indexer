import { createHash, randomUUID } from "node:crypto";
import { verifyEd25519Signature } from "../crypto/ed25519.js";
import { OP_CODES } from "../protocol/constants.js";
import { decodeBinaryValue, hex } from "../protocol/encoding.js";
import {
  AuthenticationError,
  DeviceNotFoundError,
  MalformedPayloadError,
  ReplayDetectedError,
  RuleViolationError
} from "../protocol/errors.js";
import { parsePayload } from "../protocol/parser.js";
import { deriveDeviceId, normalizeDeviceId } from "./device-id.js";

export class IndexerService {
  constructor({ store }) {
    this.store = store;
  }

  get storeKind() {
    return this.store.kind;
  }

  async health() {
    await this.store.ping?.();

    return {
      status: "ok",
      service: "lora20-indexer",
      store: this.storeKind
    };
  }

  async registerDevice({ publicKeyRaw, wallet = null }) {
    const rawKey = decodeBinaryValue(publicKeyRaw, "publicKeyRaw", { expectedLength: 32 });
    const deviceId = deriveDeviceId(rawKey);

    return this.store.registerDevice({
      deviceId,
      publicKeyRaw: rawKey,
      wallet
    });
  }

  async ingestUplink({ deviceId, payload, receivedAt, networkMetadata = null }) {
    const normalizedDeviceId = normalizeDeviceId(deviceId);
    const payloadBuffer = decodeBinaryValue(payload, "payload");
    const resolvedReceivedAt = receivedAt ? new Date(receivedAt) : new Date();

    if (Number.isNaN(resolvedReceivedAt.getTime())) {
      throw new MalformedPayloadError("receivedAt must be a valid ISO-8601 timestamp");
    }

    let parsedMessage;

    try {
      const acceptedEvent = await this.store.withTransaction(async (tx) => {
        parsedMessage = parsePayload(payloadBuffer);
        const device = await tx.getDevice(normalizedDeviceId, { forUpdate: true });

        if (!device) {
          throw new DeviceNotFoundError(normalizedDeviceId);
        }

        if (
          !verifyEd25519Signature({
            publicKeyRaw: device.publicKeyRaw,
            payload: parsedMessage.unsignedPayload,
            signature: parsedMessage.signature
          })
        ) {
          throw new AuthenticationError();
        }

        this.assertFreshNonce(device, parsedMessage.nonce);

        return this.applyOperation({
          store: tx,
          device,
          parsedMessage,
          payloadBuffer,
          receivedAt: resolvedReceivedAt.toISOString(),
          networkMetadata
        });
      });

      return {
        status: "accepted",
        event: acceptedEvent
      };
    } catch (error) {
      if (parsedMessage) {
        await this.store.appendEvent(
          this.buildEvent({
            status: "rejected",
            rejectionReason: error.code ?? "ingest_rejected",
            deviceId: normalizedDeviceId,
            parsedMessage,
            payloadBuffer,
            receivedAt: resolvedReceivedAt.toISOString(),
            networkMetadata
          })
        );
      }

      throw error;
    }
  }

  async getToken(tick) {
    return (await this.store.getToken(String(tick).toUpperCase())) ?? null;
  }

  async getBalance(deviceId, tick) {
    return this.store.getBalance(normalizeDeviceId(deviceId), String(tick).toUpperCase());
  }

  async listTransactions({ deviceId, tick, limit }) {
    return this.store.listTransactions({
      deviceId: deviceId ? normalizeDeviceId(deviceId) : undefined,
      tick: tick ? String(tick).toUpperCase() : undefined,
      limit
    });
  }

  assertFreshNonce(device, nonce) {
    if (device.lastNonce !== null && nonce <= device.lastNonce) {
      throw new ReplayDetectedError(`Nonce ${nonce} is not greater than last accepted nonce ${device.lastNonce}`);
    }
  }

  async applyOperation({ store, device, parsedMessage, payloadBuffer, receivedAt, networkMetadata }) {
    switch (parsedMessage.op) {
      case OP_CODES.DEPLOY:
        return this.handleDeploy({ store, device, parsedMessage, payloadBuffer, receivedAt, networkMetadata });

      case OP_CODES.MINT:
        return this.handleMint({ store, device, parsedMessage, payloadBuffer, receivedAt, networkMetadata });

      case OP_CODES.TRANSFER:
        return this.handleTransfer({ store, device, parsedMessage, payloadBuffer, receivedAt, networkMetadata });

      case OP_CODES.CONFIG:
        return this.handleConfig({ store, device, parsedMessage, payloadBuffer, receivedAt, networkMetadata });

      default:
        throw new MalformedPayloadError(`Unsupported operation code: ${parsedMessage.op}`);
    }
  }

  async handleDeploy({ store, device, parsedMessage, payloadBuffer, receivedAt, networkMetadata }) {
    if (parsedMessage.maxSupply <= 0n) {
      throw new RuleViolationError("maxSupply must be greater than zero", "invalid_max_supply");
    }

    if (parsedMessage.limitPerMint <= 0n) {
      throw new RuleViolationError("limitPerMint must be greater than zero", "invalid_limit_per_mint");
    }

    if (parsedMessage.limitPerMint > parsedMessage.maxSupply) {
      throw new RuleViolationError("limitPerMint cannot exceed maxSupply", "invalid_limit_per_mint");
    }

    if (await store.getToken(parsedMessage.tick, { forUpdate: true })) {
      throw new RuleViolationError(`Token ${parsedMessage.tick} already exists`, "token_already_exists");
    }

    const now = new Date().toISOString();

    await store.createToken({
      tick: parsedMessage.tick,
      createdByDeviceId: device.deviceId,
      maxSupply: parsedMessage.maxSupply,
      limitPerMint: parsedMessage.limitPerMint,
      totalSupply: 0n,
      createdAt: now,
      updatedAt: now
    });

    device.lastNonce = parsedMessage.nonce;
    await store.saveDevice(device);

    return store.appendEvent(
      this.buildEvent({
        status: "accepted",
        deviceId: device.deviceId,
        parsedMessage,
        payloadBuffer,
        receivedAt,
        networkMetadata
      })
    );
  }

  async handleMint({ store, device, parsedMessage, payloadBuffer, receivedAt, networkMetadata }) {
    assertPositiveAmount(parsedMessage.amount);

    const token = await store.getToken(parsedMessage.tick, { forUpdate: true });

    if (!token) {
      throw new RuleViolationError(`Token ${parsedMessage.tick} does not exist`, "token_not_found");
    }

    if (parsedMessage.amount > token.limitPerMint) {
      throw new RuleViolationError("Mint amount exceeds per-mint limit", "mint_limit_exceeded");
    }

    if (token.totalSupply + parsedMessage.amount > token.maxSupply) {
      throw new RuleViolationError("Mint would exceed max supply", "max_supply_exceeded");
    }

    token.totalSupply += parsedMessage.amount;
    await store.saveToken(token);
    await store.addBalance(device.deviceId, token.tick, parsedMessage.amount);

    device.lastNonce = parsedMessage.nonce;
    await store.saveDevice(device);

    return store.appendEvent(
      this.buildEvent({
        status: "accepted",
        deviceId: device.deviceId,
        parsedMessage,
        payloadBuffer,
        receivedAt,
        networkMetadata
      })
    );
  }

  async handleTransfer({ store, device, parsedMessage, payloadBuffer, receivedAt, networkMetadata }) {
    assertPositiveAmount(parsedMessage.amount);

    const token = await store.getToken(parsedMessage.tick, { forUpdate: true });

    if (!token) {
      throw new RuleViolationError(`Token ${parsedMessage.tick} does not exist`, "token_not_found");
    }

    const recipientDevice = await store.getDevice(parsedMessage.recipientDeviceId);

    if (!recipientDevice) {
      throw new RuleViolationError(
        `Recipient device ${parsedMessage.recipientDeviceId} is not registered`,
        "recipient_not_found"
      );
    }

    const senderBalance = await store.getBalance(device.deviceId, token.tick);

    if (senderBalance < parsedMessage.amount) {
      throw new RuleViolationError("Insufficient balance", "insufficient_balance");
    }

    await store.addBalance(device.deviceId, token.tick, -parsedMessage.amount);
    await store.addBalance(recipientDevice.deviceId, token.tick, parsedMessage.amount);

    device.lastNonce = parsedMessage.nonce;
    await store.saveDevice(device);

    return store.appendEvent(
      this.buildEvent({
        status: "accepted",
        deviceId: device.deviceId,
        parsedMessage,
        payloadBuffer,
        receivedAt,
        networkMetadata
      })
    );
  }

  async handleConfig({ store, device, parsedMessage, payloadBuffer, receivedAt, networkMetadata }) {
    if (parsedMessage.config.autoMintEnabled && parsedMessage.config.autoMintIntervalSeconds <= 0) {
      throw new RuleViolationError(
        "CONFIG with auto-mint enabled requires intervalSeconds > 0",
        "invalid_config_interval"
      );
    }

    device.autoMintEnabled = parsedMessage.config.autoMintEnabled;
    device.autoMintIntervalSeconds = parsedMessage.config.autoMintEnabled
      ? parsedMessage.config.autoMintIntervalSeconds
      : null;
    device.lastNonce = parsedMessage.nonce;
    await store.saveDevice(device);

    return store.appendEvent(
      this.buildEvent({
        status: "accepted",
        deviceId: device.deviceId,
        parsedMessage,
        payloadBuffer,
        receivedAt,
        networkMetadata
      })
    );
  }

  buildEvent({ status, rejectionReason = null, deviceId, parsedMessage, payloadBuffer, receivedAt, networkMetadata }) {
    return {
      id: randomUUID(),
      status,
      rejectionReason,
      deviceId,
      op: parsedMessage.op,
      opName: parsedMessage.opName,
      tick: parsedMessage.tick ?? null,
      amount: parsedMessage.amount ?? parsedMessage.maxSupply ?? null,
      maxSupply: parsedMessage.maxSupply ?? null,
      limitPerMint: parsedMessage.limitPerMint ?? null,
      nonce: parsedMessage.nonce ?? null,
      recipientDeviceId: parsedMessage.recipientDeviceId ?? null,
      config: parsedMessage.config ?? null,
      payloadHex: hex(payloadBuffer),
      signatureHex: hex(parsedMessage.signature),
      networkMetadata,
      payloadDigest: createHash("sha256").update(payloadBuffer).digest("hex"),
      receivedAt,
      createdAt: new Date().toISOString()
    };
  }
}

function assertPositiveAmount(amount) {
  if (amount <= 0n) {
    throw new RuleViolationError("Amount must be greater than zero", "invalid_amount");
  }
}
