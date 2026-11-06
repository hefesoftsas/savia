import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

// Verify public DNS/TLS first. Bot challenges are not application health evidence.
const publicResponse = await fetch(
  "https://savia-preview.hefesoft.com/health",
  {
    headers: { "User-Agent": "SaviaPreviewHealthCheck/1.0" },
    signal: AbortSignal.timeout(30_000),
    redirect: "error",
  },
);
if (
  publicResponse.status === 403 &&
  publicResponse.headers.get("cf-mitigated") === "challenge"
) {
  console.log(
    "Public DNS/TLS reachable; Cloudflare bot challenge requires authenticated service verification.",
  );
} else {
  const health = await publicResponse.json();
  if (
    !publicResponse.ok ||
    health.status !== "ok" ||
    health.database !== "ok"
  ) {
    throw new Error("Public preview health check failed");
  }
  console.log("Public preview health verified.");
}

// A short-lived authenticated remote session can only read /health on preview.
// It publishes no Worker, routes, or public endpoint and cannot target production.
const child = spawn(
  "pnpm",
  [
    "--dir",
    "apps/api",
    "exec",
    "wrangler",
    "dev",
    "--remote",
    "--config",
    "../../scripts/preview-health/wrangler.jsonc",
    "--ip",
    "127.0.0.1",
    "--port",
    "18876",
    "--inspector-port",
    "0",
    "--show-interactive-dev-session=false",
  ],
  { detached: true, stdio: "ignore" },
);
let exited = false;
child.on("exit", () => {
  exited = true;
});
child.on("error", () => {
  exited = true;
});
try {
  let verified = false;
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline && !exited) {
    try {
      const response = await fetch("http://127.0.0.1:18876/health", {
        signal: AbortSignal.timeout(5_000),
        redirect: "error",
      });
      const health = await response.json();
      if (response.ok && health.status === "ok" && health.database === "ok") {
        verified = true;
        break;
      }
    } catch {
      /* Remote session may still be starting. */
    }
    await delay(2_000);
  }
  if (!verified || exited)
    throw new Error(
      "Authenticated preview gateway/database verification failed",
    );
  console.log(
    "Deployed preview gateway and database verified through authenticated service binding.",
  );
} finally {
  if (child.pid) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      /* Already stopped. */
    }
  }
}
