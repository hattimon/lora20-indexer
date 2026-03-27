import { createHttpServer } from "./api/router.js";
import { IndexerService } from "./domain/indexer-service.js";
import { createStoreFromEnv } from "./store/create-store.js";

function parseCsv(value) {
  return String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const host = process.env.HOST ?? "0.0.0.0";
const chirpstackWebhookToken = process.env.CHIRPSTACK_WEBHOOK_TOKEN ?? "";
const corsAllowedOrigins = parseCsv(process.env.CORS_ALLOWED_ORIGINS ?? "");
const effectiveCorsAllowedOrigins = corsAllowedOrigins.length
  ? corsAllowedOrigins
  : [
      "https://hattimon.github.io",
      "https://lora20.hattimon.pl",
      "http://localhost:8080",
      "http://127.0.0.1:8080"
    ];
const store = await createStoreFromEnv(process.env);
const service = new IndexerService({ store });
const server = createHttpServer({
  service,
  logger: console,
  chirpstackWebhookToken,
  corsAllowedOrigins: effectiveCorsAllowedOrigins
});

server.listen(port, host, () => {
  console.log(`lora20 indexer listening on http://${host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    console.log(`received ${signal}, shutting down`);
    server.close((error) => {
      if (error) {
        console.error("graceful shutdown failed", error);
        process.exit(1);
      }

      Promise.resolve(store.close?.())
        .then(() => process.exit(0))
        .catch((closeError) => {
          console.error("store shutdown failed", closeError);
          process.exit(1);
        });
    });
  });
}
