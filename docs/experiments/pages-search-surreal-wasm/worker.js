import { Surreal } from "surrealdb";
import { createWasmEngines } from "@surrealdb/wasm";
import { create, insert, search } from "@orama/orama";
for (const [proto, methods] of [
  [IDBDatabase.prototype, ["transaction"]],
  [IDBObjectStore.prototype, ["get", "put", "delete", "openCursor"]],
])
  for (const name of methods) {
    const original = proto[name];
    proto[name] = function (...args) {
      try {
        return original.apply(this, args);
      } catch (e) {
        postMessage({
          phase: "idb-exception",
          method: name,
          name: e.name,
          message: e.message,
        });
        throw e;
      }
    };
  }
const ms = (start) => Math.round((performance.now() - start) * 100) / 100;
const send = (data) => postMessage(data);
function vector(i) {
  let seed = i + 1;
  const v = Array.from({ length: 512 }, () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296 - 0.5;
  });
  const norm = Math.hypot(...v);
  return v.map((x) => x / norm);
}
const queryVector = vector(42);
async function queries(db) {
  const times = [];
  let hits;
  for (let i = 0; i < 6; i++) {
    const t = performance.now();
    [hits] = await db.query(
      "SELECT pageId, title, vector::distance::knn() AS distance FROM fragment WHERE embedding <|10,40|> $vector ORDER BY distance;",
      { vector: queryVector },
    );
    times.push(ms(t));
  }
  return {
    firstMs: times[0],
    warmMedianMs: times.slice(1).sort((a, b) => a - b)[2],
    top: hits?.[0],
    count: hits?.length,
  };
}
onmessage = async ({ data: { action, count } }) => {
  let db;
  try {
    send({ phase: "environment", userAgent: navigator.userAgent });
    await new Promise((resolve, reject) => {
      const r = indexedDB.open("savia-pages-native-probe", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onerror = () => reject(r.error);
      r.onsuccess = () => {
        const d = r.result;
        const tx = d.transaction("kv", "readwrite");
        tx.objectStore("kv").put("ok", "test");
        tx.oncomplete = () => {
          d.close();
          send({ phase: "native-idb", status: "write-ok" });
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
    let t = performance.now();
    db = new Surreal({ engines: createWasmEngines() });
    await db.connect(
      action === "memory" ? "mem://" : "indxdb://savia-pages-probe-v1",
    );
    await db.use({ namespace: "probe", database: "pages" });
    send({ phase: "open", elapsedMs: ms(t), version: await db.version() });
    if (action === "build" || action === "memory") {
      await db.query(
        "REMOVE TABLE IF EXISTS fragment; DEFINE TABLE fragment SCHEMALESS; DEFINE INDEX semantic ON fragment FIELDS embedding HNSW DIMENSION 512 DIST COSINE TYPE F32;",
      );
      t = performance.now();
      for (let i = 0; i < count; i += 10) {
        const batch = Array.from(
          { length: Math.min(10, count - i) },
          (_, j) => ({
            pageId: `page-${i + j}`,
            title: `Page ${i + j}`,
            body: `Saved page content ${i + j}. `.repeat(25),
            embedding: vector(i + j),
          }),
        );
        await db.query("INSERT INTO fragment $batch;", { batch });
        send({ progress: Math.round(((i + batch.length) / count) * 100) });
      }
      send({ phase: "surreal-index", fragments: count, elapsedMs: ms(t) });
      send({ phase: "surreal-search", ...(await queries(db)) });
      t = performance.now();
      await db.query(
        "UPDATE fragment SET title = 'Updated page' WHERE pageId = 'page-42';",
      );
      send({ phase: "surreal-update-one", elapsedMs: ms(t) });
      send({ phase: "surreal-search-after-update", ...(await queries(db)) });
      const ot = performance.now();
      const orama = await create({
        schema: {
          pageId: "string",
          title: "string",
          body: "string",
          embedding: "vector[512]",
        },
      });
      for (let i = 0; i < count; i++)
        await insert(orama, {
          id: `f${i}`,
          pageId: `page-${i}`,
          title: `Page ${i}`,
          body: `Saved page content ${i}. `.repeat(25),
          embedding: vector(i),
        });
      send({ phase: "orama-index", fragments: count, elapsedMs: ms(ot) });
      const times = [];
      let hits;
      for (let i = 0; i < 6; i++) {
        t = performance.now();
        hits = await search(orama, {
          mode: "vector",
          vector: { property: "embedding", value: queryVector },
          similarity: 0,
          limit: 10,
          includeVectors: false,
        });
        times.push(ms(t));
      }
      send({
        phase: "orama-search",
        firstMs: times[0],
        warmMedianMs: times.slice(1).sort((a, b) => a - b)[2],
        top: hits.hits[0]?.document.pageId,
        count: hits.hits.length,
      });
    } else if (action === "update") {
      t = performance.now();
      await db.query(
        "UPDATE fragment SET title = 'Updated page' WHERE pageId = 'page-42';",
      );
      send({ phase: "update-one", elapsedMs: ms(t) });
      send({ phase: "surreal-search", ...(await queries(db)) });
    } else {
      t = performance.now();
      const [rows] = await db.query(
        "SELECT count() AS total FROM fragment GROUP ALL;",
      );
      send({ phase: "persisted-count", rows, elapsedMs: ms(t) });
      send({ phase: "surreal-search-after-reopen", ...(await queries(db)) });
    }
    await db.close();
    send({ phase: "complete" });
  } catch (e) {
    send({ phase: "error", message: String(e), stack: e.stack });
    await db?.close().catch(() => {});
  }
};
