import { createServer } from "node:http";
import { isChirpStackUplinkEvent, parseChirpStackUplink, assertChirpStackWebhookAuthorized } from "./chirpstack.js";
import { serializeBalanceEntry, serializeDevice, serializeEvent, serializeToken } from "../domain/serializers.js";
import { bigintJsonReplacer } from "../protocol/encoding.js";
import { AppError, MalformedPayloadError } from "../protocol/errors.js";

export function createRequestHandler({ service, logger = console, chirpstackWebhookToken = "", corsAllowedOrigins = [] }) {
  return async function requestHandler(req, res) {
    try {
      const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
      const pathSegments = url.pathname.split("/").filter(Boolean);
      const corsHeaders = buildCorsHeaders(req.headers.origin, corsAllowedOrigins);

      if (req.method === "OPTIONS") {
        return sendEmpty(res, 204, corsHeaders);
      }

      if (req.method === "GET" && url.pathname === "/health") {
        return sendJson(res, 200, await service.health(), corsHeaders);
      }

      if (req.method === "POST" && url.pathname === "/devices/register") {
        const body = await readJson(req);
        const device = await service.registerDevice(body);
        return sendJson(res, 201, { device: serializeDevice(device) }, corsHeaders);
      }

      if (req.method === "POST" && url.pathname === "/uplinks") {
        const body = await readJson(req);
        const result = await service.ingestUplink(body);
        return sendJson(res, 202, {
          status: result.status,
          event: serializeEvent(result.event)
        }, corsHeaders);
      }

      if (req.method === "POST" && url.pathname === "/integrations/chirpstack") {
        assertChirpStackWebhookAuthorized({
          req,
          url,
          expectedToken: chirpstackWebhookToken
        });

        const body = await readJson(req);
        if (!isChirpStackUplinkEvent(body)) {
          return sendJson(res, 202, {
            status: "ignored",
            reason: "unsupported_chirpstack_event"
          }, corsHeaders);
        }

        const uplink = parseChirpStackUplink(body);
        const device = await service.getDeviceByLorawanDevEui(uplink.lorawanDevEui);

        if (!device) {
          return sendJson(res, 404, {
            error: {
              code: "lorawan_device_not_linked",
              message: `No registered device is linked to LoRaWAN DevEUI ${uplink.lorawanDevEui}`
            }
          }, corsHeaders);
        }

        const result = await service.ingestUplink({
          deviceId: device.deviceId,
          payload: uplink.payload,
          receivedAt: uplink.receivedAt,
          networkMetadata: uplink.networkMetadata
        });

        return sendJson(res, 202, {
          status: result.status,
          event: serializeEvent(result.event)
        }, corsHeaders);
      }

      if (req.method === "PUT" && pathSegments.length === 3 && pathSegments[0] === "devices" && pathSegments[2] === "lorawan") {
        const body = await readJson(req);
        const device = await service.linkLorawanDevEui(pathSegments[1], body.devEui ?? body.lorawanDevEui);
        return sendJson(res, 200, { device: serializeDevice(device) }, corsHeaders);
      }

      if (req.method === "GET" && pathSegments.length === 3 && pathSegments[0] === "devices" && pathSegments[2] === "balances") {
        const limit = url.searchParams.get("limit");
        const parsedLimit = limit === null ? undefined : Number.parseInt(limit, 10);
        const balances = await service.listBalancesForDevice(pathSegments[1], {
          limit: Number.isNaN(parsedLimit) ? undefined : parsedLimit
        });

        return sendJson(res, 200, {
          deviceId: pathSegments[1].toLowerCase(),
          balances: balances.map(serializeBalanceEntry)
        }, corsHeaders);
      }

      if (req.method === "GET" && pathSegments.length === 1 && pathSegments[0] === "tokens") {
        const limit = url.searchParams.get("limit");
        const parsedLimit = limit === null ? undefined : Number.parseInt(limit, 10);
        const tokens = await service.listTokens({
          search: url.searchParams.get("search") ?? undefined,
          limit: Number.isNaN(parsedLimit) ? undefined : parsedLimit
        });

        return sendJson(res, 200, {
          tokens: tokens.map(serializeToken)
        }, corsHeaders);
      }

      if (req.method === "GET" && pathSegments.length === 2 && pathSegments[0] === "tokens") {
        const token = await service.getToken(pathSegments[1]);

        if (!token) {
          return sendJson(res, 404, {
            error: {
              code: "token_not_found",
              message: `Token ${pathSegments[1].toUpperCase()} was not found`
            }
          }, corsHeaders);
        }

        return sendJson(res, 200, { token: serializeToken(token) }, corsHeaders);
      }

      if (req.method === "GET" && pathSegments.length === 3 && pathSegments[0] === "balances") {
        const [_, deviceId, tick] = pathSegments;
        const balance = await service.getBalance(deviceId, tick);
        return sendJson(res, 200, {
          deviceId: deviceId.toLowerCase(),
          tick: tick.toUpperCase(),
          balance: balance.toString()
        }, corsHeaders);
      }

      if (req.method === "GET" && url.pathname === "/transactions") {
        const limit = url.searchParams.get("limit");
        const parsedLimit = limit === null ? undefined : Number.parseInt(limit, 10);
        const transactions = await service.listTransactions({
          deviceId: url.searchParams.get("deviceId") ?? undefined,
          tick: url.searchParams.get("tick") ?? undefined,
          limit: Number.isNaN(parsedLimit) ? undefined : parsedLimit
        });

        return sendJson(res, 200, {
          transactions: transactions.map(serializeEvent)
        }, corsHeaders);
      }

      return sendJson(res, 404, {
        error: {
          code: "route_not_found",
          message: `No route for ${req.method} ${url.pathname}`
        }
      }, corsHeaders);
    } catch (error) {
      logger.error?.(error);
      const corsHeaders = buildCorsHeaders(req.headers.origin, corsAllowedOrigins);
      return sendError(res, error, corsHeaders);
    }
  };
}

export function createHttpServer({ service, logger = console, chirpstackWebhookToken = "", corsAllowedOrigins = [] }) {
  return createServer(createRequestHandler({ service, logger, chirpstackWebhookToken, corsAllowedOrigins }));
}

async function readJson(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (!chunks.length) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (_error) {
    throw new MalformedPayloadError("Request body must be valid JSON");
  }
}

function buildCorsHeaders(origin, allowedOrigins) {
  if (!allowedOrigins.length) {
    return {};
  }

  if (allowedOrigins.includes("*")) {
    return {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,PUT,OPTIONS",
      "access-control-allow-headers": "Content-Type, Authorization, X-ChirpStack-Token, X-API-Key",
      "access-control-max-age": "86400"
    };
  }

  if (origin && allowedOrigins.includes(origin)) {
    return {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET,POST,PUT,OPTIONS",
      "access-control-allow-headers": "Content-Type, Authorization, X-ChirpStack-Token, X-API-Key",
      "access-control-max-age": "86400",
      vary: "Origin"
    };
  }

  return {};
}

function sendEmpty(res, statusCode, headers = {}) {
  res.writeHead(statusCode, headers);
  res.end();
}

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload, bigintJsonReplacer, 2);
  res.writeHead(statusCode, {
    ...extraHeaders,
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

function sendError(res, error, extraHeaders = {}) {
  if (error instanceof AppError) {
    return sendJson(res, error.statusCode, {
      error: {
        code: error.code,
        message: error.message,
        details: error.details
      }
    }, extraHeaders);
  }

  return sendJson(res, 500, {
    error: {
      code: "internal_error",
      message: error instanceof Error ? error.message : "Unknown internal error"
    }
  }, extraHeaders);
}
