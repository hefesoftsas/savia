import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, expect, it } from "vitest";
import { retireLocalPageSearchCaches } from "./retire-local-search-cache";

const databases = [
  "savia-pages-search-v1-retired-test",
  "flexsearch:savia-pages-search-v1-retired-test",
  "unrelated-user-cache-test",
];

afterEach(async () => {
  await Promise.all(databases.map((name) => Dexie.delete(name)));
});

it("deletes only databases matching retired Pages search prefixes", async () => {
  for (const name of databases) {
    const database = new Dexie(name);
    database.version(1).stores({ values: "id" });
    await database.open();
    database.close();
  }

  await retireLocalPageSearchCaches();

  expect(await Dexie.exists(databases[0])).toBe(false);
  expect(await Dexie.exists(databases[1])).toBe(false);
  expect(await Dexie.exists(databases[2])).toBe(true);
});
