import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

// Wrangler's development-only scheduled-event endpoint; never a deployed API route.
export async function tickCrmSync(fetcher = fetch) {
  const response = await fetcher("http://127.0.0.1:8790/__scheduled", {
    signal: AbortSignal.timeout(25_000),
    redirect: "error",
  });
  if (!response.ok)
    throw new Error(`Local CRM scheduler: HTTP ${response.status}`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  let running = false;
  let failed = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await tickCrmSync();
      if (failed) console.info("Local CRM scheduler reconnected.");
      failed = false;
    } catch {
      if (!failed)
        console.warn("Local CRM scheduler waiting for the legacy API.");
      failed = true;
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, 60_000);
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => {
      clearInterval(timer);
      process.exit(0);
    });
}
