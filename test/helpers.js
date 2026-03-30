import { generateKeyPairSync, sign } from "node:crypto";
import { exportRawEd25519PublicKey } from "../src/crypto/ed25519.js";
import { deriveDeviceId } from "../src/domain/device-id.js";
import { encodePackedMessage } from "../src/protocol/chat-codec.js";
import { AUTO_MINT_ENABLED_FLAG, OP_CODES } from "../src/protocol/constants.js";

export function createDeviceIdentity() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicKeyRaw = exportRawEd25519PublicKey(publicKey);

  return {
    privateKey,
    publicKeyRaw,
    deviceId: deriveDeviceId(publicKeyRaw)
  };
}

export function buildDeployPayload({ tick, maxSupply, limitPerMint, nonce, privateKey }) {
  const payload = Buffer.alloc(1 + 4 + 8 + 8 + 4);
  payload.writeUInt8(OP_CODES.DEPLOY, 0);
  payload.write(tick, 1, 4, "ascii");
  payload.writeBigUInt64BE(BigInt(maxSupply), 5);
  payload.writeBigUInt64BE(BigInt(limitPerMint), 13);
  payload.writeUInt32BE(nonce, 21);

  return signPayload(payload, privateKey);
}

export function buildMintPayload({ tick, amount, nonce, privateKey }) {
  const payload = Buffer.alloc(1 + 4 + 8 + 4);
  payload.writeUInt8(OP_CODES.MINT, 0);
  payload.write(tick, 1, 4, "ascii");
  payload.writeBigUInt64BE(BigInt(amount), 5);
  payload.writeUInt32BE(nonce, 13);

  return signPayload(payload, privateKey);
}

export function buildTransferPayload({ tick, amount, nonce, recipientDeviceId, privateKey }) {
  const payload = Buffer.alloc(1 + 4 + 8 + 4 + 8);
  payload.writeUInt8(OP_CODES.TRANSFER, 0);
  payload.write(tick, 1, 4, "ascii");
  payload.writeBigUInt64BE(BigInt(amount), 5);
  payload.writeUInt32BE(nonce, 13);
  Buffer.from(recipientDeviceId, "hex").copy(payload, 17);

  return signPayload(payload, privateKey);
}

export function buildConfigPayload({ nonce, enabled, intervalSeconds, privateKey }) {
  const payload = Buffer.alloc(1 + 1 + 4 + 4);
  payload.writeUInt8(OP_CODES.CONFIG, 0);
  payload.writeUInt8(enabled ? AUTO_MINT_ENABLED_FLAG : 0x00, 1);
  payload.writeUInt32BE(intervalSeconds, 2);
  payload.writeUInt32BE(nonce, 6);

  return signPayload(payload, privateKey);
}

export function buildMessagePayload({ recipientDeviceId, text, nonce, privateKey }) {
  const { charCount, packed } = encodePackedMessage(text);
  const payload = Buffer.alloc(1 + 8 + 4 + 1 + packed.length);
  payload.writeUInt8(OP_CODES.MESSAGE, 0);
  Buffer.from(recipientDeviceId, "hex").copy(payload, 1);
  payload.writeUInt32BE(nonce, 9);
  payload.writeUInt8(charCount, 13);
  packed.copy(payload, 14);

  return signPayload(payload, privateKey);
}

function signPayload(unsignedPayload, privateKey) {
  const signature = sign(null, unsignedPayload, privateKey);
  return Buffer.concat([unsignedPayload, signature]);
}
