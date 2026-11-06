let retainedIndex, engine;
const send = (data) => postMessage(data);
function body(i) {
  return i === 42
    ? "Política de vacaciones: solicitud de descanso y vacaciones del equipo."
    : `Page ${i}. Saved rich text content for the project documentation and collaboration. `.repeat(
        15,
      );
}
onmessage = async ({ data: { action, mode, count } }) => {
  try {
    if (action === "load") {
      if (mode === "orama") engine = await import("@orama/orama");
      else {
        self.window = self;
        engine = await import("flexsearch");
      }
      send({ phase: "loaded" });
    } else if (action === "index") {
      const start = performance.now();
      if (mode === "orama") {
        retainedIndex = await engine.create({
          schema: { body: "string" },
          language: "spanish",
        });
        for (let i = 0; i < count; i++) {
          await engine.insert(retainedIndex, { id: String(i), body: body(i) });
          if ((i + 1) % 100 === 0) send({ progress: ((i + 1) / count) * 100 });
        }
      } else {
        retainedIndex = new engine.Index({
          tokenize: "forward",
          cache: false,
          commit: false,
        });
        await retainedIndex.mount(
          new engine.IndexedDB(`savia-pages-flex-memory-${count}`),
        );
        if (mode !== "reopen") {
          await retainedIndex.clear();
          for (let i = 0; i < count; i++) {
            retainedIndex.add(i, body(i));
            if ((i + 1) % 100 === 0) {
              await retainedIndex.commit();
              send({ progress: ((i + 1) / count) * 100 });
            }
          }
        }
      }
      send({ phase: "indexed", elapsedMs: performance.now() - start });
    } else {
      const hits =
        mode === "orama"
          ? (
              await engine.search(retainedIndex, {
                term: "vacaciones",
                limit: 10,
              })
            ).hits.map((x) => x.id)
          : await retainedIndex.search("vacaciones", 10);
      if (!hits.some((x) => String(x) === "42"))
        throw new Error("Expected fragment 42 missing");
      send({ phase: "searched", hits });
    }
  } catch (e) {
    send({ phase: "error", message: String(e) });
  }
};
