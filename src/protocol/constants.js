export const OP_CODES = Object.freeze({
  DEPLOY: 0x01,
  MINT: 0x02,
  TRANSFER: 0x03,
  MESSAGE: 0x04,
  CONFIG: 0x10
});

export const OP_NAMES = Object.freeze({
  [OP_CODES.DEPLOY]: "DEPLOY",
  [OP_CODES.MINT]: "MINT",
  [OP_CODES.TRANSFER]: "TRANSFER",
  [OP_CODES.MESSAGE]: "MESSAGE",
  [OP_CODES.CONFIG]: "CONFIG"
});

export const LENGTHS = Object.freeze({
  OP: 1,
  TICK: 4,
  AMOUNT: 8,
  NONCE: 4,
  DEVICE_ID: 8,
  MESSAGE_LENGTH: 1,
  FLAGS: 1,
  INTERVAL: 4,
  SIGNATURE: 64
});

export const AUTO_MINT_ENABLED_FLAG = 0x01;
export const VALID_TICK_REGEX = /^[A-Z0-9]{4}$/;
