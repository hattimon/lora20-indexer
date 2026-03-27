import { RuleViolationError } from "../protocol/errors.js";

function balanceKey(deviceId, tick) {
  return `${deviceId}:${tick}`;
}

export class MemoryStore {
  constructor() {
    this.kind = "memory";
    this.devices = new Map();
    this.tokens = new Map();
    this.balances = new Map();
    this.events = [];
  }

  async withTransaction(callback) {
    return callback(this);
  }

  async registerDevice({ deviceId, publicKeyRaw, wallet = null, lorawanDevEui = null }) {
    if (this.devices.has(deviceId)) {
      throw new RuleViolationError(`Device ${deviceId} is already registered`, "device_already_registered");
    }

    if (lorawanDevEui && Array.from(this.devices.values()).some((device) => device.lorawanDevEui === lorawanDevEui)) {
      throw new RuleViolationError(
        `LoRaWAN DevEUI ${lorawanDevEui} is already linked to another device`,
        "lorawan_dev_eui_already_registered"
      );
    }

    const now = new Date().toISOString();
    const device = {
      deviceId,
      publicKeyRaw: Buffer.from(publicKeyRaw),
      lorawanDevEui,
      wallet,
      lastNonce: null,
      autoMintEnabled: false,
      autoMintIntervalSeconds: null,
      registeredAt: now,
      updatedAt: now
    };

    this.devices.set(deviceId, device);
    return device;
  }

  async getDevice(deviceId) {
    return this.devices.get(deviceId) ?? null;
  }

  async getDeviceByLorawanDevEui(lorawanDevEui) {
    return Array.from(this.devices.values()).find((device) => device.lorawanDevEui === lorawanDevEui) ?? null;
  }

  async saveDevice(device) {
    if (
      device.lorawanDevEui &&
      Array.from(this.devices.values()).some(
        (candidate) => candidate.deviceId !== device.deviceId && candidate.lorawanDevEui === device.lorawanDevEui
      )
    ) {
      throw new RuleViolationError(
        `LoRaWAN DevEUI ${device.lorawanDevEui} is already linked to another device`,
        "lorawan_dev_eui_already_registered"
      );
    }

    device.updatedAt = new Date().toISOString();
    this.devices.set(device.deviceId, device);
    return device;
  }

  async createToken(token) {
    this.tokens.set(token.tick, token);
    return token;
  }

  async getToken(tick) {
    return this.tokens.get(tick) ?? null;
  }

  async listTokens({ search, limit = 100 } = {}) {
    const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 100;
    const normalizedSearch = search ? String(search).toUpperCase() : "";

    return Array.from(this.tokens.values())
      .filter((token) => !normalizedSearch || token.tick.startsWith(normalizedSearch))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.tick.localeCompare(right.tick))
      .slice(0, safeLimit);
  }

  async saveToken(token) {
    token.updatedAt = new Date().toISOString();
    this.tokens.set(token.tick, token);
    return token;
  }

  async getBalance(deviceId, tick) {
    return this.balances.get(balanceKey(deviceId, tick)) ?? 0n;
  }

  async listBalances(deviceId, { limit = 100 } = {}) {
    const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 100;

    return Array.from(this.balances.entries())
      .filter(([key, balance]) => key.startsWith(`${deviceId}:`) && balance !== 0n)
      .map(([key, balance]) => {
        const tick = key.slice(deviceId.length + 1);
        return {
          tick,
          balance,
          token: this.tokens.get(tick) ?? null
        };
      })
      .sort((left, right) => right.balance - left.balance || left.tick.localeCompare(right.tick))
      .slice(0, safeLimit);
  }

  async addBalance(deviceId, tick, delta) {
    const nextBalance = (this.balances.get(balanceKey(deviceId, tick)) ?? 0n) + BigInt(delta);
    this.balances.set(balanceKey(deviceId, tick), nextBalance);
    return nextBalance;
  }

  async appendEvent(event) {
    this.events.push(event);
    return event;
  }

  async listTransactions({ deviceId, tick, limit = 50 } = {}) {
    const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 50;

    return this.events
      .filter((event) => !deviceId || event.deviceId === deviceId || event.recipientDeviceId === deviceId)
      .filter((event) => !tick || event.tick === tick)
      .slice(-safeLimit)
      .reverse();
  }

  async ping() {}

  async close() {}
}
