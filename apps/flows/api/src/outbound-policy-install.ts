import { env } from "cloudflare:workers";
import { guardedFetch } from "./services/outbound-policy";
import type { Bindings } from "./context";

// Installed once for this isolate. The platform env is immutable for its
// deployment, so concurrent requests cannot relax another request's policy.
// Private service bindings do not use global fetch and remain available.
globalThis.fetch = guardedFetch(
  globalThis.fetch.bind(globalThis),
  env as Pick<Bindings, "SAVIA_FLOWS_EXTERNAL_SERVICES_ENABLED">,
);
