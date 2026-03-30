import test from "node:test";
import assert from "node:assert/strict";
import { IndexerService } from "../src/domain/indexer-service.js";
import { AuthenticationError, ReplayDetectedError, RuleViolationError } from "../src/protocol/errors.js";
import { MemoryStore } from "../src/store/memory-store.js";
import {
  buildDeployPayload,
  buildMessagePayload,
  buildMintPayload,
  buildTransferPayload,
  createDeviceIdentity
} from "./helpers.js";

function createService() {
  return new IndexerService({ store: new MemoryStore() });
}

test("accepts a valid signed deploy uplink", async () => {
  const service = createService();
  const device = createDeviceIdentity();

  const registered = await service.registerDevice({
    publicKeyRaw: device.publicKeyRaw
  });

  const payload = buildDeployPayload({
    tick: "LORA",
    maxSupply: 1_000n,
    limitPerMint: 100n,
    nonce: 1,
    privateKey: device.privateKey
  });

  const result = await service.ingestUplink({
    deviceId: registered.deviceId,
    payload
  });

  assert.equal(result.status, "accepted");
  assert.equal((await service.getToken("LORA")).maxSupply, 1_000n);
});

test("rejects an uplink with an invalid signature", async () => {
  const service = createService();
  const device = createDeviceIdentity();
  const attacker = createDeviceIdentity();
  const registered = await service.registerDevice({
    publicKeyRaw: device.publicKeyRaw
  });

  const forgedPayload = buildDeployPayload({
    tick: "LORA",
    maxSupply: 1_000n,
    limitPerMint: 100n,
    nonce: 1,
    privateKey: attacker.privateKey
  });

  await assert.rejects(
    async () =>
      service.ingestUplink({
        deviceId: registered.deviceId,
        payload: forgedPayload
      }),
    AuthenticationError
  );
});

test("rejects a replayed nonce", async () => {
  const service = createService();
  const device = createDeviceIdentity();
  const registered = await service.registerDevice({
    publicKeyRaw: device.publicKeyRaw
  });

  const firstDeploy = buildDeployPayload({
    tick: "LORA",
    maxSupply: 1_000n,
    limitPerMint: 100n,
    nonce: 1,
    privateKey: device.privateKey
  });

  await service.ingestUplink({
    deviceId: registered.deviceId,
    payload: firstDeploy
  });

  await assert.rejects(
    async () =>
      service.ingestUplink({
        deviceId: registered.deviceId,
        payload: firstDeploy
      }),
    ReplayDetectedError
  );
});

test("rejects minting beyond max supply", async () => {
  const service = createService();
  const device = createDeviceIdentity();
  const registered = await service.registerDevice({
    publicKeyRaw: device.publicKeyRaw
  });

  await service.ingestUplink({
    deviceId: registered.deviceId,
    payload: buildDeployPayload({
      tick: "LORA",
      maxSupply: 100n,
      limitPerMint: 100n,
      nonce: 1,
      privateKey: device.privateKey
    })
  });

  await service.ingestUplink({
    deviceId: registered.deviceId,
    payload: buildMintPayload({
      tick: "LORA",
      amount: 60n,
      nonce: 2,
      privateKey: device.privateKey
    })
  });

  await assert.rejects(
    async () =>
      service.ingestUplink({
        deviceId: registered.deviceId,
        payload: buildMintPayload({
          tick: "LORA",
          amount: 50n,
          nonce: 3,
          privateKey: device.privateKey
        })
      }),
    (error) => {
      assert.ok(error instanceof RuleViolationError);
      assert.equal(error.code, "max_supply_exceeded");
      return true;
    }
  );
});

test("rejects transfers when sender balance is insufficient", async () => {
  const service = createService();
  const sender = createDeviceIdentity();
  const recipient = createDeviceIdentity();
  const senderRegistered = await service.registerDevice({
    publicKeyRaw: sender.publicKeyRaw
  });
  await service.registerDevice({
    publicKeyRaw: recipient.publicKeyRaw
  });

  await service.ingestUplink({
    deviceId: senderRegistered.deviceId,
    payload: buildDeployPayload({
      tick: "LORA",
      maxSupply: 100n,
      limitPerMint: 100n,
      nonce: 1,
      privateKey: sender.privateKey
    })
  });

  await service.ingestUplink({
    deviceId: senderRegistered.deviceId,
    payload: buildMintPayload({
      tick: "LORA",
      amount: 10n,
      nonce: 2,
      privateKey: sender.privateKey
    })
  });

  await assert.rejects(
    async () =>
      service.ingestUplink({
        deviceId: senderRegistered.deviceId,
        payload: buildTransferPayload({
          tick: "LORA",
          amount: 50n,
          nonce: 3,
          recipientDeviceId: recipient.deviceId,
          privateKey: sender.privateKey
        })
      }),
    (error) => {
      assert.ok(error instanceof RuleViolationError);
      assert.equal(error.code, "insufficient_balance");
      return true;
    }
  );
});

test("accepts compact chat messages and keeps them out of transaction history", async () => {
  const service = createService();
  const sender = createDeviceIdentity();
  const recipient = createDeviceIdentity();
  const senderRegistered = await service.registerDevice({
    publicKeyRaw: sender.publicKeyRaw
  });
  const recipientRegistered = await service.registerDevice({
    publicKeyRaw: recipient.publicKeyRaw
  });

  await service.ingestUplink({
    deviceId: senderRegistered.deviceId,
    payload: buildMessagePayload({
      recipientDeviceId: recipientRegistered.deviceId,
      text: "halo mini-burlap",
      nonce: 1,
      privateKey: sender.privateKey
    })
  });

  const history = await service.listTransactions({ deviceId: senderRegistered.deviceId, limit: 10 });
  const messages = await service.listMessages({
    deviceId: senderRegistered.deviceId,
    peerDeviceId: recipientRegistered.deviceId,
    limit: 10
  });

  assert.equal(history.length, 0);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].opName, "MESSAGE");
  assert.equal(messages[0].recipientDeviceId, recipientRegistered.deviceId);
  assert.equal(messages[0].config.messageText, "halo mini-burlap");
});
