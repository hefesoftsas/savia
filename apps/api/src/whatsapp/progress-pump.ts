/** Delivery runs independently of provider calls, with one sender per pump. */
export function createActionProgressPump(
  flush: () => Promise<boolean | void>,
  batchWindowMs = 300,
) {
  let dirty = false;
  let running: Promise<void> | undefined;
  const notify = () => {
    dirty = true;
    if (running) return;
    running = (async () => {
      while (dirty) {
        await new Promise((resolve) => setTimeout(resolve, batchWindowMs));
        dirty = false;
        try {
          if (await flush()) dirty = true;
        } catch {
          // The durable outbox remains the source of truth for recovery.
          console.warn("WHATSAPP_ACTION_PROGRESS_FLUSH_FAILED");
        }
      }
    })().finally(() => {
      running = undefined;
      if (dirty) notify();
    });
  };
  return {
    notify,
    async drain() {
      while (running) await running;
    },
  };
}
