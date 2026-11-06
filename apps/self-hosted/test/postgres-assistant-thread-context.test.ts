import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AssistantThreadRepository } from "../../api/src/assistant/threads";
import { migratePostgres } from "../src/postgres/migrations.js";
import { withPostgresFixture } from "./postgres-fixture.js";

const url = process.env.SAVIA_TEST_POSTGRES_URL;
const live = url ? describe : describe.skip;
const coreDirectory = new URL("../../../packages/db/postgres", import.meta.url)
  .pathname;

live("PostgreSQL assistant thread context lookup", () => {
  it("keeps identical source ids isolated by their persisted workspace", async () => {
    await withPostgresFixture(async (db, connectionString) => {
      await migratePostgres({
        connectionString,
        schema: "savia_core",
        directory: coreDirectory,
        seed: false,
      });
      await db
        .prepare(
          `INSERT INTO identity_principal
           (id, issuer, subject, email, display_name, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
        )
        .bind(
          "assistant-context-owner",
          "savia:test",
          "assistant-context-owner",
          "assistant-context-owner@example.test",
          "Assistant Context Owner",
          "2026-10-04T00:00:00.000Z",
          "2026-10-04T00:00:00.000Z",
        )
        .run();

      const repository = new AssistantThreadRepository(db);
      const sourceId = randomUUID();
      const tenantAThreadId = randomUUID();
      const tenantBThreadId = randomUUID();
      const personalThreadId = randomUUID();
      const save = (id: string, tenantId: number) =>
        repository.save(
          "assistant-context-owner",
          id,
          {
            title: "Session review",
            messages: [
              {
                role: "user",
                parts: [{ type: "text", text: "Review this session" }],
              },
            ],
            context: { kind: "session", id: sourceId, title: "Session" },
            expectedRevision: 0,
          },
          tenantId,
        );

      await save(tenantAThreadId, 101);
      await save(tenantBThreadId, 202);
      await repository.save(
        "assistant-context-owner",
        personalThreadId,
        {
          title: "Personal session review",
          messages: [],
          context: { kind: "session", id: sourceId, title: "Session" },
          expectedRevision: 0,
        },
        null,
      );

      expect(
        await repository.findByContext(
          "assistant-context-owner",
          "session",
          sourceId,
          101,
        ),
      ).toMatchObject({ id: tenantAThreadId, context: { tenantId: 101 } });
      expect(
        await repository.findByContext(
          "assistant-context-owner",
          "session",
          sourceId,
          202,
        ),
      ).toMatchObject({ id: tenantBThreadId, context: { tenantId: 202 } });
      expect(
        await repository.findSummaryByContext(
          "assistant-context-owner",
          "session",
          sourceId,
          202,
        ),
      ).toMatchObject({ id: tenantBThreadId, context: { tenantId: 202 } });
      expect(
        await repository.findByContext(
          "assistant-context-owner",
          "session",
          sourceId,
          null,
        ),
      ).toMatchObject({ id: personalThreadId, context: { tenantId: null } });
      const summaries = await repository.listSummaries(
        "assistant-context-owner",
      );
      expect(summaries).toHaveLength(3);
      expect(summaries.every((summary) => !("messages" in summary))).toBe(true);
    });
  }, 120_000);
});
