import { DatabaseBridgeError } from "./database-errors";
type Entry<T> = {
  resource: Promise<T>;
  active: number;
  retired: boolean;
  closing?: Promise<void>;
};
/** Eviction retires a pool; its last lease closes it. Keys must never be logged. */
export class ConnectionPools<T> {
  private entries = new Map<string, Entry<T>>();
  private all = new Set<Entry<T>>();
  private stopped = false;
  constructor(
    private create: (key: string) => Promise<T>,
    private dispose: (resource: T) => Promise<void>,
    private limit = 20,
  ) {}
  private async retire(entry: Entry<T>) {
    entry.retired = true;
    if (!entry.active && !entry.closing)
      entry.closing = entry.resource
        .then(this.dispose)
        .catch(() => {})
        .finally(() => {
          this.all.delete(entry);
        });
    await entry.closing;
  }
  async use<R>(key: string, work: (resource: T) => Promise<R>): Promise<R> {
    if (this.stopped)
      throw new DatabaseBridgeError(
        "DATABASE_STOPPING",
        "Bridge is stopping.",
        503,
      );
    let entry = this.entries.get(key);
    if (!entry) {
      if (this.all.size >= this.limit * 2)
        throw new DatabaseBridgeError(
          "DATABASE_BUSY",
          "Database bridge is busy.",
          503,
        );
      if (this.entries.size >= this.limit) {
        const oldest = this.entries.entries().next().value!;
        this.entries.delete(oldest[0]);
        void this.retire(oldest[1]);
      }
      entry = { resource: this.create(key), active: 0, retired: false };
      this.entries.set(key, entry);
      this.all.add(entry);
      entry.resource.catch(() => {
        if (this.entries.get(key) === entry) this.entries.delete(key);
        void this.retire(entry!);
      });
    }
    entry.active++;
    try {
      return await work(await entry.resource);
    } finally {
      entry.active--;
      if (entry.retired) await this.retire(entry);
    }
  }
  async close() {
    this.stopped = true;
    this.entries.clear();
    await Promise.all([...this.all].map((e) => this.retire(e)));
  }
}

export async function leasePool<T>(
  pools: ConnectionPools<T>,
  key: string,
): Promise<{ resource: T; release: () => Promise<void> }> {
  let ready!: (v: T) => void;
  let fail!: (e: unknown) => void;
  let finish!: () => void;
  const resource = new Promise<T>((resolve, reject) => {
    ready = resolve;
    fail = reject;
  });
  const done = pools.use(key, async (p) => {
    const pending = new Promise<void>((r) => {
      finish = r;
    });
    ready(p);
    await pending;
  });
  done.catch(fail);
  return {
    resource: await resource,
    release: async () => {
      finish();
      await done;
    },
  };
}
