import { createServer } from "node:http";
import { serializeDevice, serializeEvent, serializeToken } from "../domain/serializers.js";
import { bigintJsonReplacer } from "../protocol/encoding.js";
import { AppError, MalformedPayloadError } from "../protocol/errors.js";

export function createRequestHandler({ service, logger = console }) {
  return async function requestHandler(req, res) {
    try {
      const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
      const pathSegments = url.pathname.split("/").filter(Boolean);

      if (req.method === "GET" && url.pathname === "/health") {
        return sendJson(res, 200, await service.health());
      }

      if (req.method === "POST" && url.pathname === "/devices/register") {
        const body = await readJson(req);
        const device = await service.registerDevice(body);
        return sendJson(res, 201, { device: serializeDevice(device) });
      }

      if (req.method === "POST" && url.pathname === "/uplinks") {
        const body = await readJson(req);
        const result = await service.ingestUplink(body);
        return sendJson(res, 202, {
          status: result.status,
          event: serializeEvent(result.event)
        });
      }

      if (req.method === "GET" && pathSegments.length === 2 && pathSegments[0] === "tokens") {
        const token = await service.getToken(pathSegments[1]);

        if (!token) {
          return sendJson(res, 404, {
            error: {
              code: "token_not_found",
              message: `Token ${pathSegments[1].toUpperCase()} was not found`
            }
          });
        }

        return sendJson(res, 200, { token: serializeToken(token) });
      }

      if (req.method === "GET" && pathSegments.length === 3 && pathSegments[0] === "balances") {
        const [_, deviceId, tick] = pathSegments;
        const balance = await service.getBalance(deviceId, tick);
        return sendJson(res, 200, {
          deviceId: deviceId.toLowerCase(),
          tick: tick.toUpperCase(),
          balance: balance.toString()
        });
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
        });
      }

      return sendJson(res, 404, {
        error: {
          code: "route_not_found",
          message: `No route for ${req.method} ${url.pathname}`
        }
      });
    } catch (error) {
      logger.error?.(error);
      return sendError(res, error);
    }
  };
}

export function createHttpServer({ service, logger = console }) {
  return createServer(createRequestHandler({ service, logger }));
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

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, bigintJsonReplacer, 2);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

function sendError(res, error) {
  if (error instanceof AppError) {
    return sendJson(res, error.statusCode, {
      error: {
        code: error.code,
        message: error.message,
        details: error.details
      }
    });
  }

  return sendJson(res, 500, {
    error: {
      code: "internal_error",
      message: error instanceof Error ? error.message : "Unknown internal error"
    }
  });
}
