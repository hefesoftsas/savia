import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const EXPECTED_HOST =
  /^savia-plugin-editor-preview\.[a-z0-9-]+\.workers\.dev$/i;
const READINESS_PATH = "/plugin-editor";
const READINESS_ATTEMPTS = 12;
const READINESS_RETRY_DELAY_MS = 2500;
const READINESS_FETCH_TIMEOUT_MS = 5000;
const RETRYABLE_READINESS_STATUSES = new Set([404, 502, 503, 504]);

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchReadiness(url, fetchImpl, sleepImpl) {
  let lastNetworkError;
  for (let attempt = 1; attempt <= READINESS_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      READINESS_FETCH_TIMEOUT_MS,
    );
    let response;
    try {
      response = await fetchImpl(url, {
        redirect: "error",
        signal: controller.signal,
      });
    } catch (error) {
      lastNetworkError = error;
      if (attempt === READINESS_ATTEMPTS) {
        throw new Error(
          `Plugin editor runtime readiness request failed after ${attempt} attempts: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    } finally {
      clearTimeout(timeout);
    }

    if (response) {
      if (!RETRYABLE_READINESS_STATUSES.has(response.status)) return response;
      if (attempt === READINESS_ATTEMPTS) {
        throw new Error(
          `Plugin editor runtime readiness returned HTTP ${response.status} after ${attempt} attempts`,
        );
      }
    }

    await sleepImpl(READINESS_RETRY_DELAY_MS);
  }
  throw new Error(
    `Plugin editor runtime readiness request failed: ${String(lastNetworkError)}`,
  );
}

export function validateDeploymentUrl(value) {
  if (typeof value !== "string" || value.length > 512) {
    throw new Error("Missing or invalid plugin editor deployment URL");
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      "Plugin editor deployment URL must be an absolute HTTPS URL",
    );
  }

  if (
    url.protocol !== "https:" ||
    !EXPECTED_HOST.test(url.hostname) ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "Plugin editor deployment URL is outside the approved preview workers.dev origin",
    );
  }

  return url;
}

export async function configurePluginEditorPreview({
  deploymentUrl,
  githubEnvPath,
  fetchImpl = fetch,
  sleepImpl = sleep,
}) {
  if (!githubEnvPath) throw new Error("GITHUB_ENV is required");
  const origin = validateDeploymentUrl(deploymentUrl);
  const readinessUrl = new URL(READINESS_PATH, origin);
  const response = await fetchReadiness(readinessUrl, fetchImpl, sleepImpl);

  if (!response.ok) {
    throw new Error(
      `Plugin editor runtime readiness returned HTTP ${response.status}`,
    );
  }
  if (response.url && new URL(response.url).origin !== origin.origin) {
    throw new Error("Plugin editor runtime readiness changed origin");
  }

  const contentType = response.headers.get("content-type") ?? "";
  const csp = response.headers.get("content-security-policy") ?? "";
  if (!contentType.toLowerCase().includes("text/html")) {
    throw new Error("Plugin editor runtime readiness did not return HTML");
  }
  if (!csp.includes("default-src 'none'") || !csp.includes("frame-ancestors")) {
    throw new Error(
      "Plugin editor runtime readiness is missing its isolation policy",
    );
  }
  if (response.headers.has("set-cookie")) {
    throw new Error("Plugin editor runtime must not set cookies");
  }

  const configuredUrl = new URL(READINESS_PATH, origin).toString();
  appendFileSync(
    githubEnvPath,
    `VITE_PLUGIN_EDITOR_RUNTIME_URL=${configuredUrl}\n`,
    {
      encoding: "utf8",
      mode: 0o600,
    },
  );
  return configuredUrl;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const configuredUrl = await configurePluginEditorPreview({
      deploymentUrl: process.env.PLUGIN_EDITOR_DEPLOYMENT_URL,
      githubEnvPath: process.env.GITHUB_ENV,
    });
    console.log(`Plugin editor runtime is ready at ${configuredUrl}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
