import { expect, it } from "vitest";
import {
  ensureAuthNoticeSchema,
  readAuthNoticeEvents,
} from "../../auth/src/notification-events";
import { postgresTestUrl, withPostgresFixture } from "./postgres-fixture";

it.skipIf(!postgresTestUrl)(
  "captures native PostgreSQL email and two-factor transitions",
  async () => {
    await withPostgresFixture(async (db) => {
      await db
        .prepare(
          `CREATE TABLE "user" (id TEXT PRIMARY KEY, "emailVerified" BOOLEAN, "twoFactorEnabled" BOOLEAN, "updatedAt" TIMESTAMP NOT NULL)`,
        )
        .run();
      await ensureAuthNoticeSchema(db);
      await ensureAuthNoticeSchema(db);
      await db
        .prepare(`INSERT INTO "user" VALUES ('p',false,false,'2026-09-28')`)
        .run();
      await db.prepare(`UPDATE "user" SET "emailVerified"=true`).run();
      await db.prepare(`UPDATE "user" SET "twoFactorEnabled"=true`).run();
      // Updates without a transition must not emit duplicate notices.
      await db.prepare(`UPDATE "user" SET "emailVerified"=true`).run();
      const events = await readAuthNoticeEvents(db, null, 10);
      expect(events.map((event) => event.kind).sort()).toEqual([
        "email-verified",
        "two-factor-enabled",
      ]);
      expect(
        events.every((event) => event.subject === "p" && event.createdAt > 0),
      ).toBe(true);
    });
  },
);
