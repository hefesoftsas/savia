import { makeConfig } from "../../../packages/studio-shared/src/metadata";
import {
  encryptSecret,
  decryptSecret,
} from "../../../packages/studio-server/src/integrations";
import { mkdtemp, rm, readFile, chmod, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, createHmac } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { expect, it, vi } from "vitest";
import pg from "pg";
import { createApplication } from "../src/application";
import { loadConfiguration } from "../src/config";
import {
  importSqlite,
  ImportTextCompatibilityError,
} from "../src/postgres/import-sqlite";
import {
  postgresTestUrl,
  postgresTestsRequired,
  withPostgresFixture,
} from "./postgres-fixture";
import { mapSqliteValue } from "../src/postgres/import-mappings";

function totp(uri: string) {
  const url = new URL(uri);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let buffer = 0,
    bits = 0;
  const bytes: number[] = [];
  for (const character of url.searchParams.get("secret")!.replace(/=+$/, "")) {
    const value = alphabet.indexOf(character);
    if (value < 0) throw new Error("Invalid TOTP secret");
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 255);
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(
    BigInt(
      Math.floor(
        Date.now() / 1000 / Number(url.searchParams.get("period") ?? 30),
      ),
    ),
  );
  const hash = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const offset = hash.at(-1)! & 15;
  return ((hash.readUInt32BE(offset) & 0x7fffffff) % 1_000_000)
    .toString()
    .padStart(6, "0");
}

