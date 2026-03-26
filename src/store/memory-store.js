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

  async registerDevice({ deviceId, publicKeyRaw, wallet = null }) {
    if (this.devices.has(deviceId)) {
      throw new RuleViolationError(`Device ${deviceId} is already registered`, "device_already_registered");
    }

    const now = new Date().toISOString();
    const device = {
      deviceId,
      publicKeyRaw: Buffer.from(publicKeyRaw),
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

  async saveDevice(device) {
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

  async saveToken(token) {
    token.updatedAt = new Date().toISOString();
    this.tokens.set(token.tick, token);
    return token;
  }

  async getBalance(deviceId, tick) {
    return this.balances.get(balanceKey(deviceId, tick)) ?? 0n;
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
