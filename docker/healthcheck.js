const port = process.env.PORT ?? "3000";
const host = process.env.HEALTHCHECK_HOST ?? "127.0.0.1";
const url = `http://${host}:${port}/health`;

try {
  const response = await fetch(url, {
    headers: {
      accept: "application/json"
    }
  });

  if (!response.ok) {
    process.exit(1);
  }

  const body = await response.json();
  if (body.status !== "ok") {
    process.exit(1);
  }

  process.exit(0);
} catch (_error) {
  process.exit(1);
}
