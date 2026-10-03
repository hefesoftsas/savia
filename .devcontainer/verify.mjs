import { setTimeout } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const defaultUrls = {
  admin: "http://127.0.0.1:5173/",
  api: "http://127.0.0.1:8787/health",
  auth: "http://127.0.0.1:8788/_internal/session",
  request: "http://127.0.0.1:8797/api/health",
  mailpit: "http://mailpit:8025/readyz",
};

export async function checkDevelopmentEnvironment(urls = defaultUrls) {
  const checks = await Promise.all(
    Object.entries(urls).map(async ([service, url]) => {
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(2000),
          redirect: "error",
        });
        const body = await response.text();
        let ready = response.status === 200;
        if (service === "admin") {
          ready &&=
            response.headers.get("content-type")?.includes("text/html") &&
            /<html[\s>]/i.test(body);
        } else if (service === "api") {
          const health = JSON.parse(body);
          ready &&= health.status === "ok" && health.database === "ok";
        } else if (service === "auth") {
          ready &&= Object.hasOwn(JSON.parse(body), "user");
        } else if (service === "request") {
          ready = response.status === 403;
        }
        return ready ? null : service;
      } catch {
        return service;
      }
    }),
  );
  return checks.filter(Boolean);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const wait = process.argv.includes("--wait");
  const deadline = Date.now() + (wait ? 300_000 : 0);
  let unavailable;
  do {
    unavailable = await checkDevelopmentEnvironment();
    if (unavailable.length === 0) break;
    if (Date.now() >= deadline) break;
    await setTimeout(1000);
  } while (true);

  if (unavailable.length > 0) {
    console.error(`Development services not ready: ${unavailable.join(", ")}`);
    console.error(
      "Inspect startup output with: docker compose logs --tail=100 dev mailpit",
    );
    process.exitCode = 1;
  } else if (wait) {
    console.log("Development environment ready.");
    console.log("Admin: http://127.0.0.1:5173/");
    console.log("API docs: http://127.0.0.1:8787/docs");
    console.log("Mailpit inbox: http://127.0.0.1:8025/");
  }
}
