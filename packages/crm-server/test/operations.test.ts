import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { getPlatformProxy } from "wrangler";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { registerOperations, runAutomations } from "../src/operations";
import { createRecord, updateRecord, deleteRecord } from "../src/services";
import { makeConfig, type CrmObject } from "@savia/crm-shared/metadata";
import { parseCsv, csvCell, mapCsvRow } from "@savia/crm-shared/csv";
import type { Env } from "../src/context";
let platform: Awaited<ReturnType<typeof getPlatformProxy<Env["Bindings"]>>>;
const app = new Hono<Env>();
app.use("*", async (c, next) => {
  c.set("tenant", "demo");
  await next();
});
app.onError((error, c) =>
  error instanceof HTTPException
    ? c.json({ error: error.message }, error.status)
    : error instanceof z.ZodError
      ? c.json({ error: error.message }, 422)
      : c.json({ error: error.message }, 500),
);
registerOperations(app);
const request = (path: string, method = "GET", data?: unknown) =>
  app.request(
    "http://localhost/api" + path,
    {
      method,
      headers: { "Content-Type": "application/json" },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    },
    platform.env,
  );
async function json(path: string, method = "GET", data?: unknown) {
  const response = await request(path, method, data),
    body = (await response.json()) as any;
  expect(response.status, JSON.stringify(body)).toBeLessThan(300);
  return body;
}
async function uploadFile(field: string, file: File) {
  const form = new FormData();
  form.set("file", file);
  form.set("field", field);
  const response = await app.request(
    `http://localhost/api/files/${object.name}/${record.id}`,
    { method: "POST", body: form },
    platform.env,
  );
  const body = (await response.json()) as { data?: unknown };
  expect(response.status, JSON.stringify(body)).toBe(201);
  return body;
}
const object: CrmObject = {
  name: "operations_contact",
  label: "Contactos de operaciones",
  description: "",
  version: 1,
  config: makeConfig({
    name: { type: "Textbox", label: "Nombre", required: true },
    email: {
      type: "Textbox",
      label: "Correo",
      config: { unique: true, format: "email" },
    },
    amount: { type: "Number", label: "Importe" },
    stage: {
      type: "Dropdown",
      label: "Etapa",
      options: [
        { value: "Open", label: "Abierta" },
        { value: "Won", label: "Ganada" },
        { value: "Lost", label: "Perdida" },
      ],
    },
    owner: { type: "Textbox", label: "Responsable" },
    contract: {
      type: "R2Attachment",
      label: "Contrato",
      config: { accept: ["application/pdf"] },
    },
    photo: {
      type: "R2Attachment",
      label: "Foto",
      config: { accept: ["image/*"] },
    },
  }),
};
object.config.studio = {
  pipeline: {
    field: "stage",
    amountField: "amount",
    ownerField: "owner",
    wonValues: ["Won"],
    lostValues: ["Lost"],
  },
};
let record: Awaited<ReturnType<typeof createRecord>>;
beforeAll(async () => {
  platform = await getPlatformProxy({
    configPath: "wrangler.jsonc",
    persist: false,
  });
  for (const name of [
    "0001_crm.sql",
    "0002_records.sql",
    "0004_operations.sql",
    "0006_r2_attachment_fields.sql",
    "0007_temporary_r2_attachments.sql",
    "0011_solutions.sql",
    "0016_office_revisions.sql",
  ])
    for (const sql of readFileSync(`migrations/${name}`, "utf8")
      .split(/;(?!(?:\s*END\b))/i)
      .filter((sql) => sql.trim()))
      await platform.env.DB.prepare(sql).run();
  await platform.env.DB.prepare(
    "INSERT INTO crm_objects(tenant_id,name,label,description,config) VALUES (?,?,?,?,?)",
  )
    .bind("demo", object.name, object.label, "", JSON.stringify(object.config))
    .run();
  record = await createRecord(platform.env.DB, "demo", object.name, {
    name: "Inicial",
    email: "initial@example.com",
    amount: 200,
    stage: "Open",
    owner: "Ana",
  });
});
afterAll(async () => {
  await platform?.dispose();
});

