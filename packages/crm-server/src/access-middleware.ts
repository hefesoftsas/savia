import type { Hono } from "hono";
import type { Env } from "./context";
import type {
  AccessAction,
  AccessPolicy,
} from "@savia/crm-shared/access-control";
import type { CrmObject, CrmRecord } from "@savia/crm-shared/metadata";
import { getObject, getRecord, parseObject, parseRecord } from "./services";
import {
  accessRecord,
  accessDenied,
  projectCrmRecord,
  accessColumns,
  requireQueryAccess,
  queryAccessFields,
  requireRecordAccess,
} from "./access-authorization";
import { decideRecord } from "@savia/crm-shared/access-evaluator";
import { compileAccessWhere } from "./access-query";
import { buildWhere } from "./query";
import { csvLine } from "@savia/crm-shared/csv";
import { disabledSolutionObjects } from "./solution-state";

export function visibleAccessObject(
  policy: AccessPolicy,
  object: CrmObject,
): CrmObject {
  const grants = policy.grants.filter(
    (g) => g.resource === `collection:${object.name}`,
  );
  const fields = new Set(
    grants.filter((g) => g.action === "read").flatMap((g) => g.fields),
  );
  const can = (action: AccessAction) => grants.some((g) => g.action === action);
  return {
    ...object,
    config: {
      ...object.config,
      fields: Object.fromEntries(
        Object.entries(object.config.fields).filter(([key]) => fields.has(key)),
      ),
      fieldOrder: object.config.fieldOrder?.filter((f) => fields.has(f)),
      studio: {
        screen: {
          ...object.config.studio?.screen,
          hidden: !policy.grants.some(
            (g) => g.resource === `page:${object.name}` && g.action === "read",
          ),
        },
        capabilities: {
          list: can("read"),
          read: can("read"),
          create: can("create"),
          update: can("update"),
          delete: can("delete"),
          schema: false,
          customFields: false,
          search: true,
          filter: true,
          sort: true,
        },
      },
    },
  };
}
export function registerAccessMiddleware(app: Hono<Env>, policy: AccessPolicy) {
  app.use("/api/*", async (c, next) => {
    const db = c.env.DB,
      tenant = c.get("tenant"),
      path = c.req.path,
      method = c.req.method;
    c.header("cache-control", "no-store");
    if (path === "/api/access-context" && method === "GET")
      return c.json({ data: policy });
    if (path === "/api/health") return next();
    if (path === "/api/bootstrap" && method === "POST")
      return c.json({ ok: true });
    if (path === "/api/objects" && method === "GET") {
      const rows = await db
        .prepare("SELECT * FROM crm_objects WHERE tenant_id=? ORDER BY name")
        .bind(tenant)
        .all();
      const disabled = await disabledSolutionObjects(db, tenant);
      const data = [];
      for (const row of rows.results) {
        const object = parseObject(row);
        if (
          !policy.grants.some(
            (g) => g.resource === `page:${object.name}` && g.action === "read",
          )
        )
          continue;
        if (
          disabled.has(object.name) ||
          !policy.grants.some(
            (g) =>
              g.resource === `collection:${object.name}` && g.action === "read",
          )
        )
          continue;
        const where = compileAccessWhere(
          policy,
          `collection:${object.name}`,
          "read",
          accessColumns(object),
        );
        const count = await db
          .prepare(
            `SELECT count(*) AS n FROM crm_records WHERE tenant_id=? AND object_name=? AND deleted_at IS NULL AND ${where.sql}`,
          )
          .bind(tenant, object.name, ...where.bindings)
          .first<{ n: number }>();
        data.push({
          ...visibleAccessObject(policy, object),
          count: count?.n ?? 0,
        });
      }
      return c.json({ data, menuLayout: null });
    }
    if (path.startsWith("/api/local-sync/")) return next();
    const recordMatch =
      /^\/api\/records\/([^/]+)(?:\/([^/]+))?(?:\/(restore|bulk))?$/.exec(path);
    const viewMatch = /^\/api\/views\/([^/]+)$/.exec(path);
    const detailMatch = /^\/api\/record-detail\/([^/]+)\/([^/]+)$/.exec(path);
    const importMatch = /^\/api\/import\/([^/]+)\/(preview|commit)$/.exec(path);
    const exportMatch = /^\/api\/export\/([^/]+)$/.exec(path);
    const objectMatch = /^\/api\/objects\/([^/]+)$/.exec(path);
    const filesMatch = /^\/api\/files\/([^/]+)\/([^/]+)$/.exec(path);
    const fileMatch = /^\/api\/file\/([^/]+)(?:\/download)?$/.exec(path);
    if (fileMatch) {
      const file = await db
        .prepare(
          "SELECT object_name,record_id,field_name FROM crm_files WHERE tenant_id=? AND id=?",
        )
        .bind(tenant, decodeURIComponent(fileMatch[1]))
        .first<{
          object_name: string;
          record_id: string;
          field_name: string;
        }>();
      if (!file) accessDenied();
      const record = await getRecord(
        db,
        tenant,
        file.object_name,
        file.record_id,
      );
      requireRecordAccess(
        db,
        file.object_name,
        method === "GET" ? "read" : "update",
        record,
      );
      if (
        file.field_name &&
        !decideRecord(
          policy,
          `collection:${file.object_name}`,
          method === "GET" ? "read" : "update",
          accessRecord(record),
        ).fields.includes(file.field_name)
      )
        accessDenied();
      return next();
    }
    const match =
      recordMatch ??
      viewMatch ??
      detailMatch ??
      exportMatch ??
      importMatch ??
      objectMatch ??
      filesMatch;
    if (!match) accessDenied();
    const name = decodeURIComponent(match[1]);
    const bulk =
      recordMatch && (recordMatch[2] === "bulk" || recordMatch[3] === "bulk");
    if (bulk) {
      const input = (await c.req.raw.clone().json()) as { action?: string };
      if (
        method !== "POST" ||
        !input.action ||
        !["update", "delete", "restore"].includes(input.action) ||
        !policy.grants.some(
          (g) =>
            g.resource === `collection:${name}` && g.action === input.action,
        )
      )
        accessDenied();
      return next();
    }
    const action: AccessAction = importMatch
      ? "import"
      : filesMatch && method !== "GET"
        ? "update"
        : exportMatch
          ? "export"
          : method === "GET"
            ? "read"
            : method === "DELETE"
              ? "delete"
              : method === "PATCH"
                ? "update"
                : recordMatch?.[3] === "restore"
                  ? "restore"
                  : "create";
    if (
      !policy.grants.some(
        (g) => g.resource === `collection:${name}` && g.action === action,
      )
    )
      accessDenied();

    if (
      (viewMatch || objectMatch || detailMatch || exportMatch) &&
      method !== "GET"
    )
      accessDenied();
    const object = await getObject(db, tenant, name);
    if (objectMatch) {
      if (
        !policy.grants.some(
          (g) => g.resource === `page:${name}` && g.action === "read",
        )
      )
        accessDenied();
      return c.json({ data: visibleAccessObject(policy, object) });
    }
    if (viewMatch) return c.json({ data: [] });
    if (detailMatch) {
      const record = await getRecord(
        db,
        tenant,
        name,
        decodeURIComponent(detailMatch[2]),
      );
      return c.json({
        data: {
          record: projectCrmRecord(policy, name, record),
          relations: [],
          page: 1,
          perPage: 20,
        },
      });
    }
    if (filesMatch) {
      const record = await getRecord(
        db,
        tenant,
        name,
        decodeURIComponent(filesMatch[2]),
      );
      requireRecordAccess(
        db,
        name,
        method === "GET" ? "read" : "update",
        record,
      );
      const fields = decideRecord(
        policy,
        `collection:${name}`,
        method === "GET" ? "read" : "update",
        accessRecord(record),
      ).fields;
      if (method === "GET") {
        await next();
        if (c.res.ok) {
          const payload = (await c.res.clone().json()) as {
            data: Array<{ field?: string }>;
          };
          payload.data = payload.data.filter(
            (f) => !f.field || fields.includes(f.field),
          );
          c.res = new Response(JSON.stringify(payload), {
            status: c.res.status,
            headers: c.res.headers,
          });
        }
        return;
      }
      const form = await c.req.raw.clone().formData();
      const field = form.get("field");
      if (typeof field === "string" && field && !fields.includes(field))
        accessDenied();
      return next();
    }
    if (importMatch) {
      if (method !== "POST") accessDenied();
      return next();
    }
    const params = { ...c.req.query() };
    requireQueryAccess(
      policy,
      name,
      params,
      object.config.studio?.pipeline?.field ?? "stage",
    );
    if (exportMatch) {
      const allowed = queryAccessFields(policy, name).filter((f) =>
        policy.grants
          .filter(
            (g) => g.resource === `collection:${name}` && g.action === "export",
          )
          .every((g) => g.fields.includes(f)),
      );
      let columns: string[] = allowed;
      if (params.columns) {
        try {
          columns = JSON.parse(params.columns);
        } catch {
          return c.json({ error: "Invalid export columns." }, 422);
        }
      }
      if (
        !Array.isArray(columns) ||
        columns.some((f) => typeof f !== "string" || !allowed.includes(f))
      )
        accessDenied();
      const read = buildWhere(object, tenant, params, policy),
        exp = compileAccessWhere(
          policy,
          `collection:${name}`,
          "export",
          accessColumns(object),
        );
      const rows = await db
        .prepare(
          `SELECT * FROM crm_records WHERE ${read.where} AND ${exp.sql} ORDER BY id LIMIT 10001`,
        )
        .bind(...read.args, ...exp.bindings)
        .all();
      if (rows.results.length > 10000)
        return c.json({ error: "Export exceeds 10000 records." }, 422);
      return new Response(
        "\uFEFF" +
          csvLine(columns) +
          rows.results
            .map((row) => {
              const r = projectCrmRecord(policy, name, parseRecord(row));
              return csvLine(columns.map((f) => r[f] ?? ""));
            })
            .join(""),
        {
          headers: {
            "content-type": "text/csv; charset=utf-8",
            "cache-control": "no-store",
          },
        },
      );
    }
    await next();
    if (
      c.res.ok &&
      c.res.headers.get("content-type")?.includes("application/json") &&
      recordMatch
    ) {
      const payload = (await c.res.clone().json()) as {
        data?: CrmRecord | CrmRecord[];
      };
      if (payload.data && recordMatch[2] !== "summary")
        payload.data = Array.isArray(payload.data)
          ? payload.data.map((r) => projectCrmRecord(policy, name, r))
          : projectCrmRecord(policy, name, payload.data);
      c.res = new Response(JSON.stringify(payload), {
        status: c.res.status,
        headers: c.res.headers,
      });
    }
  });
}
