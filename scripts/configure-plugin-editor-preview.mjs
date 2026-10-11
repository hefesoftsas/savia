import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const EXPECTED_HOST =
  /^savia-plugin-editor-preview\.[a-z0-9-]+\.workers\.dev$/i;
const READINESS_PATH = "/plugin-editor";

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
}) {
  if (!githubEnvPath) throw new Error("GITHUB_ENV is required");
  const origin = validateDeploymentUrl(deploymentUrl);
  const readinessUrl = new URL(READINESS_PATH, origin);
  const response = await fetchImpl(readinessUrl, { redirect: "error" });

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