describe("CSV parsing and mapping", () => {
  it("parses BOM, quoted newlines, escaped quotes and semicolon files", () => {
    expect(parseCsv('\uFEFFname,email\r\n"Uno, dos\nTres","a""b"\r\n')).toEqual(
      { headers: ["name", "email"], rows: [["Uno, dos\nTres", 'a"b']] },
    );
    expect(parseCsv("name;email\na;b").rows).toEqual([["a", "b"]]);
    expect(() => parseCsv('name\n"unfinished')).toThrow("comillas");
    expect(() => parseCsv("name,email\na,b,c")).toThrow("Fila 2");
    expect(() => parseCsv("a,a\n1,2")).toThrow("únicos");
  });
  it("neutralizes spreadsheet formulas and reports typed validation", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe('"\'=HYPERLINK(1)"');
    expect(csvCell(-12)).toBe('"-12"');
    expect(
      mapCsvRow(object, ["n", "a"], ["Alice", "bad"], {
        n: "name",
        a: "amount",
      }).errors.amount,
    ).toContain("número");
  });
});
describe("Operations with real D1 and R2", () => {
  it("previews errors and duplicates, imports good rows, and replays without duplicate records", async () => {
    const input = {
      csv: "name,email,amount\nNueva,new@example.com,20\nDuplicada,INITIAL@example.com,30\nInválida,not-email,abc",
      mapping: { name: "name", email: "email", amount: "amount" },
    };
    const preview = await json(`/import/${object.name}/preview`, "POST", input);
    expect(preview.summary).toEqual({
      ready: 1,
      created: 0,
      skipped: 1,
      errors: 1,
    });
    const commit = await json(`/import/${object.name}/commit`, "POST", {
      ...input,
      importId: preview.importId,
    });
    expect(commit.summary.created).toBe(1);
    expect(commit.summary.errors).toBe(1);
    await json(`/import/${object.name}/commit`, "POST", {
      ...input,
      importId: preview.importId,
    });
    expect(
      (
        await platform.env.DB.prepare(
          "SELECT count(*) AS total FROM crm_records WHERE object_name=?",
        )
          .bind(object.name)
          .first<any>()
      ).total,
    ).toBe(2);
  });
  it("paginates inbound relations and excludes deleted records", async () => {
    const config = makeConfig({
      name: { type: "Textbox", label: "Nombre" },
      contacts: {
        type: "Dropdown",
        label: "Contactos",
        config: { relation: object.name, multiple: true },
      },
    });
    await platform.env.DB.prepare(
      "INSERT INTO crm_objects(tenant_id,name,label,config) VALUES (?,?,?,?)",
    )
      .bind(
        "demo",
        "operations_related",
        "Relacionados",
        JSON.stringify(config),
      )
      .run();
    await platform.env.DB.batch(
      Array.from({ length: 26 }, (_, i) =>
        platform.env.DB.prepare(
          "INSERT INTO crm_records(id,tenant_id,object_name,data,deleted_at) VALUES (?,?,?,?,?)",
        ).bind(
          `related-${i}`,
          "demo",
          "operations_related",
          JSON.stringify({ name: `Relacionado ${i}`, contacts: [record.id] }),
          i === 25 ? new Date().toISOString() : null,
        ),
      ),
    );
    const first = await json(`/record-detail/${object.name}/${record.id}`),
      second = await json(`/record-detail/${object.name}/${record.id}?page=2`);
    expect(first.data.relations[0].total).toBe(25);
    expect(first.data.relations[0].records).toHaveLength(20);
    expect(second.data.relations[0].records).toHaveLength(5);
  });
  it("saves notes and uploads/downloads/deletes real R2 content", async () => {
    const note = await json(
      `/record-notes/${object.name}/${record.id}`,
      "POST",
      { body: "Llamada: próxima reunión el lunes.", kind: "call" },
    );
    expect(
      (await json(`/record-activity/${object.name}/${record.id}`)).data.some(
        (n: any) => n.id === note.data.id,
      ),
    ).toBe(true);
    const form = new FormData();
    form.set(
      "file",
      new File(["contenido verificable"], "acuerdo.txt", {
        type: "text/plain",
      }),
    );
    const upload = await app.request(
      `http://localhost/api/files/${object.name}/${record.id}`,
      { method: "POST", body: form },
      platform.env,
    );
    const file = (await upload.json()) as any;
    expect(upload.status, JSON.stringify(file)).toBe(201);
    const download = await request(`/file/${file.data.id}/download`);
    expect(await download.text()).toBe("contenido verificable");
    expect(download.headers.get("content-disposition")).toContain("attachment");
    expect(
      (await request(`/file/${file.data.id}`, "DELETE", { version: 99 }))
        .status,
    ).toBe(409);
    await json(`/file/${file.data.id}`, "DELETE", { version: 1 });
    expect(
      (await json(`/files/${object.name}/${record.id}`)).data,
    ).toHaveLength(0);
    expect((await request(`/file/${file.data.id}/download`)).status).toBe(404);
  });
  it("keeps an uploaded attachment temporary until a record is saved and deletes it on cancellation", async () => {
    const form = new FormData();
    form.set("field", "contract");
    form.set(
      "file",
      new File(["temporary contract"], "temporary-contract.pdf", {
        type: "application/pdf",
      }),
    );
    const upload = await app.request(
      `http://localhost/api/file-drafts/${object.name}`,
      { method: "POST", body: form },
      platform.env,
    );
    const temporaryBody = await upload.text();
    expect(upload.status, temporaryBody).toBe(201);
    const temporary = JSON.parse(temporaryBody) as {
      data?: any;
      error?: string;
    };
    expect(temporary.data).toMatchObject({
      name: "temporary-contract.pdf",
      field: "contract",
      version: 1,
    });
    expect(
      await (await request(`/file/${temporary.data.id}/download`)).text(),
    ).toBe("temporary contract");

    const target = { id: "temporary-target-9" };
    await platform.env.DB.prepare(
      "INSERT INTO crm_records(id,tenant_id,object_name,data) VALUES (?,?,?,?)",
    )
      .bind(
        target.id,
        "demo",
        object.name,
        JSON.stringify({ name: "Con adjunto temporal" }),
      )
      .run();
    expect((await json(`/files/${object.name}/${target.id}`)).data).toEqual([]);

    const attached = await json(
      `/file-drafts/${temporary.data.id}/attach`,
      "POST",
      {
        recordId: target.id,
        version: temporary.data.version,
      },
    );
    expect(attached.data).toMatchObject({
      id: temporary.data.id,
      recordId: target.id,
      version: 2,
    });
    expect((await json(`/files/${object.name}/${target.id}`)).data).toEqual([
      expect.objectContaining({
        id: temporary.data.id,
        name: "temporary-contract.pdf",
        field: "contract",
        version: 2,
      }),
    ]);

    const abandonedForm = new FormData();
    abandonedForm.set("field", "contract");
    abandonedForm.set(
      "file",
      new File(["cancelled contract"], "cancelled-contract.pdf", {
        type: "application/pdf",
      }),
    );
    const abandonedUpload = await app.request(
      `http://localhost/api/file-drafts/${object.name}`,
      { method: "POST", body: abandonedForm },
      platform.env,
    );
    const abandoned = (await abandonedUpload.json()) as { data?: any };
    expect(abandonedUpload.status).toBe(201);
    await json(`/file/${abandoned.data.id}`, "DELETE", {
      version: abandoned.data.version,
    });
    expect((await request(`/file/${abandoned.data.id}/download`)).status).toBe(
      404,
    );
    await json(`/file/${temporary.data.id}`, "DELETE", { version: 2 });
    await platform.env.DB.prepare(
      "DELETE FROM crm_records WHERE tenant_id=? AND id=?",
    )
      .bind("demo", target.id)
      .run();
  });
  it("isolates R2 attachments by configured field", async () => {
    await uploadFile(
      "contract",
      new File(["contract"], "contract.pdf", { type: "application/pdf" }),
    );
    await uploadFile(
      "photo",
      new File(["photo"], "photo.png", { type: "image/png" }),
    );

    expect(
      (await json(`/files/${object.name}/${record.id}?field=contract`)).data,
    ).toMatchObject([{ name: "contract.pdf", field: "contract" }]);
    expect(
      (await json(`/files/${object.name}/${record.id}?field=photo`)).data,
    ).toMatchObject([{ name: "photo.png", field: "photo" }]);
  });
  it("creates an idempotent automated task and protects task edits with versions", async () => {
    await json("/automations", "POST", {
      name: "Bienvenida",
      object_name: object.name,
      config: {
        field: "stage",
        value: "Won",
        title: "Bienvenida {{name}}",
        dueDays: 0,
        owner: "Equipo",
        ownerField: "owner",
      },
    });
    const after = await updateRecord(
      platform.env.DB,
      "demo",
      object.name,
      record.id,
      { stage: "Won" },
      { version: record._version! },
    );
    await runAutomations(platform.env.DB, "demo", object.name, record, after);
    await runAutomations(platform.env.DB, "demo", object.name, record, after);
    const tasks = await json(`/tasks?record=${record.id}`);
    expect(tasks.data).toHaveLength(1);
    expect(tasks.data[0].title).toBe("Bienvenida Inicial");
    expect(tasks.data[0].owner).toBe("Ana");
    await json(`/tasks/${tasks.data[0].id}`, "PATCH", {
      ...tasks.data[0],
      status: "done",
    });
    expect(
      (
        await request(`/tasks/${tasks.data[0].id}`, "PATCH", {
          ...tasks.data[0],
          status: "pending",
        })
      ).status,
    ).toBe(409);
    expect((await json("/automation-runs")).total).toBe(1);
    record = after;
  });
  it("reports metadata-configured pipeline values and complete exports beyond 200 rows", async () => {
    await platform.env.DB.batch(
      Array.from({ length: 205 }, (_, i) =>
        platform.env.DB.prepare(
          "INSERT INTO crm_records(id,tenant_id,object_name,data) VALUES (?,?,?,?)",
        ).bind(
          `export-${i.toString().padStart(3, "0")}`,
          "demo",
          object.name,
          JSON.stringify({
            name: `Export ${i}`,
            amount: 10,
            stage: "Lost",
            owner: "Responsable",
          }),
        ),
      ),
    );
    const reports = (await json("/reports")).data[0];
    expect(reports.total).toBe(207);
    expect(reports.won).toBe(1);
    expect(reports.lost).toBe(205);
    expect(reports.amount).toBe(2270);
    const exported = await (await request(`/export/${object.name}`)).text();
    expect(parseCsv(exported).rows).toHaveLength(207);
  });
  it("exports visible columns with the active search filter", async () => {
    const query = new URLSearchParams({
      columns: JSON.stringify(["name", "stage"]),
      headers: JSON.stringify(["Nombre", "Etapa"]),
      filters: JSON.stringify({
        logic: "and",
        conditions: [{ field: "name", op: "eq", value: "Export 42" }],
      }),
      sort: "name",
      order: "ASC",
      q: "",
    });
    const exported = await (
      await request(`/export/${object.name}?${query}`)
    ).text();
    const parsed = parseCsv(exported);
    expect(parsed.headers).toEqual(["Nombre", "Etapa"]);
    expect(parsed.rows).toEqual([["Export 42", "Lost"]]);
  });
});
