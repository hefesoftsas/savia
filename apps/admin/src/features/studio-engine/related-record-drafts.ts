import Dexie, { type Table } from "dexie";

export type RelatedRecordDraftScope = {
  /** The authenticated localWorkspace.scope, including permissions and API base path. */
  workspaceScope: string;
  object: string;
  recordId?: string;
};
export type SavedRelatedRecordDraft<T> = { value: T; savedAt: number };
type StoredDraft = SavedRelatedRecordDraft<unknown> & {
  key: string;
  environment: string;
  revision?: string;
};
class DraftDatabase extends Dexie {
  drafts!: Table<StoredDraft, string>;
  constructor() {
    super("savia-related-record-drafts");
    this.version(1).stores({ drafts: "key,environment" });
  }
}
let database: DraftDatabase | undefined;
const db = () => (database ??= new DraftDatabase());
// Serialize operations across reopened forms, including an unmount flush followed by a read.
const queues = new Map<string, Promise<void>>();
const active = new Set<{ environment: string; stop: () => Promise<void> }>();

/** Explicit privacy cleanup; ordinary closing preserves pending draft work. */
export async function clearRelatedRecordDrafts(environment: string) {
  await Promise.all(
    [...active]
      .filter((entry) => entry.environment === environment)
      .map((entry) => entry.stop()),
  );
  await db().drafts.where("environment").equals(environment).delete();
}

/** Values must include original parent/child versions; restoration never rebases them. */
export function createRelatedRecordDraft<T = unknown>(
  scope: RelatedRecordDraftScope,
  onWarning: (message: string) => void = () => undefined,
  delay = 300,
) {
  // Refuse incomplete/unscoped keys rather than silently sharing drafts across identities.
  const [principal, apiBasePath, permissions] = JSON.parse(
    scope.workspaceScope,
  );
  const [environment, principalId] = JSON.parse(principal);
  if (
    !environment ||
    !principalId ||
    !apiBasePath ||
    !permissions ||
    !scope.object
  )
    throw new Error(
      "An authenticated workspace is required for record drafts.",
    );
  const key = JSON.stringify([
    scope.workspaceScope,
    scope.object,
    scope.recordId ?? null,
  ]);
  let pending: SavedRelatedRecordDraft<T> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let revision: string | undefined;
  let queue = Promise.resolve();
  const warn = () =>
    onWarning(
      "No se pudo guardar el borrador local. Mantén el formulario abierto para conservar los cambios.",
    );
  const enqueue = (action: () => Promise<unknown>) => {
    queue = (queues.get(key) ?? queue)
      .then(action)
      .then(() => undefined)
      .catch(warn);
    queues.set(key, queue);
    const enqueued = queue;
    void enqueued.then(() => {
      if (queues.get(key) === enqueued) queues.delete(key);
    });
    return queue;
  };
  const cancelTimer = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  const flush = () => {
    cancelTimer();
    const next = pending;
    pending = undefined;
    if (!next) return queue;
    return enqueue(async () => {
      const nextRevision = crypto.randomUUID();
      await db().drafts.put({
        key,
        environment,
        ...next,
        revision: nextRevision,
      });
      revision = nextRevision;
    });
  };
  const stop = async () => {
    closed = true;
    cancelTimer();
    pending = undefined;
    active.delete(entry);
    await queue;
  };
  const entry = { environment: String(environment), stop };
  active.add(entry);
  return {
    async read(): Promise<SavedRelatedRecordDraft<T> | undefined> {
      try {
        await (queues.get(key) ?? queue);
        const saved = await db().drafts.get(key);
        if (closed || !saved) return undefined;
        revision = saved.revision;
        return { value: saved.value as T, savedAt: saved.savedAt };
      } catch {
        warn();
        return undefined;
      }
    },
    schedule(value: T) {
      if (closed) return;
      try {
        pending = { value: structuredClone(value), savedAt: Date.now() };
      } catch {
        warn();
        return;
      }
      cancelTimer();
      timer = setTimeout(() => {
        void flush();
      }, delay);
    },
    flush,
    clear() {
      cancelTimer();
      pending = undefined;
      return enqueue(() =>
        db().transaction("rw", db().drafts, async () => {
          const current = await db().drafts.get(key);
          if (current && current.revision === revision)
            await db().drafts.delete(key);
        }),
      );
    },
    async close() {
      if (closed) return queue;
      closed = true;
      active.delete(entry);
      await flush();
    },
  };
}
