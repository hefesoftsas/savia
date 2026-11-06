import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execute = promisify(execFile);
const roles = ["auth", "api", "request", "connectors"];
const roots = {
  auth: "apps/auth/src/",
  api: "apps/api/src/",
  request: "apps/savia-request/src/",
  connectors: "apps/connector-gateway/src/",
};
// This lane deliberately excludes schema/configuration changes, including schema
// statements embedded in application source. Missing source/history means full.
const schema =
  /\b(?:CREATE\s+(?:(?:UNIQUE|TEMP|TEMPORARY|VIRTUAL)\s+)?(?:TABLE|INDEX|TRIGGER|VIEW)|ALTER\s+TABLE|DROP\s+(?:TABLE|INDEX|TRIGGER|VIEW)|getMigrations|betterAuth|createBetterAuth|oauthProvider)\b/i;
export function classifyPreviewCodeChanges(files) {
  const targets = new Set();
  for (const { path, before, after } of files) {
    if (/^(?:docs\/|.*\.(?:test|spec)\.[cm]?[jt]sx?$)/.test(path)) continue;
    if (
      before === null ||
      after === null ||
      schema.test(before) ||
      schema.test(after)
    )
      return null;
    // This package also owns the coordinator Durable Object implementation.
    // Updating only its four consumers would leave a mixed coordinator protocol.
    if (path === "packages/backup-gate/index.mjs") return null;
    const role = roles.find((role) => path.startsWith(roots[role]));
    if (
      !role ||
      !/\.[jt]sx?$/.test(path) ||
      /(?:^|\/)(?:index|env|config|schema|migration[^/]*)\.[jt]sx?$/.test(path)
    )
      return null;
    targets.add(role);
  }
  return targets.size ? roles.filter((role) => targets.has(role)) : null;
}
export async function derivePreviewCodeScope({
  base,
  head,
  cwd,
  run = execute,
}) {
  if (
    ![base, head].every((value) => /^[a-f\d]{40}$/.test(value ?? "")) ||
    base === head
  )
    return null;
  try {
    await run("git", ["merge-base", "--is-ancestor", base, head], { cwd });
    const { stdout } = await run(
      "git",
      ["diff", "--no-renames", "--name-only", base, head],
      { cwd },
    );
    const files = [];
    for (const path of stdout.trim().split("\n").filter(Boolean)) {
      if (path.includes(":") || path.startsWith("/")) return null;
      const before = (await run("git", ["show", `${base}:${path}`], { cwd }))
        .stdout;
      const after = (await run("git", ["show", `${head}:${path}`], { cwd }))
        .stdout;
      files.push({ path, before, after });
    }
    const targets = classifyPreviewCodeChanges(files);
    return targets ? { base, head, targets } : null;
  } catch {
    return null;
  }
}
