let worker;
const log = document.querySelector("#log");
const write = (data) =>
  (log.textContent += "\n" + JSON.stringify(data, null, 2));
write({
  crossOriginIsolated,
  available: typeof performance.measureUserAgentSpecificMemory,
  userAgent: navigator.userAgent,
});
async function sample(phase) {
  if (!performance.measureUserAgentSpecificMemory)
    throw new Error("Application memory API unavailable");
  const result = await performance.measureUserAgentSpecificMemory();
  const value = {
    phase,
    bytes: result.bytes,
    MiB: result.bytes / 1048576,
    breakdown: result.breakdown,
  };
  write(value);
  return value;
}
for (const button of document.querySelectorAll("button"))
  button.onclick = async () => {
    for (const b of document.querySelectorAll("button")) b.disabled = true;
    try {
      worker?.terminate();
      worker = undefined;
      log.textContent = "";
      const mode = button.dataset.mode,
        count = Number(button.dataset.count);
      write({ mode, count });
      await sample("page-baseline");
      worker = new Worker(new URL("./memory.worker.js", import.meta.url), {
        type: "module",
      });
      worker.onmessage = async ({ data }) => {
        if (data.progress !== undefined) {
          document.querySelector("#progress").value = data.progress;
          return;
        }
        write(data);
        try {
          if (data.phase === "loaded") {
            await sample("engine-baseline");
            worker.postMessage({ action: "index", mode, count });
          } else if (data.phase === "indexed") {
            await sample("index-retained");
            worker.postMessage({ action: "search", mode, count });
          } else if (data.phase === "searched") {
            await sample("after-search");
            write({ phase: "complete" });
            for (const b of document.querySelectorAll("button"))
              b.disabled = false;
          } else if (data.phase === "error") {
            for (const b of document.querySelectorAll("button"))
              b.disabled = false;
          }
        } catch (e) {
          write({ error: String(e) });
          for (const b of document.querySelectorAll("button"))
            b.disabled = false;
        }
      };
      worker.onerror = (e) => {
        write({ error: e.message });
        for (const b of document.querySelectorAll("button")) b.disabled = false;
      };
      worker.postMessage({ action: "load", mode, count });
    } catch (e) {
      write({ error: String(e) });
      for (const b of document.querySelectorAll("button")) b.disabled = false;
    }
  };
