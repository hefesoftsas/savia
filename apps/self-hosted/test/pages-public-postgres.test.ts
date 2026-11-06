import { resolve } from "node:path";
import type { AppActor } from "../../api/src/auth/types";
import {
  createPublicPageShortUrl,
  createPublicPageLink,
  getPublicPage,
  publicPageTokenForShortCode,
  revokePublicPageLink,
} from "../../api/src/pages/public-sharing";
import { PagesService } from "../../api/src/pages/service";
import { migratePostgres } from "../src/postgres/migrations.js";
import { postgresTestUrl, withPostgresFixture } from "./postgres-fixture.js";
import { describe, expect, it } from "vitest";

const coreDirectory = resolve(
  import.meta.dirname,
  "../../../packages/db/postgres",
);
const live = postgresTestUrl ? describe : describe.skip;

function actor(id: string, tenantId = 9231): AppActor {
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

live("Public Pages on native PostgreSQL", () => {
  it("migrates public links, lists real active members, and resolves a selected subtree", async () => {
    await withPostgresFixture(async (db, connectionString) => {
      await migratePostgres({
        connectionString,
        schema: "savia_core",
        directory: coreDirectory,
        seed: false,
      });
      await db
        .prepare(
          `INSERT INTO tenants(id,id_slug,name,is_active,created_at,updated_at)
           VALUES(9231,'public-pages','Public Pages',1,'2026-09-05','2026-09-05')`,
        )
        .run();
      for (const id of ["public-owner", "public-member"]) {
        await db
          .prepare(
            `INSERT INTO identity_principal(id,issuer,subject,email,display_name,is_active,created_at,updated_at)
             VALUES(?,'savia:test',?,?,?,1,'2026-09-05','2026-09-05')`,
          )
          .bind(id, id, `${id}@savia.test`, id)
          .run();
        await db
          .prepare(
            `INSERT INTO identity_tenant_membership(id,principal_id,tenant_id,role,is_active,created_at,updated_at)
             VALUES(?,?,9231,'viewer',1,'2026-09-05','2026-09-05')`,
          )
          .bind(`membership-${id}`, id)
          .run();
      }
      const owner = actor("public-owner");
      const pages = new PagesService(db, owner);
      const folder = await pages.create({ title: "Workspace", kind: "folder" });
      const grant = await pages.create({
        title: "Shared notes",
        parentId: folder.id,
      });
      await pages.create({ title: "Child note", parentId: grant.id });
      const activeMembers = await pages.members("");
      expect(activeMembers.map((member) => member.principalId)).toContain(
        "public-member",
      );
      const link = await createPublicPageLink(db, owner, grant.id);
      const result = await getPublicPage(db, link.path.split("/").at(-1)!);
      expect(result.root).toEqual({ id: grant.id, title: "Shared notes" });
      expect(result.children.map((child) => child.title)).toEqual([
        "Child note",
      ]);
      expect(result.page).not.toHaveProperty("ownerId");
      const shortUrl = await createPublicPageShortUrl(
        db,
        owner,
        grant.id,
        link.id,
        { requestUrl: "https://api.test/v1/pages" },
      );
      expect(shortUrl).toMatch(/^https:\/\/api\.test\/s\/p\/[a-f0-9]{24}$/);
      expect(
        await createPublicPageShortUrl(db, owner, grant.id, link.id, {
          requestUrl: "https://api.test/v1/pages",
        }),
      ).toBe(shortUrl);
      const code = new URL(shortUrl).pathname.split("/").at(-1)!;
      expect(await publicPageTokenForShortCode(db, code)).toBe(
        link.path.split("/").at(-1),
      );
      await revokePublicPageLink(db, owner, grant.id, link.id);
      await expect(
        getPublicPage(db, link.path.split("/").at(-1)!),
      ).rejects.toMatchObject({ status: 404 });

      const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const offsetExpiry = new Date(expiry.getTime() + 5 * 60 * 60 * 1000)
        .toISOString()
        .replace("Z", "+05:00");
      const expiring = await createPublicPageLink(
        db,
        owner,
        grant.id,
        offsetExpiry,
      );
      await db
        .prepare(
          "UPDATE page_public_links SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?",
        )
        .bind(expiring.id)
        .run();
      await expect(
        getPublicPage(db, expiring.path.split("/").at(-1)!),
      ).rejects.toMatchObject({ status: 404 });
    });
  });
});
