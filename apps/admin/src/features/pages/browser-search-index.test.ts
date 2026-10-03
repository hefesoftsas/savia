import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, expect, it } from "vitest";
import { openPageSearchIndex, pageTextChunks } from "./browser-search-index";
import {
  pageSearchCacheName,
  clearPageSearchCaches,
} from "./browser-search-cache";

afterEach(async () => {
  await clearPageSearchCaches();
});
const page = (id: string, version = 1, text = "Política de vacaciones") => ({
  id,
  version,
  title: `Page ${id}`,
  content: [{ type: "p", children: [{ text }] }],
});
const summary = (id: string, version = 1) => ({
  id,
  version,
  title: `Page ${id}`,
});

it("keeps inline words intact and includes the end of long rich text", () => {
  expect(
    pageTextChunks([
      {
        type: "p",
        children: [{ text: "vac" }, { text: "ations", bold: true }],
      },
      { type: "p", children: [{ text: "coffee" }] },
    ]),
  ).toEqual(["vacations coffee"]);
  const chunks = pageTextChunks([
    {
      children: [
        { text: "first " },
        { children: [{ text: "x".repeat(2600) + " last" }] },
      ],
    },
  ]);
  expect(chunks.at(-1)).toContain("last");
  expect(chunks.every((c) => c.length <= 1200)).toBe(true);
});
it("reopens a persisted index without needing unchanged pages", async () => {
  const first = await openPageSearchIndex("account-a", [summary("one")]);
  expect(first.plan.needed).toEqual(["one"]);
  await first.upsert(page("one"));
  expect((await first.search("politica")).map((x) => x.id)).toEqual(["one"]);
  first.close();
  const second = await openPageSearchIndex("account-a", [summary("one")]);
  expect(second.plan).toEqual({ needed: [], reused: 1, total: 1 });
  expect((await second.search("vacac")).map((x) => x.id)).toEqual(["one"]);
  second.close();
});
it("updates only changed pages, removes old terms and prunes revoked pages", async () => {
  const first = await openPageSearchIndex("account-b", [
    summary("one"),
    summary("revoked"),
  ]);
  await first.upsert(page("one"));
  await first.upsert(page("revoked"));
  first.close();
  const next = await openPageSearchIndex("account-b", [summary("one", 2)]);
  expect(next.plan.needed).toEqual(["one"]);
  expect(await next.search("vacaciones")).toEqual([]);
  await next.upsert(page("one", 2, "Trabajo remoto"));
  expect(await next.search("vacaciones")).toEqual([]);
  expect((await next.search("remoto")).map((x) => x.id)).toEqual(["one"]);
  next.close();
});
it("isolates principals and rebuilds an evicted or explicitly cleared index", async () => {
  const a = await openPageSearchIndex("private-user", [summary("private")]);
  await a.upsert(page("private"));
  a.close();
  const b = await openPageSearchIndex("other-user", [summary("private")]);
  expect(b.plan.reused).toBe(0);
  expect(await b.search("vacaciones")).toEqual([]);
  b.close();
  const rebuilt = await openPageSearchIndex(
    "private-user",
    [summary("private")],
    true,
  );
  expect(rebuilt.plan.needed).toEqual(["private"]);
  expect(await rebuilt.search("vacaciones")).toEqual([]);
  rebuilt.close();
});
it("deduplicates fragments and clears persisted caches on logout", async () => {
  const a = await openPageSearchIndex("logout-user", [summary("long")]);
  await a.upsert(page("long", 1, "vacaciones ".repeat(250)));
  expect((await a.search("vacaciones")).map((x) => x.id)).toEqual(["long"]);
  a.close();
  await clearPageSearchCaches();
  const again = await openPageSearchIndex("logout-user", [summary("long")]);
  expect(again.plan.reused).toBe(0);
  again.close();
});

it("rebuilds safely when IndexedDB evicts only the postings database", async () => {
  const scope = "evicted-account";
  const first = await openPageSearchIndex(scope, [summary("one")]);
  await first.upsert(page("one"));
  first.close();
  await Dexie.delete(`flexsearch:${await pageSearchCacheName(scope)}`);
  const reopened = await openPageSearchIndex(scope, [summary("one")]);
  expect(reopened.plan.needed).toEqual(["one"]);
  expect(await reopened.search("vacaciones")).toEqual([]);
  reopened.close();
});

it("recovers a dirty manifest left by cancelled indexing without reusing stale terms", async () => {
  const scope = "interrupted-account";
  const first = await openPageSearchIndex(scope, [summary("one")]);
  await first.upsert(page("one"));
  first.close();
  const db = new Dexie(await pageSearchCacheName(scope));
  await db.open();
  await db
    .table("pages")
    .put({ id: "one", version: -1, chunks: ["one:0", "one:1"] });
  db.close();
  const recovered = await openPageSearchIndex(scope, [summary("one", 2)]);
  expect(recovered.plan.needed).toEqual(["one"]);
  expect(await recovered.search("vacaciones")).toEqual([]);
  await recovered.upsert(page("one", 2, "Trabajo remoto"));
  expect(await recovered.search("vacaciones")).toEqual([]);
  expect((await recovered.search("remoto")).map((p) => p.id)).toEqual(["one"]);
  recovered.close();
});

it("does not let an older tab overwrite a newer persisted page version", async () => {
  const latest = await openPageSearchIndex("version-race", [summary("one", 3)]);
  await latest.upsert(page("one", 3, "Trabajo remoto"));
  latest.close();
  const older = await openPageSearchIndex("version-race", [summary("one", 2)]);
  await expect(older.upsert(page("one", 2))).rejects.toThrow(/recent/);
  older.close();
  const reopened = await openPageSearchIndex("version-race", [
    summary("one", 3),
  ]);
  expect(reopened.plan.reused).toBe(1);
  expect((await reopened.search("remoto")).map((p) => p.id)).toEqual(["one"]);
  reopened.close();
});
