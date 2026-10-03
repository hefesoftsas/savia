import { openPageSearchIndex } from "./browser-search-index";
import type {
  SearchWorkerRequest,
  SearchWorkerResponse,
} from "./browser-search-protocol";
const send = (message: SearchWorkerResponse) => postMessage(message);
let index: Awaited<ReturnType<typeof openPageSearchIndex>> | undefined;
let started = 0,
  done = 0,
  total = 0;
let queue = Promise.resolve();
let latestSearch = 0;
onmessage = (event: MessageEvent<SearchWorkerRequest>) => {
  const message = event.data;
  if (message.type === "cancel-search") {
    latestSearch = message.requestId;
    return;
  }
  if (message.type === "search") latestSearch = message.requestId;
  queue = queue.then(async () => {
    if (message.type === "search" && message.requestId !== latestSearch) return;
    try {
      if (message.type === "open") {
        index?.close();
        index = undefined;
        started = performance.now();
        done = 0;
        index = await openPageSearchIndex(
          message.scope,
          message.pages,
          message.rebuild,
        );
        total = index.plan.needed.length;
        send({ type: "plan", ...index.plan });
        send({ type: "indexing", done, total });
      } else {
        if (!index) throw new Error("Index unavailable");
        if (message.type === "upsert") {
          await index.upsert(message.page);
          send({ type: "indexing", done: ++done, total });
          send({ type: "updated", id: message.page.id });
        } else if (message.type === "finish") {
          send({
            type: "ready",
            total: await index.count(),
            reused: index.plan.reused,
            elapsedMs: performance.now() - started,
          });
        } else {
          const start = performance.now();
          const hits = await index.search(message.term);
          if (message.requestId !== latestSearch) return;
          send({
            type: "results",
            requestId: message.requestId,
            hits,
            elapsedMs: performance.now() - start,
          });
        }
      }
    } catch (error) {
      console.error("Pages search cache failed", error);
      send({
        type: "error",
        ...(message.type === "search" ? { requestId: message.requestId } : {}),
      });
    }
  });
};
