// Only known independent publications overlap. Auth initialization is a
// barrier; Request needs Hook Executor, Connectors needs Request, and the
// API and public gateway are published after their providers.
const groups = [
  ["auth"],
  ["auth-init"],
  ["mcp", "hookExecutor", "pluginEditor"],
  ["editor-verify"],
  ["flows", "request"],
  ["connectors"],
  ["api"],
  ["gateway"],
];
const workers = new Set(groups.flat().filter((name) => !name.includes("-")));
function identity(step) {
  if (
    step.kind === "wrangler" &&
    step.args?.[0] === "deploy" &&
    workers.has(step.worker)
  )
    return step.worker;
  if (
    step.kind === "node" &&
    step.script === "scripts/initialize-auth-deployment.mjs"
  )
    return "auth-init";
  if (step.kind === "plugin-editor-verify") return "editor-verify";
}

export async function runStandardDeploy(steps, execute, environment) {
  const ids = steps.map(identity);
  if (
    environment !== "preview" ||
    ids.includes(undefined) ||
    new Set(ids).size !== ids.length
  ) {
    for (const step of steps) await execute(step);
    return;
  }
  const byId = new Map(steps.map((step, index) => [ids[index], step]));
  for (const group of groups) {
    const batch = group.filter((id) => byId.has(id)).map((id) => byId.get(id));
    for (let index = 0; index < batch.length; index += 2) {
      // Do not begin rollback while a sibling publication is still running.
      const results = await Promise.allSettled(
        batch
          .slice(index, index + 2)
          .map((step) => Promise.resolve().then(() => execute(step))),
      );
      const failure = results.find((result) => result.status === "rejected");
      if (failure) throw failure.reason;
    }
  }
}
