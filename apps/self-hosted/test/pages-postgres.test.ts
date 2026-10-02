import { resolve } from "node:path";
import type { AppActor } from "../../api/src/auth/types";
import { PagesError, PagesService } from "../../api/src/pages/service";
import { migratePostgres } from "../src/postgres/migrations.js";
import { postgresTestUrl, withPostgresFixture } from "./postgres-fixture.js";
import { describe, expect, it } from "vitest";

const coreDirectory = resolve(
  import.meta.dirname,
  "../../../packages/db/postgres",
);

function actor(id: string, tenantId = 9201): AppActor {
  return {
    principal: {
      id,
      issuer: "savia:test",
      subject: id,
      email: `${id}@savia.test`,
      displayName: id,
      isActive: true,
      createdAt: "2026-09-05T00:00:00.000Z",
      updatedAt: "2026-09-05T00:00:00.000Z",
    },
    globalRoles: [],
    memberships: [
      {
        id: `membership-${id}`,
        principalId: id,
        agencyId: tenantId,
        tenantId,
        role: "viewer",
        isActive: true,
        createdAt: "2026-09-05T00:00:00.000Z",
        updatedAt: "2026-09-05T00:00:00.000Z",
      },
    ],
  };
}

const live = postgresTestUrl ? describe : describe.skip;

