import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { parseReplacementArgs } from "../infra/cloudflare/replacement-state.mjs";

const execFileAsync = promisify(execFile);

export async function runWrangler(...args) {
  return execFileAsync(
    "pnpm",
    ["--filter", "@savia/api", "exec", "wrangler", ...args],
    { cwd: process.cwd() },
  );
}

export async function runReplacement(
  command,
  { apply, run = runWrangler } = {},
) {
  if (command !== "inventory" && !apply)
    throw new Error(`${command} requires --apply`);

  if (command === "inventory") {
    const commands = [
      ["deployments", "status", "--name", "savia"],
      ["d1", "list"],
      ["r2", "bucket", "list"],
      ["kv", "namespace", "list"],
      ["queues", "list"],
      ["pages", "project", "list"],
    ];
    const results = [];
    for (const args of commands) results.push(await run(...args));
    return results;
  }

  throw new Error(`Replacement command ${command} is not implemented yet`);
}

async function main() {
  const parsed = parseReplacementArgs(process.argv.slice(2));
  const results = await runReplacement(parsed.command, parsed);
  process.stdout.write(
    `${JSON.stringify({ command: parsed.command, results })}\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
