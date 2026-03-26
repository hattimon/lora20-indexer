import { timingSafeEqual } from "node:crypto";
import { normalizeDevEui } from "../domain/device-id.js";
import { AppError, MalformedPayloadError } from "../protocol/errors.js";

export function isChirpStackUplinkEvent(body) {
  return Boolean(resolvePayload(body));
}

export function parseChirpStackUplink(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new MalformedPayloadError("ChirpStack webhook body must be a JSON object");
  }

  const rawDevEui = body.deviceInfo?.devEui ?? body.devEui ?? body.devEUI ?? null;
  const payload = resolvePayload(body);

  if (typeof rawDevEui !== "string" || !rawDevEui.trim()) {
    throw new MalformedPayloadError("ChirpStack uplink must include deviceInfo.devEui");
  }

  if (!payload) {
    throw new MalformedPayloadError("ChirpStack uplink must include data");
  }

  const lorawanDevEui = normalizeDevEui(rawDevEui);

  return {
    lorawanDevEui,
    payload,
    receivedAt: typeof body.time === "string" ? body.time : undefined,
    networkMetadata: buildNetworkMetadata(body, lorawanDevEui)
  };
}

export function assertChirpStackWebhookAuthorized({ req, url, expectedToken }) {
  const normalizedExpected = typeof expectedToken === "string" ? expectedToken.trim() : "";
  if (!normalizedExpected) {
    return;
  }

  const providedToken = extractProvidedToken(req, url);
  if (!providedToken || !tokensMatch(providedToken, normalizedExpected)) {
    throw new AppError("Invalid ChirpStack webhook token", {
      statusCode: 401,
      code: "invalid_webhook_token"
    });
  }
}

function resolvePayload(body) {
  const rawPayload = body?.data ?? body?.frmPayload ?? body?.payload ?? null;
  return typeof rawPayload === "string" && rawPayload.trim() ? rawPayload.trim() : null;
}

function buildNetworkMetadata(body, lorawanDevEui) {
  return {
    source: "chirpstack",
    integration: "http",
    lorawanDevEui,
    deduplicationId: body.deduplicationId ?? null,
    tenantId: body.deviceInfo?.tenantId ?? null,
    tenantName: body.deviceInfo?.tenantName ?? null,
    applicationId: body.deviceInfo?.applicationId ?? null,
    applicationName: body.deviceInfo?.applicationName ?? null,
    deviceName: body.deviceInfo?.deviceName ?? null,
    devAddr: body.devAddr ?? null,
    fCnt: body.fCnt ?? null,
    fPort: body.fPort ?? null,
    dr: body.dr ?? null,
    confirmed: body.confirmed ?? null,
    rxInfo: Array.isArray(body.rxInfo) ? body.rxInfo : [],
    txInfo: body.txInfo ?? null
  };
}

function extractProvidedToken(req, url) {
  const authorizationHeader = req.headers.authorization;
  if (typeof authorizationHeader === "string" && authorizationHeader.startsWith("Bearer ")) {
    return authorizationHeader.slice("Bearer ".length).trim();
  }

  const directHeader = req.headers["x-chirpstack-token"] ?? req.headers["x-api-key"];
  if (typeof directHeader === "string" && directHeader.trim()) {
    return directHeader.trim();
  }

  const queryToken = url.searchParams.get("token");
  return queryToken?.trim() || "";
}

function tokensMatch(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}
