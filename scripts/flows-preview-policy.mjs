export function buildFlowsSecretUploads(environment, values) {
  if (!["preview", "production"].includes(environment))
    throw new Error("Invalid deployment environment");
  if (values.SAVIA_FLOWS_PROVISIONED !== "true") return [];
  const mapping = {
    SAVIA_FLOWS_BRIDGE_SECRET: "SAVIA_FLOWS_BRIDGE_SECRET",
    JWT_SECRET: "SAVIA_FLOWS_JWT_SECRET",
    SECRET_MASTER_KEY: "SAVIA_FLOWS_SECRET_MASTER_KEY",
    FORM_SIGNING_KEY: "SAVIA_FLOWS_FORM_SIGNING_KEY",
  };
  const secrets = Object.fromEntries(
    Object.entries(mapping).map(([key, source]) => {
      const value = values[source]?.trim();
      if (!value || Buffer.byteLength(value) < 32)
        throw new Error(
          `${source} is invalid or missing (at least 32 bytes required)`,
        );
      if (key === "SECRET_MASTER_KEY" && !/^[a-fA-F0-9]{64}$/.test(value))
        throw new Error(`${source} is invalid (expected a 256-bit hex key)`);
      return [key, value];
    }),
  );
  const suffix = environment === "preview" ? "-preview" : "";
  return [
    {
      app: "flows/api",
      worker: `savia-flows${suffix}`,
      config: `wrangler.${environment}.jsonc`,
      secrets,
    },
    {
      app: "api",
      worker: `savia-agencies${suffix}`,
      config: `wrangler.${environment}.jsonc`,
      secrets: { SAVIA_FLOWS_BRIDGE_SECRET: secrets.SAVIA_FLOWS_BRIDGE_SECRET },
    },
  ];
}

export function validateFlowsPreviewSettings(settings, executionEnabled) {
  if (!Array.isArray(settings.bindings))
    throw new Error("Worker bindings missing");
  const bindings = settings.bindings;
  const vars = Object.fromEntries(
    bindings
      .filter((binding) => binding.type === "plain_text")
      .map((binding) => [binding.name, binding.text]),
  );
  if (
    vars.SAVIA_FLOWS_EXTERNAL_SERVICES_ENABLED !== "false" ||
    bindings.some((binding) =>
      [
        "ai",
        "browser",
        "send_email",
        "worker_loader",
        "dispatch_namespace",
      ].includes(binding.type),
    )
  )
    throw new Error("External services must remain disabled");
  if (vars.SAVIA_FLOWS_EXECUTION_ENABLED !== String(executionEnabled))
    throw new Error("Unexpected Flows execution setting");
  if (vars.SAVIA_FLOWS_QUOTAS_ENABLED !== "true")
    throw new Error("Preview quotas are required");
  if (
    !/^[1-9]\d*$/.test(vars.SAVIA_FLOWS_POLICY_GENERATION ?? "") ||
    !Number.isSafeInteger(Number(vars.SAVIA_FLOWS_POLICY_GENERATION))
  )
    throw new Error("A valid preview policy generation is required");
  for (const [name, limit] of Object.entries({
    DAILY_RUNS: 100,
    MONTHLY_RUNS: 1000,
    CONCURRENT_RUNS: 2,
    NODES_PER_RUN: 50,
    STEPS_PER_RUN: 200,
  })) {
    const actual = vars[`SAVIA_FLOWS_MAX_${name}`];
    if (
      !/^\d+$/.test(actual ?? "") ||
      Number(actual) <= 0 ||
      Number(actual) > limit
    )
      throw new Error(`Invalid preview quota ${name}`);
  }
  if (
    !bindings.some(
      (binding) =>
        binding.name === "CODE_EXECUTOR" &&
        binding.type === "service" &&
        binding.service === "savia-hook-executor-preview" &&
        binding.entrypoint === "FlowsExecutor",
    )
  )
    throw new Error("Missing private QuickJS executor binding");
  if (
    !bindings.some(
      (binding) =>
        binding.name === "SAVIA_HOST" &&
        binding.type === "service" &&
        binding.service === "savia-agencies-preview",
    )
  )
    throw new Error("Missing private Savia host binding");
}
