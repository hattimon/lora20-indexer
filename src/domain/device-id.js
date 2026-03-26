import { createHash } from "node:crypto";
import { MalformedPayloadError } from "../protocol/errors.js";

export function deriveDeviceId(publicKeyRaw, bytes = 8) {
  return createHash("sha256").update(publicKeyRaw).digest().subarray(0, bytes).toString("hex");
}

export function normalizeDeviceId(deviceId, bytes = 8) {
  const normalized = typeof deviceId === "string" ? deviceId.trim().toLowerCase() : "";

  if (!/^[0-9a-f]+$/.test(normalized) || normalized.length !== bytes * 2) {
    throw new MalformedPayloadError(`deviceId must be ${bytes} bytes of lowercase hex`);
  }

  return normalized;
}
