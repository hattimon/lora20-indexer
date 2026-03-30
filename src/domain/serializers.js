import { hex } from "../protocol/encoding.js";

export function serializeDevice(device) {
  return {
    deviceId: device.deviceId,
    publicKeyRaw: hex(device.publicKeyRaw),
    lorawanDevEui: device.lorawanDevEui ?? null,
    wallet: device.wallet,
    lastNonce: device.lastNonce,
    autoMintEnabled: device.autoMintEnabled,
    autoMintIntervalSeconds: device.autoMintIntervalSeconds,
    registeredAt: device.registeredAt,
    updatedAt: device.updatedAt
  };
}

export function serializeToken(token) {
  return {
    tick: token.tick,
    createdByDeviceId: token.createdByDeviceId,
    maxSupply: token.maxSupply.toString(),
    limitPerMint: token.limitPerMint.toString(),
    totalSupply: token.totalSupply.toString(),
    createdAt: token.createdAt,
    updatedAt: token.updatedAt
  };
}

export function serializeBalanceEntry(entry) {
  return {
    tick: entry.tick,
    balance: entry.balance.toString(),
    token: entry.token ? serializeToken(entry.token) : null
  };
}

export function serializeEvent(event) {
  const messageText = typeof event.config?.messageText === "string" ? event.config.messageText : null;
  const messageCodec = typeof event.config?.messageCodec === "string" ? event.config.messageCodec : null;
  const messageLength = Number.isInteger(event.config?.messageLength) ? event.config.messageLength : null;
  const packedBytes = Number.isInteger(event.config?.packedBytes) ? event.config.packedBytes : null;
  const messageScope = typeof event.config?.messageScope === "string" ? event.config.messageScope : null;

  return {
    id: event.id,
    status: event.status,
    rejectionReason: event.rejectionReason,
    op: event.op,
    opName: event.opName,
    tick: event.tick,
    amount: event.amount === undefined || event.amount === null ? null : event.amount.toString(),
    maxSupply: event.maxSupply === undefined || event.maxSupply === null ? null : event.maxSupply.toString(),
    limitPerMint:
      event.limitPerMint === undefined || event.limitPerMint === null ? null : event.limitPerMint.toString(),
    nonce: event.nonce ?? null,
    deviceId: event.deviceId ?? null,
    recipientDeviceId: event.recipientDeviceId ?? null,
    config: event.config ?? null,
    messageText,
    messageCodec,
    messageLength,
    packedBytes,
    messageScope,
    payloadHex: event.payloadHex,
    signatureHex: event.signatureHex,
    payloadDigest: event.payloadDigest ?? null,
    networkMetadata: event.networkMetadata,
    receivedAt: event.receivedAt,
    createdAt: event.createdAt
  };
}