live("Pages on native PostgreSQL", () => {
  it("migrates Pages and issue providers, then enforces native persistence and access rules", async () => {
    await withPostgresFixture(async (db, connectionString) => {
      await migratePostgres({
        connectionString,
        schema: "savia_core",
        directory: coreDirectory,
        seed: false,
      });

      const schema = await db
        .prepare(
          `SELECT table_name,column_name FROM information_schema.columns
           WHERE table_schema='savia_core' AND table_name IN ('pages','page_revisions','page_shares','page_files')
           ORDER BY table_name,ordinal_position`,
        )
        .all<{ table_name: string; column_name: string }>();
      const columns = new Map<string, string[]>();
      for (const item of schema.results) {
        const values = columns.get(item.table_name) ?? [];
        values.push(item.column_name);
        columns.set(item.table_name, values);
      }
      expect([...columns.keys()].sort()).toEqual([
        "page_files",
        "page_revisions",
        "page_shares",
        "pages",
      ]);
      expect(columns.get("pages")).toEqual(
        expect.arrayContaining([
          "id",
          "kind",
          "tenant_id",
          "owner_id",
          "parent_id",
          "root_id",
          "title",
          "content_json",
          "search_text",
          "version",
          "share_version",
        ]),
      );

      await db
        .prepare(
          `INSERT INTO tenants(id,id_slug,name,is_active,created_at,updated_at)
           VALUES(0,'platform','Platform',1,'2026-09-05','2026-09-05'),
                 (9201,'pages-one','Pages One',1,'2026-09-05','2026-09-05'),
                 (9202,'pages-two','Pages Two',1,'2026-09-05','2026-09-05')`,
        )
        .run();
      for (const id of [
        "page-owner",
        "page-reader",
        "page-outsider",
        "page-platform",
      ]) {
        await db
          .prepare(
            `INSERT INTO identity_principal(id,issuer,subject,email,display_name,is_active,created_at,updated_at)
             VALUES(?,'savia:test',?,?,?,1,'2026-09-05','2026-09-05')`,
          )
          .bind(id, id, `${id}@savia.test`, id)
          .run();
      }
      for (const [id, principalId, tenantId] of [
        ["membership-owner", "page-owner", 9201],
        ["membership-reader", "page-reader", 9201],
        ["membership-outsider", "page-outsider", 9202],
        ["membership-platform", "page-platform", 0],
      ] as const) {
        await db
          .prepare(
            `INSERT INTO identity_tenant_membership(id,principal_id,tenant_id,role,is_active,created_at,updated_at)
             VALUES(?,?,?,'viewer',1,'2026-09-05','2026-09-05')`,
          )
          .bind(id, principalId, tenantId)
          .run();
      }

      // 0009 must extend the pre-existing provider constraint while preserving rows.
      for (const [id, provider] of [
        ["jira-connection", "jira"],
        ["linear-connection", "linear"],
      ] as const) {
        await db
          .prepare(
            `INSERT INTO personal_integration_connections(
              id,principal_id,provider,nango_connection_id,nango_integration_id,status,created_at,updated_at
            ) VALUES(?,'page-owner',?,?,'test-integration','connected','2026-09-05','2026-09-05')`,
          )
          .bind(id, provider, `${provider}-external`)
          .run();
      }
      expect(
        (
          await db
            .prepare(
              "SELECT provider FROM personal_integration_connections ORDER BY provider",
            )
            .all<{ provider: string }>()
        ).results.map((row) => row.provider),
      ).toEqual(["jira", "linear"]);

      const owner = new PagesService(db, actor("page-owner"));
      const reader = new PagesService(db, actor("page-reader"));
      const outsider = new PagesService(db, actor("page-outsider", 9202));
      const platform = new PagesService(db, actor("page-platform", 0));
      const platformPage = await platform.create({ title: "Platform notes" });
      const updatedPlatformPage = await platform.save(platformPage.id, {
        title: "Platform notes updated",
        version: platformPage.version,
        content: [],
      });
      await platform.remove(
        updatedPlatformPage.id,
        updatedPlatformPage.version,
      );
      const root = await owner.create({ title: "Quarterly notes" });
      const richPage = await owner.create({ title: "Rich block persistence" });
      const richContent = [
        {
          type: "code_block",
          language: "typescript",
          children: [{ text: "const value = 1;\n\n  value  " }],
        },
        { type: "todo", checked: true, children: [{ text: "Persisted task" }] },
        { type: "numbered", children: [{ text: "Numbered item" }] },
        { type: "divider", children: [{ text: "" }] },
        { type: "callout", children: [{ text: "Read this" }] },
        {
          type: "toggle",
          children: [
            { type: "p", children: [{ text: "Summary" }] },
            { type: "p", children: [{ text: "Details" }] },
          ],
        },
        {
          type: "table",
          children: [
            {
              type: "table_row",
              children: [
                {
                  type: "table_cell",
                  children: [{ type: "p", children: [{ text: "Left" }] }],
                },
                {
                  type: "table_cell",
                  children: [{ type: "p", children: [{ text: "Right" }] }],
                },
              ],
            },
          ],
        },
      ];
      const persistedRichPage = await owner.save(richPage.id, {
        title: richPage.title,
        version: richPage.version,
        content: richContent,
      });
      expect(persistedRichPage.content).toEqual(richContent);
      const folder = await owner.create({ title: "Folder", kind: "folder" });
      expect(folder).toMatchObject({
        kind: "folder",
        content: [],
        binding: null,
      });
      expect(
        await db
          .prepare("SELECT kind FROM pages WHERE id=?")
          .bind(folder.id)
          .first(),
      ).toEqual({ kind: "folder" });
      await owner.remove(folder.id, folder.version);
      const child = await owner.create({
        title: "Nested notes",
        parentId: root.id,
      });

      await expect(owner.remove(root.id, root.version)).rejects.toMatchObject({
        status: 409,
        code: "PAGE_HAS_CHILDREN",
      });

      const saved = await owner.save(root.id, {
        title: "Quarterly notes updated",
        version: 1,
        content: [{ type: "p", children: [{ text: "First snapshot" }] }],
      });
      const secondSave = await owner.save(root.id, {
        title: "Quarterly notes current",
        version: saved.version,
        content: [{ type: "p", children: [{ text: "Current snapshot" }] }],
      });
      const restored = await owner.restore(root.id, {
        revision: saved.version,
        version: secondSave.version,
      });
      expect(restored).toMatchObject({
        title: "Quarterly notes updated",
        version: 4,
        content: [{ type: "p", children: [{ text: "First snapshot" }] }],
      });

      const concurrentSaves = await Promise.allSettled([
        owner.save(root.id, {
          title: "Winner A",
          version: restored.version,
          content: [],
        }),
        owner.save(root.id, {
          title: "Winner B",
          version: restored.version,
          content: [],
        }),
      ]);
      expect(
        concurrentSaves.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        concurrentSaves.filter((result) => result.status === "rejected"),
      ).toHaveLength(1);
      const saveFailure = concurrentSaves.find(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      )!;
      const saveConflictIsMapped =
        saveFailure.reason instanceof PagesError &&
        saveFailure.reason.status === 409 &&
        saveFailure.reason.code === "VERSION_CONFLICT";
      const winner = await owner.get(root.id);

      const file = await owner.saveFile(child.id, {
        id: "page-file-one",
        name: "report.txt",
        mimeType: "text/plain",
        size: 12,
        storageKey: "pages/page-file-one",
      });
      const shares = await owner.setShares(root.id, {
        version: 1,
        shares: [{ principalId: "page-reader", role: "editor" }],
      });
      const competingShares = await Promise.allSettled([
        owner.setShares(root.id, {
          version: shares.version,
          shares: [{ principalId: "page-reader", role: "editor" }],
        }),
        owner.setShares(root.id, {
          version: shares.version,
          shares: [],
        }),
      ]);
      expect(
        competingShares.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        competingShares.filter((result) => result.status === "rejected"),
      ).toHaveLength(1);
      const shareFailure = competingShares.find(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      )!;
      const shareConflictIsMapped =
        shareFailure.reason instanceof PagesError &&
        shareFailure.reason.status === 409 &&
        shareFailure.reason.code === "VERSION_CONFLICT";
      const shareWinner = await owner.shares(root.id);

      if (shareWinner.shares.length === 0) {
        const regrant = await owner.setShares(root.id, {
          version: shareWinner.version,
          shares: [{ principalId: "page-reader", role: "editor" }],
        });
        expect(regrant.shares).toEqual([
          { principalId: "page-reader", role: "editor" },
        ]);
      }
      expect((await reader.get(child.id)).role).toBe("editor");
      expect(await reader.file(child.id, file.id)).toMatchObject({
        storage_key: "pages/page-file-one",
        file_name: "report.txt",
      });
      await expect(outsider.get(root.id)).rejects.toMatchObject({
        status: 404,
      });

      const finalShares = await owner.shares(root.id);
      await owner.setShares(root.id, {
        version: finalShares.version,
        shares: [],
      });
      await expect(reader.get(child.id)).rejects.toMatchObject({ status: 404 });
      await expect(reader.file(child.id, file.id)).rejects.toMatchObject({
        status: 404,
        code: "PAGE_NOT_FOUND",
      });

      for (const title of [
        "Budget 100% ready",
        "Budget 100X ready",
        "Plan_ahead",
        "PlanXa",
      ]) {
        await owner.create({ title });
      }
      expect((await owner.list("100%")).map((page) => page.title)).toEqual([
        "Budget 100% ready",
      ]);
      expect((await owner.list("_")).map((page) => page.title)).toEqual([
        "Plan_ahead",
      ]);

      await owner.remove(child.id, child.version);
      await owner.remove(root.id, winner.version);
      await expect(owner.get(root.id)).rejects.toMatchObject({ status: 404 });

      expect(
        saveConflictIsMapped,
        "stale concurrent saves return HTTP 409",
      ).toBe(true);
      expect(
        shareConflictIsMapped,
        "stale concurrent share updates return HTTP 409",
      ).toBe(true);
    });
  }, 120_000);
});
