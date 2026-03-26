import { createPublicKey, verify } from "node:crypto";
import { MalformedPayloadError } from "../protocol/errors.js";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function verifyEd25519Signature({ publicKeyRaw, payload, signature }) {
  const keyObject = createPublicKey({
    key: spkiDerFromRawEd25519PublicKey(publicKeyRaw),
    format: "der",
    type: "spki"
  });

  return verify(null, payload, keyObject, signature);
}

export function spkiDerFromRawEd25519PublicKey(publicKeyRaw) {
  const rawKey = Buffer.from(publicKeyRaw);

  if (rawKey.length !== 32) {
    throw new MalformedPayloadError(`Ed25519 public key must be 32 bytes, got ${rawKey.length}`);
  }

  return Buffer.concat([ED25519_SPKI_PREFIX, rawKey]);
}

export function exportRawEd25519PublicKey(keyObject) {
  const der = Buffer.from(
    keyObject.export({
      format: "der",
      type: "spki"
    })
  );

  return der.subarray(-32);
}
