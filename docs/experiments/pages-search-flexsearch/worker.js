// Published adapter reads window.indexedDB; workers expose the same API on self.
// Throwaway compatibility shim; validate or replace before product integration.
self.window = self;
const flexsearch = import("flexsearch");
import { create, insert, search } from "@orama/orama";
const send = (data) => postMessage(data);
const ms = (t) => Math.round((performance.now() - t) * 100) / 100;
function body(i) {
  return i === 42
    ? "Política de vacaciones: solicitud de descanso y vacaciones del equipo."
    : `Page ${i}. Saved rich text content for the project documentation and collaboration. `.repeat(
        15,
      );
}
async function queries(index, term) {
  const times = [];
  let hits;
  for (let i = 0; i < 6; i++) {
    const t = performance.now();
    hits = await index.search(term, 10);
    times.push(ms(t));
  }
  return {
    term,
    firstMs: times[0],
    warmMedianMs: times.slice(1).sort((a, b) => a - b)[2],
    hits,
  };
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
onmessage = async ({ data: { action } }) => {
  try {
    const { Index, IndexedDB } = await flexsearch;
    const index = new Index({
      tokenize: "forward",
      cache: false,
      commit: false,
    });
    let t = performance.now();
    await index.mount(new IndexedDB("savia-pages-flexsearch-probe-v1"));
    send({ phase: "mount", elapsedMs: ms(t) });
    if (action === "build") {
      await index.clear();
      t = performance.now();
      for (let i = 0; i < 1000; i++) {
        index.add(i, body(i));
        if ((i + 1) % 100 === 0) {
          await index.commit();
          send({ progress: (i + 1) / 10 });
        }
      }
      send({
        phase: "flexsearch-index-persistent",
        fragments: 1000,
        elapsedMs: ms(t),
      });
      const result = await queries(index, "vacaciones");
      assert(
        result.hits.includes(42),
        "Persisted search did not find fragment 42",
      );
      send({ phase: "flexsearch-search", ...result });
      send({
        phase: "flexsearch-spanish",
        ...(await queries(index, "politica")),
      });
      const orama = await create({
        schema: { body: "string" },
        language: "spanish",
      });
      t = performance.now();
      for (let i = 0; i < 1000; i++)
        await insert(orama, { id: String(i), body: body(i) });
      send({ phase: "orama-index-memory", fragments: 1000, elapsedMs: ms(t) });
      const times = [];
      let hits;
      for (let i = 0; i < 6; i++) {
        t = performance.now();
        hits = await search(orama, { term: "vacaciones", limit: 10 });
        times.push(ms(t));
      }
      assert(
        hits.hits.some((x) => x.id === "42"),
        "Orama did not find fragment 42",
      );
      send({
        phase: "orama-search-text",
        firstMs: times[0],
        warmMedianMs: times.slice(1).sort((a, b) => a - b)[2],
        hits: hits.hits.map((x) => x.id),
      });
    } else if (action === "update") {
      t = performance.now();
      index.update(
        42,
        "Política renovada sobre permisos remotos exclusivoactualizado.",
      );
      await index.commit();
      send({ phase: "update-one", elapsedMs: ms(t) });
      const oldHits = await index.search("vacaciones", 10);
      const newHits = await index.search("exclusivoactualizado", 10);
      assert(
        !oldHits.includes(42) && newHits.includes(42),
        "Incremental update did not replace old terms",
      );
      send({ phase: "update-verified", oldHits, newHits });
    } else if (action === "remove") {
      t = performance.now();
      index.remove(42);
      await index.commit();
      send({ phase: "remove-one", elapsedMs: ms(t) });
      assert(
        !(await index.search("vacaciones", 10)).includes(42) &&
          !(await index.search("exclusivoactualizado", 10)).includes(42),
        "Deletion left stale terms",
      );
      send({ phase: "remove-verified" });
    } else {
      send({
        phase: "search-without-indexing",
        ...(await queries(index, "vacaciones")),
      });
      send({
        phase: "updated-term-without-indexing",
        ...(await queries(index, "exclusivoactualizado")),
      });
    }
    send({ phase: "complete" });
  } catch (e) {
    send({ phase: "error", message: String(e), stack: e.stack });
  }
};
