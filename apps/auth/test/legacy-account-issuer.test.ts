import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { createAuthHandler, initializeAuthSchema } from "../src/index";
import { ensureLegacyAccountIssuerOptional } from "../src/legacy-account-issuer";

const quote = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;

function splitDefinitions(sql: string): string[] {
  const opening = sql.indexOf("(");
  const definitions: string[] = [];
  let start = opening + 1;
  let depth = 0;
  let quoteChar = "";
  for (let index = start; index < sql.length; index += 1) {
    const char = sql[index];
    if (quoteChar) {
      if (char === quoteChar && sql[index + 1] === quoteChar) index += 1;
      else if (char === quoteChar) quoteChar = "";
      continue;
    }
    if (char === "'" || char === '"' || char === "`" || char === "[") {
      quoteChar = char === "[" ? "]" : char;
      continue;
    }
    if (char === "(") depth += 1;
    else if (char === ")") {
      if (depth === 0) {
        definitions.push(sql.slice(start, index).trim());
        break;
      }
      depth -= 1;
    } else if (char === "," && depth === 0) {
      definitions.push(sql.slice(start, index).trim());
      start = index + 1;
    }
  }
  return definitions;
}

function legacyTableSql(currentSql: string): string {
  const definitions = splitDefinitions(currentSql);
  const constraintIndex = definitions.findIndex((definition) =>
    /^(?:CONSTRAINT|PRIMARY\s+KEY|UNIQUE|CHECK|FOREIGN\s+KEY)\b/i.test(
      definition,
    ),
  );
  definitions.splice(
    constraintIndex < 0 ? definitions.length : constraintIndex,
    0,
    '"issuer" TEXT NOT NULL',
  );
  return `${currentSql.slice(0, currentSql.indexOf("("))}(${definitions.join(",")})`;
}

function databaseView(database: D1Database): D1Database {
  return {
    prepare: database.prepare.bind(database),
    batch: database.batch.bind(database),
    exec: database.exec.bind(database),
    dump: database.dump.bind(database),
    withSession: database.withSession.bind(database),
  };
}

it("repairs a legacy NOT NULL account issuer before Better Auth validates the D1 schema", async () => {
  await initializeAuthSchema(env);
  const database = env.AUTH_DB;
  const accountSchema = await database
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='account'",
    )
    .first<{ sql: string }>();
  expect(accountSchema?.sql).toBeTruthy();
  const accountColumns = await database
    .prepare('PRAGMA table_info("account")')
    .all<{ name: string }>();
  const columnNames = accountColumns.results.map((column) => column.name);
  const accountIndexes = await database
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='account' AND sql IS NOT NULL",
    )
    .all<{ sql: string }>();

  await database.batch([
    ...accountIndexes.results.map(({ sql }) =>
      database.prepare(
        `DROP INDEX ${sql.match(/INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(]+)/i)?.[1]}`,
      ),
    ),
    database.prepare(
      'ALTER TABLE "account" RENAME TO "account_before_issuer_test"',
    ),
    database.prepare(legacyTableSql(accountSchema!.sql)),
    database
      .prepare(
        `INSERT INTO "account" (${columnNames.map(quote).join(",")},"issuer")
         SELECT ${columnNames.map(quote).join(",")},? FROM "account_before_issuer_test"`,
      )
      .bind("https://legacy-issuer.example"),
    database.prepare('DROP TABLE "account_before_issuer_test"'),
    ...accountIndexes.results.map(({ sql }) => database.prepare(sql)),
    database.prepare(
      'CREATE UNIQUE INDEX "account_issuer_accountId_uidx" ON "account"("issuer","accountId")',
    ),
  ]);

  const email = `legacy-${crypto.randomUUID()}@savia.test`;
  const userId = `legacy-user-${crypto.randomUUID()}`;
  await database
    .prepare(
      `INSERT INTO "user" (id,name,email,emailVerified,createdAt,updatedAt)
       VALUES (?,?,?,1,0,0)`,
    )
    .bind(userId, "Legacy account", email)
    .run();
  await database
    .prepare(
      `INSERT INTO "account" (id,accountId,providerId,userId,password,accessToken,refreshToken,createdAt,updatedAt,issuer)
       VALUES (?,?,?,?,?,?,?,0,0,?)`,
    )
    .bind(
      "legacy-account-preserved",
      "legacy-subject",
      "google",
      userId,
      "legacy-password-hash",
      "legacy-access-token",
      "legacy-refresh-token",
      "https://legacy-issuer.example",
    )
    .run();

  const before = await database
    .prepare("SELECT * FROM account WHERE id='legacy-account-preserved'")
    .first<Record<string, unknown>>();
  await Promise.all([
    ensureLegacyAccountIssuerOptional(database),
    ensureLegacyAccountIssuerOptional(database),
  ]);

  const response = await createAuthHandler({
    ...env,
    AUTH_DB: databaseView(database),
  }).fetch(
    new Request("https://savia-auth.internal/_internal/oauth/admin-client"),
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ clientId: expect.any(String) });
  const after = await database
    .prepare("SELECT * FROM account WHERE id='legacy-account-preserved'")
    .first<Record<string, unknown>>();
  expect(after).toEqual(before);
  expect(
    await database
      .prepare('PRAGMA table_info("account")')
      .all<{ name: string; notnull: number }>(),
  ).toMatchObject({
    results: expect.arrayContaining([
      expect.objectContaining({ name: "issuer", notnull: 0 }),
    ]),
  });
  const indexes = await database
    .prepare('PRAGMA index_list("account")')
    .all<{ name: string }>();
  expect(indexes.results.map((index) => index.name)).not.toContain(
    "account_issuer_accountId_uidx",
  );
  expect(indexes.results.map((index) => index.name)).toContain(
    "account_userId_idx",
  );
  expect(
    await database
      .prepare('PRAGMA foreign_key_list("account")')
      .all<{ table: string; from: string; to: string }>(),
  ).toMatchObject({
    results: expect.arrayContaining([
      expect.objectContaining({ table: "user", from: "userId", to: "id" }),
    ]),
  });
});
