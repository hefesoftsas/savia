import { randomBytes, randomUUID } from "node:crypto";

export const PROTECTED_BRANCHES = new Set([
  "main",
  "master",
  "production",
  "staging",
  "preview",
  "head",
  "trunk",
]);

const MAX_SLUG_LENGTH = 24;

export function slugifyBranch(branch) {
  const slug = String(branch ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "");
  if (slug.length < 2) throw new Error(`Cannot slugify branch: ${branch}`);
  if (PROTECTED_BRANCHES.has(slug))
    throw new Error(`Refusing preview environment for protected ref: ${slug}`);
  return slug;
}

export function previewNames(slug) {
  const suffix = `preview-${slug}`;
  return {
    slug,
    suffix,
    workers: {
      auth: `savia-auth-${suffix}`,
      request: `savia-request-${suffix}`,
      mcp: `savia-mcp-${suffix}`,
      api: `savia-agencies-${suffix}`,
      gateway: `savia-${suffix}`,
    },
    databases: {
      domain: `savia-agencies-${suffix}`,
      auth: `savia-auth-${suffix}`,
    },
    bucket: `savia-documents-${suffix}`,
  };
}

export function assertDestroyTarget(name, slug) {
  if (
    typeof name !== "string" ||
    name.length === 0 ||
    slug.length < 2 ||
    name.includes("..") ||
    name.includes("/") ||
    name.includes(" ") ||
    !name.includes(`-preview-${slug}`)
  )
    throw new Error(`Refusing to delete non-preview resource: ${name}`);
  return name;
}

export function findDatabaseUuid(listOutput, name) {
  let parsed = listOutput;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      const fallback = String(listOutput).match(
        new RegExp(`${name}[^0-9a-f]*([0-9a-f]{8}-[0-9a-f-]{28})`),
      );
      return fallback?.[1] ?? null;
    }
  }
  const rows = Array.isArray(parsed)
    ? parsed
    : (parsed?.d1_databases ?? parsed?.result ?? []);
  const match = (Array.isArray(rows) ? rows : []).find(
    (row) => row?.name === name,
  );
  return match?.uuid ?? null;
}

export function dryRunDatabaseUuid() {
  return randomUUID();
}

export function ephemeralSecret() {
  return randomBytes(32).toString("base64");
}

export function flagValue(argv, flag) {
  const index = argv.indexOf(flag);
  if (index === -1 || index + 1 >= argv.length)
    throw new Error(`Missing required flag: ${flag} <value>`);
  const value = argv[index + 1];
  if (typeof value !== "string" || value.startsWith("--") || value === "")
    throw new Error(`Missing required flag: ${flag} <value>`);
  return value;
}

export function hasFlag(argv, flag) {
  return argv.includes(flag);
}
