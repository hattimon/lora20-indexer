export class AppError extends Error {
  constructor(message, { statusCode = 400, code = "app_error", details } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export class MalformedPayloadError extends AppError {
  constructor(message, details) {
    super(message, { statusCode: 400, code: "malformed_payload", details });
  }
}

export class DeviceNotFoundError extends AppError {
  constructor(deviceId) {
    super(`Unknown device: ${deviceId}`, {
      statusCode: 404,
      code: "device_not_found"
    });
  }
}

export class AuthenticationError extends AppError {
  constructor(message = "Signature verification failed") {
    super(message, { statusCode: 401, code: "invalid_signature" });
  }
}

export class ReplayDetectedError extends AppError {
  constructor(message = "Replay detected") {
    super(message, { statusCode: 409, code: "replay_detected" });
  }
}

export class RuleViolationError extends AppError {
  constructor(message, code = "rule_violation") {
    super(message, { statusCode: 422, code });
  }
}
