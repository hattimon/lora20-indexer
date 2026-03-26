import { MalformedPayloadError } from "./errors.js";

const HEX_PATTERN = /^[0-9a-fA-F]+$/;

export function decodeBinaryValue(value, fieldName, { expectedLength } = {}) {
  let buffer;

  if (Buffer.isBuffer(value)) {
    buffer = Buffer.from(value);
  } else if (value instanceof Uint8Array) {
    buffer = Buffer.from(value);
  } else if (typeof value === "string") {
    const trimmed = value.trim();

    if (!trimmed) {
      throw new MalformedPayloadError(`${fieldName} must not be empty`);
    }

    buffer =
      trimmed.length % 2 === 0 && HEX_PATTERN.test(trimmed)
        ? Buffer.from(trimmed, "hex")
        : Buffer.from(trimmed, "base64");
  } else {
    throw new MalformedPayloadError(
      `${fieldName} must be a Buffer, Uint8Array, hex string, or base64 string`
    );
  }

  if (expectedLength !== undefined && buffer.length !== expectedLength) {
    throw new MalformedPayloadError(
      `${fieldName} must be exactly ${expectedLength} bytes, got ${buffer.length}`
    );
  }

  return buffer;
}

export function hex(value) {
  return Buffer.from(value).toString("hex");
}

export function bigintJsonReplacer(_key, value) {
  return typeof value === "bigint" ? value.toString() : value;
}
