/** Build a reviewed, parameterized reset from a private preview backup. No network side effects. */
import { createHash } from "node:crypto";
const quote = (name) => '"' + name.replaceAll('"', '""') + '"';
const split = (sql) =>
  sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);
export const retainedIdentityTables = [
  "identity_principal",
  "identity_global_role",
  "identity_tenant_membership",
  "tenants",
  "agencies",
  "access_revisions",
  "access_roles",
  "access_grants",
  "access_assignments",
];
const credentialTables = [
  "user_provider_credentials",
  "assistant_openrouter_settings",
  "studio_integrations",
  "studio_collection_sources",
  "studio_geocoding_settings",
  "extension_connections",
  "personal_integration_connections",
  "tenant_crm_connections",
  "workflow_webhook_destinations",
  "workflow_webhook_endpoints",
];
export function fingerprint(rows) {
  return createHash("sha256")
    .update(JSON.stringify(rows.map((row) => JSON.stringify(row)).sort()))
    .digest("hex");
}
export function buildPreviewInitialReset(db, initial, bootstrap) {
  const objects = db
    .prepare(
      "SELECT name,type,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'",
    )
    .all();
  const shadows = new Set(
    db
      .prepare("PRAGMA table_list")
      .all()
      .filter((t) => t.type === "shadow")
      .map((t) => t.name),
  );
  const tables = objects.filter(
    (o) => o.type === "table" && !shadows.has(o.name),
  );
  const names = new Set(tables.map((t) => t.name));
  const selected = new Map();
  for (const name of [...retainedIdentityTables, ...credentialTables])
    if (names.has(name))
      selected.set(name, db.prepare(`SELECT * FROM ${quote(name)}`).all());
  for (const name of ["flow_variables", "tenant_flow_variables"])
    if (names.has(name))
      selected.set(
        name,
        db
          .prepare(
            `SELECT * FROM ${quote(name)} WHERE secret=1 AND key NOT LIKE '%request_body'`,
          )
          .all(),
      );
  // Include only actual parent rows needed by retained records, including compound FKs.
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, rows] of [...selected]) {
      const groups = new Map();
      for (const fk of db
        .prepare(`PRAGMA foreign_key_list(${quote(name)})`)
        .all()) {
        const list = groups.get(fk.id) ?? [];
        list.push(fk);
        groups.set(fk.id, list);
      }
      for (const fks of groups.values())
        for (const row of rows) {
          if (fks.some((fk) => row[fk.from] === null)) continue;
          const parent = fks[0].table;
          const keys = db
            .prepare(`PRAGMA table_info(${quote(parent)})`)
            .all()
            .filter((c) => c.pk)
            .sort((a, b) => a.pk - b.pk);
          const sql =
            `SELECT * FROM ${quote(parent)} WHERE ` +
            fks
              .map((fk, i) => `${quote(fk.to ?? keys[i].name)} IS ?`)
              .join(" AND ");
          const matches = db.prepare(sql).all(...fks.map((fk) => row[fk.from]));
          if (matches.length !== 1)
            throw Error(`Missing retained parent in ${parent}`);
          const parents = selected.get(parent) ?? [];
          if (
            !parents.some(
              (p) => JSON.stringify(p) === JSON.stringify(matches[0]),
            )
          ) {
            parents.push(matches[0]);
            selected.set(parent, parents);
            changed = true;
          }
        }
    }
  }
  const statements = [];
  const push = (sql, params = []) => statements.push({ sql, params });
  push("PRAGMA defer_foreign_keys=ON");
  push(
    "CREATE TABLE _savia_reset_guard(valid INTEGER NOT NULL CHECK(valid=1))",
  );
  // Abort the transaction if users or credentials changed since the private backup.
  for (const name of [
    ...retainedIdentityTables,
    ...credentialTables,
    "flow_variables",
    "tenant_flow_variables",
  ]) {
    if (!selected.has(name)) continue;
    const predicate = name.endsWith("flow_variables")
      ? " WHERE secret=1 AND key NOT LIKE '%request_body'"
      : "";
    push(
      `INSERT INTO _savia_reset_guard SELECT (SELECT count(*) FROM ${quote(name)}${predicate})=?`,
      [selected.get(name).length],
    );
  }
  for (const [name, rows] of selected)
    for (const row of rows) {
      const columns = Object.keys(row);
      push(
        `INSERT INTO _savia_reset_guard SELECT (SELECT count(*) FROM ${quote(name)} WHERE ${columns.map((c) => quote(c) + " IS ?").join(" AND ")})=1`,
        Object.values(row),
      );
    }

  // Stop delete/audit/search triggers before clearing application state.
  for (const o of objects
    .filter((o) => o.type === "trigger" || o.type === "view")
    .sort((a, b) => (a.type === "trigger" ? -1 : 1)))
    push(`DROP ${o.type.toUpperCase()} ${quote(o.name)}`);
  const pending = new Set(names);
  const parents = new Map(
    tables.map((t) => [
      t.name,
      new Set(
        db
          .prepare(`PRAGMA foreign_key_list(${quote(t.name)})`)
          .all()
          .map((f) => f.table),
      ),
    ]),
  );
  while (pending.size) {
    const ready = [...pending].filter((name) =>
      [...pending].every(
        (other) => other === name || !parents.get(other).has(name),
      ),
    );
    if (!ready.length)
      throw Error("Cyclic table dependency requires manual reset review");
    for (const name of ready) {
      push(`DROP TABLE ${quote(name)}`);
      pending.delete(name);
    }
  }
  const schema = split(initial);
  for (const sql of schema.filter((s) => !/^CREATE TRIGGER\b/i.test(s)))
    push(sql);
  for (const sql of split(bootstrap)) push(sql);
  for (const [name, rows] of selected)
    for (const row of rows) {
      const columns = Object.keys(row);
      const keys = db
        .prepare(`PRAGMA table_info(${quote(name)})`)
        .all()
        .filter((c) => c.pk)
        .map((c) => c.name);
      const updates = columns.filter((c) => !keys.includes(c));
      push(
        `INSERT INTO ${quote(name)} (${columns.map(quote).join(",")}) VALUES (${columns.map(() => "?").join(",")}) ON CONFLICT DO ${updates.length ? "UPDATE SET " + updates.map((c) => `${quote(c)}=excluded.${quote(c)}`).join(",") : "NOTHING"}`,
        Object.values(row),
      );
    }
  for (const sql of schema.filter((s) => /^CREATE TRIGGER\b/i.test(s)))
    push(sql);
  push(
    "CREATE TABLE _savia_migrations(filename TEXT PRIMARY KEY,applied_at TEXT NOT NULL)",
  );
  for (const filename of ["0001_initial.sql", "0002_bootstrap.sql"])
    push("INSERT INTO _savia_migrations VALUES (?,datetime('now'))", [
      filename,
    ]);
  // Force validation before leaving the single transactional batch.
  push("PRAGMA defer_foreign_keys=OFF");
  push("DROP TABLE _savia_reset_guard");
  return {
    statements,
    retained: [...selected].map(([table, rows]) => ({
      table,
      rows: rows.length,
      fingerprint: fingerprint(rows),
    })),
  };
}
