import { join } from "node:path";
import { publishRuntime } from "./runtime-publisher.mjs";

export const CODE_ONLY_TARGETS = Object.freeze([
  "auth",
  "api",
  "request",
  "connectors",
  "gateway",
]);

const sha1 = (value) =>
  typeof value === "string" && /^[a-f\d]{40}$/.test(value);
const object = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export function codeOnlyReleaseCommands({
  releaseSource,
  environment,
  runtimeState,
  configs,
}) {
  if (!object(releaseSource) || !Object.hasOwn(releaseSource, "codeOnly"))
    return null;
  if (
    Object.keys(releaseSource).some(
      (key) => !["version", "sourceRevision", "codeOnly"].includes(key),
    ) ||
    releaseSource.version !== 1 ||
    !sha1(releaseSource.sourceRevision)
  )
    throw new Error("Invalid code-only release metadata");
  if (environment !== "preview")
    throw new Error("Code-only publication is only allowed in preview");
  if (runtimeState !== "active")
    throw new Error("Code-only publication requires an active runtime");

  const scope = releaseSource.codeOnly;
  if (
    !object(scope) ||
    Object.keys(scope).sort().join(",") !== "base,head,targets" ||
    !sha1(scope.base) ||
    !sha1(scope.head) ||
    scope.base === scope.head ||
    scope.head !== releaseSource.sourceRevision ||
    !Array.isArray(scope.targets) ||
    !scope.targets.length ||
    scope.targets.some(
      (target) =>
        typeof target !== "string" || !CODE_ONLY_TARGETS.includes(target),
    ) ||
    new Set(scope.targets).size !== scope.targets.length
  )
    throw new Error("Invalid code-only release scope");
  for (const target of scope.targets)
    if (typeof configs[target] !== "string")
      throw new Error("Code-only target is missing from the frozen artifact");

  const wrangler = (worker) => ({
    kind: "wrangler",
    worker,
    args: ["deploy", "--config", configs[worker]],
  });
  const deploy = [];
  for (const worker of CODE_ONLY_TARGETS)
    if (scope.targets.includes(worker)) {
      deploy.push(wrangler(worker));
      if (worker === "auth")
        deploy.push({
          kind: "node",
          script: "scripts/initialize-auth-deployment.mjs",
          args: ["--environment", environment, "--config", configs.auth],
        });
    }
  return {
    quiesce: [],
    backup: [],
    migrate: [],
    secrets: [],
    deploy,
    verify: [
      { kind: "node", script: "scripts/verify-preview-health.mjs", args: [] },
    ],
    resume: [],
  };
}

export function createCodeOnlyPublisher(
  inputs,
  plan,
  { env, root, run, runWrangler },
) {
  async function execute(step) {
    if (step.kind === "node")
      await run("node", [join(root, step.script), ...step.args], {
        cwd: root,
        env: { ...env, CLOUDFLARE_DATABASE_ID: env.SAVIA_DOMAIN_D1_ID },
      });
    else if (step.kind === "wrangler")
      await runWrangler(step.args, {
        env,
        cwd: inputs.artifactDirectory,
      });
    else throw new Error("Unsupported code-only release step");
  }
  const stage = async (steps) => {
    for (const step of steps) await execute(step);
  };
  return {
    publish: () =>
      publishRuntime(inputs, {
        quiesce: async () => {},
        backup: async () => {},
        migrate: async () => {},
        secrets: async () => {},
        deploy: () => stage(plan.deploy),
        verify: () => stage(plan.verify),
        resume: async () => {},
      }),
    recover: async () => {},
  };
}
