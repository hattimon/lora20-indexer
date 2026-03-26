import { createHash } from "node:crypto";
import { MalformedPayloadError } from "../protocol/errors.js";

export function deriveDeviceId(publicKeyRaw, bytes = 8) {
  return createHash("sha256").update(publicKeyRaw).digest().subarray(0, bytes).toString("hex");
}

export function normalizeDeviceId(deviceId, bytes = 8) {
  return normalizeHexIdentifier(deviceId, {
    bytes,
    fieldName: "deviceId"
  });
}

export function normalizeDevEui(devEui, bytes = 8) {
  return normalizeHexIdentifier(devEui, {
    bytes,
    fieldName: "lorawanDevEui"
  });
}

function normalizeHexIdentifier(value, { bytes, fieldName }) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";

  if (!/^[0-9a-f]+$/.test(normalized) || normalized.length !== bytes * 2) {
    throw new MalformedPayloadError(`${fieldName} must be ${bytes} bytes of lowercase hex`);
  }

  return normalized;
}
