import { rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const localStateDirectories = [
  "apps/api/.wrangler/state",
  "apps/auth/.wrangler/state",
  "apps/savia-request/.wrangler/state",
];

export function resolveLocalStateReset(root = repository) {
  const resolvedRoot = resolve(root);
  return {
    root: resolvedRoot,
    targets: localStateDirectories.map((directory) =>
      resolve(resolvedRoot, directory),
    ),
  };
}

function assertLocalStateResetPlan(plan) {
  const expected = resolveLocalStateReset(plan.root).targets;
  if (
    !Array.isArray(plan.targets) ||
    plan.targets.length !== expected.length ||
    plan.targets.some((target, index) => target !== expected[index])
  )
    throw new Error("Local state reset plan contains an unsafe target.");
}

export async function resetLocalState(plan, { confirmed = false } = {}) {
  assertLocalStateResetPlan(plan);
  if (!confirmed) return { ...plan, deleted: false };

  for (const target of plan.targets)
    await rm(target, { recursive: true, force: true });
  return { ...plan, deleted: true };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const arguments_ = process.argv.slice(2);
  if (
    arguments_.some((argument) => argument !== "--confirm-local-reset") ||
    arguments_.filter((argument) => argument === "--confirm-local-reset")
      .length > 1
  )
    throw new Error(
      "Usage: node scripts/reset-savia-local-state.mjs [--confirm-local-reset]",
    );

  const plan = resolveLocalStateReset();
  console.log("Local Savia state reset plan:");
  for (const target of plan.targets) console.log(`- ${target}`);

  const result = await resetLocalState(plan, {
    confirmed: arguments_.includes("--confirm-local-reset"),
  });
  console.log(
    result.deleted
      ? "Deleted the local Savia runtime state above."
      : "Preview only. Pass --confirm-local-reset to delete these directories.",
  );
}
