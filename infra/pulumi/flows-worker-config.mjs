// Worker-attached infrastructure has one publisher: Wrangler. Pulumi provisions
// the independent resources and this manifest attaches their actual outputs.
export function flowsWorkerConfig(resources, publicOrigin, environment) {
  const sqliteClasses = [
    "DatabaseDO",
    "WorkflowAgent",
    "AgentRunner",
    "EmailAgentRunner",
    "MailboxDO",
  ];
  return {
    $schema: "../../../node_modules/wrangler/config-schema.json",
    name: resources.workerName,
    main: "src/index.ts",
    compatibility_date: "2026-09-01",
    compatibility_flags: ["nodejs_compat"],
    workers_dev: false,
    preview_urls: false,
    alias: { "iconv-lite": "./src/stubs/empty-module.ts" },
    define: { RUNTIME_VERSION: JSON.stringify("savia-preview-v1") },
    vars: {
      // Retain the first edition's restricted catalog and D1 execution history.
      SAVIA_FLOWS_LOCAL_ONLY: "true",
      CLOUDFLARE_ENV: "development",
      WEB_HOST: `${publicOrigin}/flows-ui`,
      WEBSITE_URL: publicOrigin,
      EMAIL_DOMAIN: "savia.local",
    },
    services: [
      {
        binding: "SAVIA_HOST",
        service:
          environment === "preview"
            ? "savia-agencies-preview"
            : "savia-agencies",
      },
    ],
    d1_databases: [
      {
        binding: "DB",
        database_name: resources.workerName,
        database_id: resources.databaseId,
        migrations_dir: "src/db/migrations",
      },
    ],
    kv_namespaces: [{ binding: "KV", id: resources.kvNamespaceId }],
    r2_buckets: [
      { binding: "RESSOURCES", bucket_name: resources.buckets.resources },
      { binding: "DATASETS", bucket_name: resources.buckets.datasets },
      { binding: "INBOXES", bucket_name: resources.buckets.inboxes },
    ],
    workflows: [
      {
        binding: "EXECUTE",
        name: resources.workflowName,
        class_name: "Runtime",
      },
    ],
    durable_objects: {
      bindings: [
        { name: "DATABASE", class_name: "DatabaseDO" },
        { name: "WORKFLOW_AGENT", class_name: "WorkflowAgent" },
        { name: "AGENT_RUNNER", class_name: "AgentRunner" },
        { name: "EMAIL_AGENT_RUNNER", class_name: "EmailAgentRunner" },
        { name: "MAILBOX", class_name: "MailboxDO" },
      ],
    },
    migrations: [{ tag: "savia-flows-v1", new_sqlite_classes: sqliteClasses }],
    queues: {
      producers: [{ binding: "WORKFLOW_QUEUE", queue: resources.queueName }],
      consumers: [
        {
          queue: resources.queueName,
          max_batch_size: 10,
          max_batch_timeout: 1,
        },
      ],
    },
    triggers: { crons: ["* * * * *"] },
    worker_loaders: [{ binding: "LOADER" }],
    ratelimits: [
      {
        name: "RATE_LIMIT_DEFAULT",
        namespace_id: environment === "preview" ? "7101" : "7201",
        simple: { limit: 1000, period: 60 },
      },
      {
        name: "RATE_LIMIT_AUTH",
        namespace_id: environment === "preview" ? "7102" : "7202",
        simple: { limit: 100, period: 60 },
      },
      {
        name: "RATE_LIMIT_EXECUTE",
        namespace_id: environment === "preview" ? "7103" : "7203",
        simple: { limit: 100, period: 60 },
      },
    ],
    secrets: {
      required: [
        "SAVIA_FLOWS_BRIDGE_SECRET",
        "JWT_SECRET",
        "SECRET_MASTER_KEY",
        "FORM_SIGNING_KEY",
      ],
    },
    limits: { cpu_ms: 30000 },
    observability: { enabled: false },
  };
}
