import { createHttpServer } from "./api/router.js";
import { IndexerService } from "./domain/indexer-service.js";
import { createStoreFromEnv } from "./store/create-store.js";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const host = process.env.HOST ?? "0.0.0.0";
const store = await createStoreFromEnv(process.env);
const service = new IndexerService({ store });
const server = createHttpServer({ service, logger: console });

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
