import { describe, expect, it } from "vitest";
import { postgresDialect } from "@savia/db/postgres-dialect";
import { WhatsappInboundRepository } from "../src/whatsapp/inbound-repository";

describe("WhatsApp inbound PostgreSQL SQL", () => {
  it("uses PostgreSQL JSON and scalar expressions for receipts and completion", async () => {
    const statements: Array<{ sql: string; parameters: unknown[] }> = [];
    const database = {
      prepare(sql: string) {
        const query = {
          sql,
          parameters: [] as unknown[],
          bind(...parameters: unknown[]) {
            query.parameters = parameters;
            return query;
          },
        };
        statements.push(query);
        return query;
      },
      async batch(queries: Array<{ sql: string }>) {
        return queries.map((_, index) => ({
          success: true as const,
          results: [],
          meta: { changes: index === 0 ? 1 : 0 },
        }));
      },
    } as unknown as D1Database;
    const repository = new WhatsappInboundRepository(database, postgresDialect);

    await repository.receipt({
      phoneNumberId: "phone",
      wabaId: "waba",
      messageId: "outbound",
      status: "failed",
      errorCode: "131042",
    });
    await repository.complete("inbound", "fence", "outbound");

    const sql = statements.map((statement) => statement.sql).join("\n");
    expect(sql).toContain("GREATEST(");
    expect(sql).toContain("jsonb_array_elements_text");
    expect(sql).toContain("jsonb_build_array");
    expect(sql).not.toMatch(/\bjson_each\s*\(|\bjson_insert\s*\(|\bMAX\s*\(/i);
    for (const statement of statements)
      expect(statement.parameters).toHaveLength(
        (statement.sql.match(/\?/g) ?? []).length,
      );
  });
});
