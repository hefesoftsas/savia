import { fileURLToPath } from "node:url";
import { resolveInfraNames, assertAccountId } from "./naming.mjs";
import {
  previewNames,
  slugifyBranch,
} from "../../scripts/preview-environment.mjs";
const projects = {
  application: "savia-cloudflare",
  branch: "savia-branch-preview",
  shared: "savia-shared-registry",
  management: "savia-management",
};
export function resolveEnvironment(id) {
  let kind,
    dir = ".";
  if (id === "preview" || id === "production") kind = "application";
  else if (id === "shared") {
    kind = "shared";
    dir = "shared-registry";
  } else if (id === "management") {
    kind = "management";
    dir = "management";
  } else if (typeof id === "string" && id.startsWith("branch-")) {
    const slug = id.slice(7);
    if (slugifyBranch(slug) !== slug)
      throw new Error("Branch environment must use its exact normalized slug");
    kind = "branch";
    dir = "branch-preview";
  } else throw new Error("An explicit known environment is required");
  return Object.freeze({
    environment: id,
    project: projects[kind],
    stack: id,
    kind,
    projectDir: fileURLToPath(new URL(`${dir}/`, import.meta.url)),
  });
}
export function stackKey(value) {
  if (typeof value === "string") {
    const parts = value.split("/");
    if (parts.length < 2 || parts.some((p) => !p))
      throw new Error("Invalid owner stack");
    return parts.slice(-2).join("/");
  }
  return `${value.project}/${value.stack}`;
}
export function resourcePolicy(environment, profile = {}) {
  const descriptor = resolveEnvironment(environment);
  const rules = new Map();
  const parentRules = new Map();
  const add = (kind, names) => {
    const set = rules.get(kind) ?? new Set();
    for (const name of names) set.add(name);
    rules.set(kind, set);
  };
  if (descriptor.kind === "management") {
    add("r2", ["savia-pulumi-state-preview", "savia-pulumi-state"]);
  } else if (descriptor.kind === "shared") {
    add("worker", ["savia-plugin-registry"]);
    add("r2", ["savia-plugin-registry"]);
  } else if (descriptor.kind === "branch") {
    const names = previewNames(environment.slice(7));
    add("worker", Object.values(names.workers));
    add("d1", Object.values(names.databases));
    add("r2", [names.bucket]);
    parentRules.set("cron", new Set([names.workers.api]));
    add("durableObject", [
      `${names.workers.api}_RealtimeHub`,
      `${names.workers.api}_WhatsappDispatcher`,
    ]);
    parentRules.set("durableObject", new Set([names.workers.api]));
  } else {
    const preview = environment === "preview";
    const names = resolveInfraNames({
      environment,
      documentsBucket: preview ? "savia-documents-preview" : "savia-documents",
      publicOrigin: preview
        ? "https://savia-preview.hefesoft.com"
        : "https://savia.hefesoft.com",
      ...(!preview && profile.databaseNames
        ? {
            authDatabaseName: profile.databaseNames.auth,
            domainDatabaseName: profile.databaseNames.domain,
          }
        : {}),
    });
    if (
      preview &&
      profile.databaseNames &&
      (Object.keys(profile.databaseNames).length !== 2 ||
        Object.entries(names.databases).some(
          ([role, name]) => profile.databaseNames[role] !== name,
        ))
    )
      throw new Error("Preview database profile must match isolated names");
    add("worker", Object.values(names.workers));
    add("worker", [
      preview ? "savia-backup-coordinator-preview" : "savia-backup-coordinator",
      preview ? "savia-plugin-editor-preview" : "savia-plugin-editor",
    ]);
    add("worker", [names.flows.worker]);
    add("d1", [...Object.values(names.databases), names.flows.database]);
    add("r2", [
      names.bucket,
      ...Object.values(names.flows.buckets),
      ...(!preview ? ["savia-production-backups"] : []),
    ]);
    add("kv", [names.flows.kvNamespace]);
    add("queue", [names.flows.queue, names.flows.deadLetterQueue]);
    add("workflow", [names.flows.workflow]);
    if (preview) add("vectorize", ["savia-pages-search-preview"]);
    const host = new URL(names.publicOrigin).hostname;
    const tenants = profile.tenantSubdomains ?? [];
    if (
      !Array.isArray(tenants) ||
      tenants.some(
        (x) =>
          typeof x !== "string" ||
          !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(x) ||
          x.length > 63,
      )
    )
      throw new Error("Invalid tenant subdomain profile");
    add("domain", [host, ...tenants.map((t) => `${t}.${host}`)]);
    add("route", [`*.${host}/*`, ...(!preview ? [`${host}/*`] : [])]);
    parentRules.set("domain", new Set([names.workers.gateway]));
    parentRules.set("route", new Set([names.workers.gateway]));
    parentRules.set("workflow", new Set([names.flows.worker]));
    parentRules.set("cron", new Set([names.workers.api, names.flows.worker]));
    parentRules.set("consumer", new Set([names.flows.worker]));
    add("consumer", [names.flows.queue]);
    const classes = new Map([
      [names.workers.api, ["RealtimeHub", "WhatsappDispatcher"]],
      [
        preview
          ? "savia-backup-coordinator-preview"
          : "savia-backup-coordinator",
        ["BackupCoordinator"],
      ],
      [
        names.flows.worker,
        [
          "DatabaseDO",
          "WorkflowAgent",
          "AgentRunner",
          "EmailAgentRunner",
          "MailboxDO",
        ],
      ],
    ]);
    for (const [worker, types] of classes)
      for (const type of types) add("durableObject", [`${worker}_${type}`]);
    parentRules.set("durableObject", new Set(classes.keys()));
  }
  const matches = (row) => {
    if (row.kind === "cron")
      return (
        row.name === "* * * * *" &&
        parentRules.get("cron")?.has(row.parentWorker) === true
      );
    if (!rules.get(row.kind)?.has(row.name)) return false;
    if (
      parentRules.has(row.kind) &&
      !parentRules.get(row.kind).has(row.parentWorker)
    )
      return false;
    if (
      row.kind === "durableObject" &&
      !row.name.startsWith(`${row.parentWorker}_`)
    )
      return false;
    return true;
  };
  return { descriptor, rules, matches };
}
export { assertAccountId };
