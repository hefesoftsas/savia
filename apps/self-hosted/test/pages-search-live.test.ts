import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createPagesSearchBindings } from "../src/pages-search";
import { openSqliteDatabase } from "../src/sqlite";
import { CloudflarePagesSearch } from "../../api/src/pages/cloudflare-search";
import { PagesService } from "../../api/src/pages/service";
import {
  grantMembership,
  loadActor,
  upsertPrincipal,
} from "../../api/src/auth/identity-repository";

const qdrantUrl = process.env.SAVIA_TEST_QDRANT_URL;
describe.skipIf(!qdrantUrl)("Pages with native SQLite and live Qdrant", () => {
  it("persists embeddings and enforces tenant namespaces, current permissions and page versions", async () => {
    const collection = `savia-pages-test-${randomUUID()}`;
    const db = openSqliteDatabase(":memory:");
    const vector = Array(1024).fill(0.5);
    const localFetch: typeof fetch = async (input, init) => {
      if (String(input).startsWith("http://embedding-fixture/")) {
        const body = JSON.parse(String(init?.body));
        return Response.json({ embeddings: body.input.map(() => vector) });
      }
      return fetch(input, init);
    };
    const environment = {
      SAVIA_PAGES_SEARCH_ENABLED: "true",
      SAVIA_PAGES_OLLAMA_URL: "http://embedding-fixture",
      SAVIA_PAGES_QDRANT_URL: qdrantUrl!,
      SAVIA_PAGES_QDRANT_COLLECTION: collection,
    };
    try {
      await db.migrate(
        resolve(import.meta.dirname, "../../../packages/db/migrations"),
      );
      for (const id of [986901, 986902]) {
        await db
          .prepare(
            "INSERT INTO tenants(id,id_slug,name,kind,is_active,created_at,updated_at) VALUES(?,?,?,'commercial',1,'2026-10-03','2026-10-03')",
          )
          .bind(id, `tenant-${id}`, `Tenant ${id}`)
          .run();
        await db
          .prepare(
            "INSERT INTO tenant_pages_search_settings(tenant_id,allowed,enabled,updated_at) VALUES(?,1,1,'2026-10-03')",
          )
          .bind(id)
          .run();
      }
      const owner = await upsertPrincipal(db, {
        issuer: "savia:test",
        subject: "owner",
        email: "owner@test.example",
        displayName: "Owner",
      });
      const neighbor = await upsertPrincipal(db, {
        issuer: "savia:test",
        subject: "neighbor",
        email: "neighbor@test.example",
        displayName: "Neighbor",
      });
      const outsider = await upsertPrincipal(db, {
        issuer: "savia:test",
        subject: "outsider",
        email: "outsider@test.example",
        displayName: "Outsider",
      });
      await grantMembership(db, owner.id, 986901, "viewer");
      await grantMembership(db, neighbor.id, 986902, "viewer");
      await grantMembership(db, outsider.id, 986901, "viewer");
      const actor = await loadActor(db, owner);
      const neighborActor = await loadActor(db, neighbor);
      const outsiderActor = await loadActor(db, outsider);
      const pages = new PagesService(db, actor);
      const page = await pages.create({ title: "Insurance contracts" });
      const neighborPage = await new PagesService(db, neighborActor).create({
        title: "Private neighbor contracts",
      });
      let bindings = createPagesSearchBindings(environment, localFetch);
      const search = new CloudflarePagesSearch(db, actor, bindings);
      await search.indexPage(page.id);
      await new CloudflarePagesSearch(db, neighborActor, bindings).indexPage(
        neighborPage.id,
      );
      // Recreating the adapter must query persisted provider data, not local state.
      bindings = createPagesSearchBindings(environment, localFetch);
      const reopened = new CloudflarePagesSearch(db, actor, bindings);
      expect((await reopened.search("contracts")).map((hit) => hit.id)).toEqual(
        [page.id],
      );
      expect(
        await new CloudflarePagesSearch(db, outsiderActor, bindings).search(
          "contracts",
        ),
      ).toEqual([]);
      await pages.save(page.id, {
        title: "Renewal contracts",
        content: [
          { type: "p", children: [{ text: "Updated contract renewal" }] },
        ],
        version: 1,
      });
      expect(await reopened.search("contracts")).toEqual([]);
      await reopened.indexPage(page.id);
      expect(await reopened.status()).toMatchObject({ indexed: 1, needed: [] });
      expect((await reopened.search("renewal")).map((hit) => hit.id)).toEqual([
        page.id,
      ]);
      await db
        .prepare(
          "UPDATE tenant_pages_search_settings SET allowed=0,enabled=0 WHERE tenant_id=986901",
        )
        .run();
      await expect(reopened.search("renewal")).rejects.toMatchObject({
        status: 403,
        code: "SEARCH_DISABLED",
      });
    } finally {
      db.close();
      await fetch(`${qdrantUrl}/collections/${collection}`, {
        method: "DELETE",
      });
    }
  });
});
