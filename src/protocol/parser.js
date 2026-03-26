import { AUTO_MINT_ENABLED_FLAG, LENGTHS, OP_CODES, OP_NAMES, VALID_TICK_REGEX } from "./constants.js";
import { MalformedPayloadError } from "./errors.js";

export function parsePayload(input) {
  const payload = Buffer.isBuffer(input) ? Buffer.from(input) : Buffer.from(input);

  if (payload.length < LENGTHS.OP + LENGTHS.SIGNATURE) {
    throw new MalformedPayloadError("Payload is too short");
  }

  const op = payload.readUInt8(0);
  const signatureOffset = payload.length - LENGTHS.SIGNATURE;
  const unsignedPayload = payload.subarray(0, signatureOffset);
  const signature = payload.subarray(signatureOffset);

  switch (op) {
    case OP_CODES.DEPLOY:
      assertLength(payload, LENGTHS.OP + LENGTHS.TICK + LENGTHS.AMOUNT + LENGTHS.AMOUNT + LENGTHS.NONCE + LENGTHS.SIGNATURE);
      return {
        op,
        opName: OP_NAMES[op],
        tick: parseTick(payload.subarray(1, 5)),
        maxSupply: payload.readBigUInt64BE(5),
        limitPerMint: payload.readBigUInt64BE(13),
        nonce: payload.readUInt32BE(21),
        signature: Buffer.from(signature),
        unsignedPayload: Buffer.from(unsignedPayload),
        payload
      };

    case OP_CODES.MINT:
      assertLength(payload, LENGTHS.OP + LENGTHS.TICK + LENGTHS.AMOUNT + LENGTHS.NONCE + LENGTHS.SIGNATURE);
      return {
        op,
        opName: OP_NAMES[op],
        tick: parseTick(payload.subarray(1, 5)),
        amount: payload.readBigUInt64BE(5),
        nonce: payload.readUInt32BE(13),
        signature: Buffer.from(signature),
        unsignedPayload: Buffer.from(unsignedPayload),
        payload
      };

    case OP_CODES.TRANSFER:
      assertLength(
        payload,
        LENGTHS.OP +
          LENGTHS.TICK +
          LENGTHS.AMOUNT +
          LENGTHS.NONCE +
          LENGTHS.DEVICE_ID +
          LENGTHS.SIGNATURE
      );

      return {
        op,
        opName: OP_NAMES[op],
        tick: parseTick(payload.subarray(1, 5)),
        amount: payload.readBigUInt64BE(5),
        nonce: payload.readUInt32BE(13),
        recipientDeviceId: payload.subarray(17, 25).toString("hex"),
        signature: Buffer.from(signature),
        unsignedPayload: Buffer.from(unsignedPayload),
        payload
      };

    case OP_CODES.CONFIG:
      assertLength(payload, LENGTHS.OP + LENGTHS.FLAGS + LENGTHS.INTERVAL + LENGTHS.NONCE + LENGTHS.SIGNATURE);

      return {
        op,
        opName: OP_NAMES[op],
        flags: payload.readUInt8(1),
        intervalSeconds: payload.readUInt32BE(2),
        nonce: payload.readUInt32BE(6),
        config: {
          autoMintEnabled: Boolean(payload.readUInt8(1) & AUTO_MINT_ENABLED_FLAG),
          autoMintIntervalSeconds: payload.readUInt32BE(2)
        },
        signature: Buffer.from(signature),
        unsignedPayload: Buffer.from(unsignedPayload),
        payload
      };

    default:
      throw new MalformedPayloadError(`Unsupported operation code: 0x${op.toString(16).padStart(2, "0")}`);
  }
}

function assertLength(payload, expectedLength) {
  if (payload.length !== expectedLength) {
    throw new MalformedPayloadError(`Expected ${expectedLength} bytes, received ${payload.length}`);
  }
}

function parseTick(buffer) {
  const tick = buffer.toString("ascii");

  if (!VALID_TICK_REGEX.test(tick)) {
    throw new MalformedPayloadError(`Invalid token ticker: ${tick}`);
  }

  return tick;
}
