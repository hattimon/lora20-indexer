import test from "node:test";
import assert from "node:assert/strict";
import { createHttpServer } from "../src/api/router.js";

function createStubService() {
  const captured = {
    devEuiLookups: [],
    ingested: [],
    linked: []
  };

  return {
    captured,
    service: {
      async health() {
        return { status: "ok", service: "lora20-indexer", store: "memory" };
      },
      async registerDevice() {
        throw new Error("not implemented in this test");
      },
      async getToken() {
        return null;
      },
      async getBalance() {
        return 0n;
      },
      async listTransactions() {
        return [];
      },
      async getDeviceByLorawanDevEui(devEui) {
        captured.devEuiLookups.push(devEui);
        return {
          deviceId: "cbbe9a389f75c9b6",
          publicKeyRaw: Buffer.alloc(32),
          lorawanDevEui: devEui,
          wallet: null,
          lastNonce: 2,
          autoMintEnabled: false,
          autoMintIntervalSeconds: null,
          registeredAt: "2026-03-26T00:00:00.000Z",
          updatedAt: "2026-03-26T00:00:00.000Z"
        };
      },
      async ingestUplink(input) {
        captured.ingested.push(input);
        return {
          status: "accepted",
          event: {
            id: "evt-1",
            status: "accepted",
            rejectionReason: null,
            op: 2,
            opName: "MINT",
            tick: "LORA",
            amount: 1n,
            maxSupply: null,
            limitPerMint: null,
            nonce: 3,
            deviceId: input.deviceId,
            recipientDeviceId: null,
            config: null,
            payloadHex: input.payload,
            signatureHex: "00".repeat(64),
            payloadDigest: "ab".repeat(32),
            networkMetadata: input.networkMetadata,
            receivedAt: input.receivedAt ?? "2026-03-26T23:41:24.000Z",
            createdAt: "2026-03-26T23:41:24.000Z"
          }
        };
      },
      async linkLorawanDevEui(deviceId, devEui) {
        captured.linked.push({ deviceId, devEui });
        return {
          deviceId,
          publicKeyRaw: Buffer.alloc(32),
          lorawanDevEui: devEui,
          wallet: null,
          lastNonce: null,
          autoMintEnabled: false,
          autoMintIntervalSeconds: null,
          registeredAt: "2026-03-26T00:00:00.000Z",
          updatedAt: "2026-03-26T00:00:00.000Z"
        };
      }
    }
  };
}

async function withServer(options, callback) {
  const server = createHttpServer(options);

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await callback(baseUrl);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test("routes a ChirpStack uplink to the cryptographic device linked by DevEUI", async () => {
  const { service, captured } = createStubService();

  await withServer({ service, logger: { error() {} } }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/integrations/chirpstack`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        time: "2026-03-26T23:41:24.000Z",
        deviceInfo: {
          devEui: "6982686000009070",
          deviceName: "heltec-v4-01",
          applicationName: "lora20"
        },
        devAddr: "780002c7",
        fCnt: 1,
        fPort: 1,
        dr: 5,
        data: "024c4f5241000000000000000100000003" + "ab".repeat(64)
      })
    });

    assert.equal(response.status, 202);

    const body = await response.json();
    assert.equal(body.status, "accepted");
    assert.equal(captured.devEuiLookups[0], "6982686000009070");
    assert.equal(captured.ingested[0].deviceId, "cbbe9a389f75c9b6");
    assert.equal(captured.ingested[0].networkMetadata.source, "chirpstack");
    assert.equal(captured.ingested[0].networkMetadata.lorawanDevEui, "6982686000009070");
    assert.equal(captured.ingested[0].networkMetadata.fPort, 1);
  });
});

test("ignores non-uplink ChirpStack events on the shared webhook endpoint", async () => {
  const { service, captured } = createStubService();

  await withServer({ service, logger: { error() {} } }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/integrations/chirpstack`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        deviceInfo: {
          devEui: "6982686000009070"
        },
        devAddr: "780002c7"
      })
    });

    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), {
      status: "ignored",
      reason: "unsupported_chirpstack_event"
    });
    assert.equal(captured.ingested.length, 0);
  });
});

test("requires the configured ChirpStack webhook token", async () => {
  const { service } = createStubService();

  await withServer(
    {
      service,
      logger: { error() {} },
      chirpstackWebhookToken: "secret-token"
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/integrations/chirpstack`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          deviceInfo: {
            devEui: "6982686000009070"
          },
          data: "00"
        })
      });

      assert.equal(response.status, 401);
      const body = await response.json();
      assert.equal(body.error.code, "invalid_webhook_token");
    }
  );
});

test("links a LoRaWAN DevEUI to an already registered device", async () => {
  const { service, captured } = createStubService();

  await withServer({ service, logger: { error() {} } }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/devices/cbbe9a389f75c9b6/lorawan`, {
      method: "PUT",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        devEui: "6982686000009070"
      })
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.device.deviceId, "cbbe9a389f75c9b6");
    assert.equal(body.device.lorawanDevEui, "6982686000009070");
    assert.deepEqual(captured.linked[0], {
      deviceId: "cbbe9a389f75c9b6",
      devEui: "6982686000009070"
    });
  });
});
