import { MalformedPayloadError } from "../protocol/errors.js";
import { MemoryStore } from "./memory-store.js";
import { PostgresStore } from "./postgres-store.js";

export async function createStoreFromEnv(env = process.env) {
  const backend = String(env.STORE_BACKEND ?? "memory").toLowerCase();

  switch (backend) {
    case "memory":
      return new MemoryStore();

    case "postgres":
      if (!env.DATABASE_URL) {
        throw new MalformedPayloadError("DATABASE_URL is required when STORE_BACKEND=postgres");
      }

      return PostgresStore.connect({
        connectionString: env.DATABASE_URL
      });

    default:
      throw new MalformedPayloadError(`Unsupported STORE_BACKEND: ${backend}`);
  }
}
