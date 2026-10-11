import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { registerDialect } from "@savia/db/dialect";
import { postgresDialect } from "@savia/db/postgres-dialect";
import { registerPluginProjects } from "../src/plugin-projects";
import type { Env } from "../src/context";

describe("PostgreSQL project reference guards", () => {
  it.each([0, 1])(
    "renders a single bound JSON input for version %s",
    async (version) => {
      const writes: Array<{ sql: string; parameters: unknown[] }> = [];
      const db = {
        prepare(sql: string) {
          return {
            bind(...parameters: unknown[]) {
              return {
                async run() {
                  writes.push({ sql, parameters });
                  return { meta: { changes: 1 } };
                },
              };
            },
          };
        },
      } as unknown as D1Database;
      registerDialect(db, postgresDialect);
      const app = new Hono<Env>();
      app.use("*", async (c, next) => {
        c.set("tenant", "tenant");
        c.set("principalId", "owner");
        await next();
      });
      registerPluginProjects(app, { canManageExtension: () => true });
      const response = await app.request(
        "/api/plugin-projects/a3e6b43c-3cf0-4d3b-91fb-f5b3a087d001",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            files: {
              "entry.tsx": "export default () => <main />;",
              "savia-extension.json": "{}",
              "store.json": "{}",
              "preview.json": "{}",
            },
            history: [],
            version,
            installedEditorExtensions: [],
          }),
        },
        { DB: db },
      );
      expect(response.status).toBe(200);
      expect(writes).toHaveLength(1);
      const { sql, parameters } = writes[0];
      expect(sql).not.toContain("json_extract");
      expect(sql).toContain("json_array_elements");
      expect(sql).toContain("SELECT ? AS references_json");
      expect(sql).toContain("'installationId'");
      // JSONPath predicates also contain question marks inside SQL literals.
      const withoutLiterals = sql.replace(/'(?:[^']|'')*'/g, "''");
      expect(withoutLiterals.match(/\?/g)).toHaveLength(parameters.length);
      expect(parameters.slice(-4)).toEqual(["[]", "tenant", "owner", 0]);
    },
  );
});