it("maps native authentication values explicitly", () => {
  expect(mapSqliteValue(1, "boolean")).toBe(true);
  expect(mapSqliteValue(0, "boolean")).toBe(false);
  expect(mapSqliteValue(1700000000000, "timestamp with time zone")).toEqual(
    new Date(1700000000000),
  );
  expect(mapSqliteValue('["read","write"]', "ARRAY")).toEqual([
    "read",
    "write",
  ]);
  expect(() => mapSqliteValue(2, "boolean")).toThrow();
});
it("provides safe CLI-compatible Unicode diagnostics", () => {
  const error = new ImportTextCompatibilityError(
    "savia_core",
    "crm_records",
    "data",
  );
  expect(error.message).toBe(
    "Unsupported PostgreSQL text in savia_core.crm_records.data.",
  );
});
it("requires PostgreSQL when explicitly selected", () => {
  if (postgresTestsRequired) expect(postgresTestUrl).toBeTruthy();
});
it.skipIf(!postgresTestUrl)(
  "imports actual application stores without source writes and rejects existing targets",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "savia-import-"));
    const config = loadConfiguration({
      SAVIA_DATA_DIR: directory,
      SAVIA_PUBLIC_ORIGIN: "http://localhost:8080",
      SAVIA_AUTH_SECRET: "import-auth-secret-".repeat(4),
      SAVIA_ENCRYPTION_KEY: "import-encryption-".repeat(4),
      SAVIA_CAPTCHA_SECRET: "import-captcha-".repeat(4),
      SAVIA_BOOTSTRAP_EMAIL: "import@example.test",
      SAVIA_BOOTSTRAP_PASSWORD: "Import-test-password-123!",
      S3_ENDPOINT: "http://127.0.0.1:1",
      S3_PUBLIC_ENDPOINT: "http://127.0.0.1:1",
      S3_ACCESS_KEY_ID: "test",
      S3_SECRET_ACCESS_KEY: "test-secret-for-import",
    });
    try {
      let app = await createApplication(config, {});
      const cookies = new Map<string, string>();
      async function auth(path: string, body: unknown) {
        const response = await app.fetch(
          new Request("http://localhost:8080/api/auth/" + path, {
            method: "POST",
            headers: {
              origin: "http://localhost:8080",
              "content-type": "application/json",
              cookie: [...cookies].map(([k, v]) => k + "=" + v).join("; "),
            },
            body: JSON.stringify(body),
          }),
        );
        for (const item of response.headers.getSetCookie()) {
          const pair = item.split(";")[0];
          const i = pair.indexOf("=");
          cookies.set(pair.slice(0, i), pair.slice(i + 1));
        }
        expect(response.status, await response.clone().text()).toBe(200);
        return response.json() as Promise<any>;
      }
      await auth("sign-in/email", {
        email: "import@example.test",
        password: "Import-test-password-123!",
      });
      const enrollment = await auth("two-factor/enable", {
        password: "Import-test-password-123!",
        method: "totp",
      });
      await auth("two-factor/verify-totp", { code: totp(enrollment.totpURI) });
      const base = "/v1/data-domains/platform/api";
      async function api(path: string, method = "GET", body?: unknown) {
        const response = await app.fetch(
          new Request("http://localhost:8080" + base + path, {
            method,
            headers: {
              origin: "http://localhost:8080",
              "content-type": "application/json",
              cookie: [...cookies].map(([k, v]) => k + "=" + v).join("; "),
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          }),
        );
        expect(response.status, await response.clone().text()).toBeLessThan(
          300,
        );
        return response.json() as Promise<any>;
      }
      await api("/objects", "POST", {
        name: "import_contacts",
        label: "Import contacts",
        config: makeConfig({
          name: { type: "Textbox", label: "Name", required: true },
        }),
      });
      await api("/record-history-settings/import_contacts", "PUT", {
        enabled: true,
        fields: ["name"],
        retentionDays: 90,
        expectedVersion: 1,
      });
      const contact = (
        await api("/records/import_contacts", "POST", { name: "Original" })
      ).data;
      const removed = (
        await api("/records/import_contacts", "POST", { name: "Delete me" })
      ).data;
      const oldPull = await api("/local-sync/pull/import_contacts");
      await api("/records/import_contacts/" + contact.id, "PATCH", {
        name: "Preserved history",
        _version: contact._version,
      });
      await api(
        "/records/import_contacts/" +
          removed.id +
          "?version=" +
          removed._version,
        "DELETE",
      );
      const oldCursorPath =
        "/local-sync/pull/import_contacts?cursor=" +
        encodeURIComponent(oldPull.cursor);
      const expectedPull = await api(oldCursorPath);
      const expectedHistory = await api(
        "/record-history/import_contacts/" + contact.id,
      );
      expect(expectedHistory.data.length).toBeGreaterThan(0);
      expect(expectedPull.documents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: removed.id,
            deleted_at: expect.any(String),
          }),
        ]),
      );
      await app.close();
      const encrypted = await encryptSecret(
        "fixture-credential",
        config.encryptionKey,
        "import-fixture",
      );
      const requestSource = new DatabaseSync(join(directory, "request.sqlite"));
      requestSource.prepare("INSERT INTO flows(id,definition) VALUES(?,?)").run(
        "import-flow",
        JSON.stringify({
          fileKey: "tenant/import/original.pdf",
          literal: String.raw`\u0000`,
        }),
      );
      requestSource
        .prepare(
          "INSERT INTO flow_variables(flow_id,key,value,secret) VALUES(?,?,?,1)",
        )
        .run("import-flow", "credential", encrypted);
      const pageFixture = requestSource.prepare(
        "INSERT INTO flows(id,definition) VALUES(?,?)",
      );
      for (let i = 0; i < 1001; i++)
        pageFixture.run("page-" + i, JSON.stringify({ number: i }));
      requestSource.close();
      const coreSource = new DatabaseSync(join(directory, "core.sqlite"));
      coreSource
        .prepare("INSERT INTO countries(id,name,code) VALUES(?,?,?)")
        .run(900000, "Import fixture", "IF");
      coreSource.close();
      const checksums = async () =>
        Promise.all(
          ["core", "auth", "request"].map(async (n) =>
            createHash("sha256")
              .update(await readFile(join(directory, n + ".sqlite")))
              .digest("hex"),
          ),
        );
      // A stopped SQLite WAL database has no sidecars but retains WAL mode in
      // its header. The importer must not need writes even to the directory.
      const sourceFiles = ["core.sqlite", "auth.sqlite", "request.sqlite"];
      for (const file of sourceFiles) await chmod(join(directory, file), 0o444);
      await chmod(directory, 0o555);
      const before = await checksums();
      await withPostgresFixture(async (db, url) => {
        const report = await importSqlite({
          sourceDirectory: directory,
          destinationUrl: url,
        });
        expect(report.verified).toBe(true);
        expect((await readdir(directory)).sort()).toEqual(
          [...sourceFiles].sort(),
        );
        expect(
          report.tables.find(
            (t) => t.schema === "savia_request" && t.table === "flows",
          )?.importedRows,
        ).toBe(1002);
        const nextCountry = await db
          .prepare("INSERT INTO countries(name,code) VALUES(?,?) RETURNING id")
          .bind("Next imported country", "NI")
          .first<number>("id");
        expect(nextCountry).toBeGreaterThan(900000);

        const importedSecret = await db
          .prepare(
            "SELECT value FROM savia_request.flow_variables WHERE flow_id='import-flow' AND key='credential'",
          )
          .first<string>("value");
        expect(
          await decryptSecret(
            importedSecret!,
            config.encryptionKey,
            "import-fixture",
          ),
        ).toBe("fixture-credential");
        expect(
          await db
            .prepare(
              "SELECT definition FROM savia_request.flows WHERE id='import-flow'",
            )
            .first("definition"),
        ).toContain("tenant/import/original.pdf");
        expect(
          report.tables.every((t) => t.sourceRows === t.importedRows),
        ).toBe(true);
        expect(
          report.tables.find(
            (t) => t.schema === "savia_auth" && t.table === "user",
          )?.importedRows,
        ).toBeGreaterThan(0);
        await expect(
          importSqlite({ sourceDirectory: directory, destinationUrl: url }),
        ).rejects.toThrow("brand-new");
        expect(await checksums()).toEqual(before);
        app = await createApplication(
          {
            ...config,
            database: {
              driver: "postgres",
              connectionString: url,
              maxConnections: 3,
            },
          },
          {},
        );
        try {
          cookies.clear();
          const signin = await auth("sign-in/email", {
            email: "import@example.test",
            password: "Import-test-password-123!",
          });
          expect(signin.twoFactorRedirect).toBe(true);
          await auth("two-factor/verify-totp", {
            code: totp(enrollment.totpURI),
          });
          const importedPull = await api(oldCursorPath);
          expect(importedPull.documents).toEqual(expectedPull.documents);
          expect(importedPull.cursor).toBe(expectedPull.cursor);
          expect(
            (await api("/record-history/import_contacts/" + contact.id)).data,
          ).toEqual(expectedHistory.data);
        } finally {
          await app.close();
        }
      });
      await withPostgresFixture(async (db, url) => {
        const query = pg.Client.prototype.query;
        let copiedAuthentication = false;
        const fault = vi
          .spyOn(pg.Client.prototype, "query")
          .mockImplementation(function (this: pg.Client, ...args: unknown[]) {
            const sql = typeof args[0] === "string" ? args[0] : "";
            if (sql.startsWith('INSERT INTO "savia_auth"."user"'))
              copiedAuthentication = true;
            if (sql.startsWith('INSERT INTO "savia_core"."countries"'))
              return Promise.reject(new Error("Injected row-copy failure"));
            return Reflect.apply(query, this, args);
          } as typeof query);
        try {
          await expect(
            importSqlite({ sourceDirectory: directory, destinationUrl: url }),
          ).rejects.toThrow("Injected row-copy failure");
          expect(copiedAuthentication).toBe(true);
        } finally {
          fault.mockRestore();
        }
        for (const [schema, table] of [
          ["savia_auth", "user"],
          ["savia_core", "crm_records"],
          ["savia_request", "flows"],
        ]) {
          expect(
            await db
              .prepare(`SELECT COUNT(*) AS n FROM "${schema}"."${table}"`)
              .first("n"),
          ).toBe(0);
        }
        expect(await checksums()).toEqual(before);
      });
      await chmod(directory, 0o755);
      for (const file of sourceFiles) await chmod(join(directory, file), 0o644);
      const sqlite = new DatabaseSync(join(directory, "core.sqlite"));
      sqlite.exec("CREATE TABLE unsupported_source(id TEXT)");
      sqlite.close();
      const failureBefore = await checksums();
      await withPostgresFixture(async (db, url) => {
        await expect(
          importSqlite({ sourceDirectory: directory, destinationUrl: url }),
        ).rejects.toThrow("Unsupported source tables");
        expect(
          await db
            .prepare('SELECT COUNT(*) AS n FROM savia_auth."user"')
            .first("n"),
        ).toBe(0);
        expect(await checksums()).toEqual(failureBefore);
      });
      const nulSource = new DatabaseSync(join(directory, "request.sqlite"));
      nulSource
        .prepare("UPDATE flows SET definition=? WHERE id=?")
        .run(
          String.raw`{"duplicate":"\u0000","duplicate":"valid"}`,
          "import-flow",
        );
      nulSource.close();
      await expect(
        importSqlite({
          sourceDirectory: directory,
          destinationUrl: "postgresql://unused",
        }),
      ).rejects.toThrow(
        "Unsupported PostgreSQL text in savia_request.flows.definition",
      );
      const cleanSource = new DatabaseSync(join(directory, "request.sqlite"));
      cleanSource
        .prepare("UPDATE flows SET definition=? WHERE id=?")
        .run("{}", "import-flow");
      cleanSource.close();
      const changedHistory = new DatabaseSync(join(directory, "core.sqlite"));
      changedHistory.exec(
        "UPDATE _savia_sqlite_migrations SET checksum='changed' WHERE position=0",
      );
      changedHistory.close();
      await expect(
        importSqlite({
          sourceDirectory: directory,
          destinationUrl: "postgresql://unused",
        }),
      ).rejects.toThrow("Unsupported source migration history");
    } finally {
      await chmod(directory, 0o755);
      await rm(directory, { recursive: true, force: true });
    }
  },
  120000,
);
