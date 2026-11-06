import { pushQueuedBundles, resolveBundleFromServer } from "./bundle-sync";
import { liveQuery, type Subscription } from "dexie";
import type { StudioRecord } from "@savia/studio-shared/metadata";
import type { CollectionManifest, PullBatch, SyncTransport } from "./contracts";
import type { LocalStore } from "./store";
async function json<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(`Local sync HTTP ${response.status}`);
  return response.json() as Promise<T>;
}
export class SyncAuthorizationError extends Error {}
function isStorageCapacityError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const detail = error as { name?: string; inner?: unknown; cause?: unknown };
  return (
    detail.name === "QuotaExceededError" ||
    Boolean(
      detail.inner &&
      detail.inner !== error &&
      isStorageCapacityError(detail.inner),
    ) ||
    Boolean(
      detail.cause &&
      detail.cause !== error &&
      isStorageCapacityError(detail.cause),
    )
  );
}
function authorizedTransport(
  store: LocalStore,
  transport: SyncTransport,
  expectedPrincipalId?: string,
  context: { policyRevision?: number } = {},
): SyncTransport {
  const network = transport;
  return async (path, init) => {
    const headers = new Headers(init?.headers);
    if (expectedPrincipalId !== undefined)
      headers.set("X-Savia-Sync-Principal", expectedPrincipalId);
    if (context.policyRevision !== undefined)
      headers.set("X-Savia-Policy-Revision", String(context.policyRevision));
    const response = await network(path, { ...init, headers });
    if (
      response.status === 401 ||
      response.status === 403 ||
      (response.status === 409 && path.includes("/pull/"))
    ) {
      const message = `Local sync HTTP ${response.status}: authorization required`;
      await store.blockAuthorization(message, response.status !== 401);
      throw new SyncAuthorizationError(message);
    }
    return response;
  };
}
/** One synchronization pass. Call under the coordinator's origin-wide scope lock. */
export async function syncOnce(
  store: LocalStore,
  transport: SyncTransport,
  expectedPrincipalId?: string,
  requestedCollection?: string,
) {
  const blocked = await store.authorizationError();
  if (blocked) throw new SyncAuthorizationError(blocked);
  const context: { policyRevision?: number } = {};
  transport = authorizedTransport(
    store,
    transport,
    expectedPrincipalId,
    context,
  );
  const manifest = await json<{
    collections: CollectionManifest[];
    principalId?: string;
    policyRevision?: number;
    policyScope?: string;
  }>(await transport("/api/local-sync/manifest"));
  context.policyRevision = manifest.policyRevision;
  if (
    expectedPrincipalId !== undefined &&
    manifest.principalId !== expectedPrincipalId
  ) {
    const message =
      "Local sync principal changed; authenticate the expected account";
    await store.blockAuthorization(message);
    throw new SyncAuthorizationError(message);
  }
  if (
    manifest.policyRevision !== undefined ||
    (await store.db.syncState.get("$policy"))
  )
    await store.acceptPolicy(
      JSON.stringify([
        manifest.principalId ?? expectedPrincipalId,
        manifest.policyScope ?? "legacy",
        manifest.policyRevision ?? 0,
      ]),
    );
  await store.refreshManifest(manifest.collections);
  const bundleCollections = await pushQueuedBundles(
    store,
    transport,
    requestedCollection,
  );
  for (const collection of manifest.collections) {
    if (requestedCollection && collection.name !== requestedCollection)
      continue;
    if (collection.capability === "remote") continue;
    let hadMutations = bundleCollections.has(collection.name);
    if (collection.capability === "read-write") {
      const mutations = await store.db.outbox
        .where("collection")
        .equals(collection.name)
        .sortBy("sequence");
      hadMutations = hadMutations || mutations.length > 0;
      const blocked = new Set<string>();
      for (const queued of mutations) {
        if (queued.action === "bundle") continue;
        if (blocked.has(queued.id)) continue;
        const mutation = await store.db.outbox.get(queued.mutationId);
        if (!mutation || mutation.quarantined) continue;
        if (mutation.state !== "pending") {
          blocked.add(mutation.id);
          continue;
        }
        const { mutationId, action, id, data, baseVersion } = mutation;
        const response = await transport(
          `/api/local-sync/push/${encodeURIComponent(collection.name)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mutationId, action, id, data, baseVersion }),
          },
        );
        if (response.ok) {
          const result = (await response.json()) as { data: StudioRecord };
          await store.acknowledge(mutation, result.data);
        } else if (response.status === 409) {
          const result = (await response.json()) as {
            master?: StudioRecord | null;
            data?: StudioRecord | null;
            error?: string | { message?: string };
          };
          await store.rejectMutation(
            mutation,
            "conflict",
            typeof result.error === "string"
              ? result.error
              : (result.error?.message ?? "Version conflict"),
            result.master !== undefined ? result.master : result.data,
          );
          blocked.add(id);
        } else if (
          response.status >= 400 &&
          response.status < 500 &&
          ![401, 403, 408, 429].includes(response.status)
        ) {
          await store.rejectMutation(mutation, "error", await response.text());
          blocked.add(id);
        } else throw new Error(`Local sync HTTP ${response.status}`);
      }
    }
    const state = await store.db.syncState.get(collection.name);
    let currentSequence = 0;
    if (state?.cursor) {
      try {
        const decoded = JSON.parse(atob(state.cursor)) as { sequence?: number };
        if (typeof decoded.sequence === "number")
          currentSequence = decoded.sequence;
      } catch {}
    }
    const upToDate =
      typeof collection.latestSequence === "number" &&
      currentSequence >= collection.latestSequence;
    const recentlySynced =
      typeof state?.lastSyncedAt === "number" &&
      Date.now() - state.lastSyncedAt < 60_000;
    if (
      !requestedCollection &&
      !hadMutations &&
      state?.hydrated &&
      (upToDate || recentlySynced)
    ) {
      continue;
    }
    let more = true;
    while (more) {
      const currentState = await store.db.syncState.get(collection.name);
      const query = new URLSearchParams({ limit: "250" });
      if (currentState?.cursor) query.set("cursor", currentState.cursor);
      const batch = await json<PullBatch>(
        await transport(
          `/api/local-sync/pull/${encodeURIComponent(collection.name)}?${query}`,
        ),
      );
      if (batch.hasMore && batch.cursor === currentState?.cursor)
        throw new Error("Local sync cursor did not advance");
      await store.applyPull(collection.name, batch);
      more = batch.hasMore;
    }
  }
}
/** Caller serializes this operation with normal synchronization through Web Locks. */
export async function resolveQueuedBundle(
  store: LocalStore,
  network: SyncTransport,
  expectedPrincipalId: string | undefined,
  mutationId: string,
  mode: "server" | "local",
) {
  const blocked = await store.authorizationError();
  if (blocked) throw new SyncAuthorizationError(blocked);
  const context: { policyRevision?: number } = {};
  const transport = authorizedTransport(
    store,
    network,
    expectedPrincipalId,
    context,
  );
  const manifest = await json<{
    collections: CollectionManifest[];
    principalId?: string;
    policyRevision?: number;
    policyScope?: string;
  }>(await transport("/api/local-sync/manifest"));
  if (
    expectedPrincipalId !== undefined &&
    manifest.principalId !== expectedPrincipalId
  ) {
    await store.blockAuthorization(
      "Local sync principal changed; authenticate the expected account",
    );
    throw new SyncAuthorizationError("Local sync principal changed");
  }
  context.policyRevision = manifest.policyRevision;
  if (
    manifest.policyRevision !== undefined ||
    (await store.db.syncState.get("$policy"))
  )
    await store.acceptPolicy(
      JSON.stringify([
        manifest.principalId ?? expectedPrincipalId,
        manifest.policyScope ?? "legacy",
        manifest.policyRevision ?? 0,
      ]),
    );
  await store.refreshManifest(manifest.collections);
  await resolveBundleFromServer(store, transport, mutationId, mode);
}
export function createSyncCoordinator(
  store: LocalStore,
  transport: SyncTransport,
  expectedPrincipalId?: string,
) {
  let started = false,
    running = false,
    requested = false,
    attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let subscription: Subscription | undefined;
  const controllers = new Set<AbortController>();
  let generation = 0;
  let backgroundController: AbortController | undefined;
  const foreground = new Map<string, Promise<void>>();
  const synchronize = async (collection?: string, background = false) => {
    const controller = new AbortController();
    controllers.add(controller);
    if (background) backgroundController = controller;
    store.setSyncing(true);
    try {
      await syncOnce(
        store,
        async (path, init) => {
          controller.signal.throwIfAborted();
          const response = await transport(path, {
            ...init,
            signal: controller.signal,
          });
          controller.signal.throwIfAborted();
          return response;
        },
        expectedPrincipalId,
        collection,
      );
      if (!collection) {
        await store.db.syncState.put({
          collection: "$sync",
          hydrated: true,
          lastSyncedAt: Date.now(),
        });
        store.setSyncError();
      }
    } catch (error) {
      if (
        !controller.signal.aborted &&
        !(error instanceof SyncAuthorizationError)
      )
        store.setSyncError(
          "No se pudo completar la sincronización. Tus cambios pendientes se conservan; se reintentará automáticamente mientras este espacio esté abierto. También puedes reintentar ahora.",
        );
      if (error instanceof SyncAuthorizationError) stop();
      if (isStorageCapacityError(error)) {
        store.setSyncError(
          "Local storage is full. Free device space, then retry synchronization. Unsynced changes are retained.",
        );
        stop();
      }
      throw error;
    } finally {
      store.setSyncing(false);
      controllers.delete(controller);
      if (backgroundController === controller) backgroundController = undefined;
    }
  };
  let lastPending = "";
  const schedule = (delay: number) => {
    if (!started) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      void run();
    }, delay);
  };
  const run = async () => {
    if (!started || running || foreground.size) return;
    running = true;
    requested = false;
    try {
      // Without Web Locks, fail closed: a per-tab mutex cannot prevent duplicate pushes.
      if (!globalThis.navigator?.locks) {
        store.setSyncError(
          "Synchronization requires a browser with Web Locks support.",
        );
        stop();
        throw new Error("Background synchronization requires Web Locks");
      }
      await navigator.locks.request(
        `savia-sync:${store.scope}`,
        { mode: "exclusive", ifAvailable: true },
        async (lock) => {
          if (!lock || !started || foreground.size) return;
          await synchronize(undefined, true);
        },
      );
      attempt = 0;
      // One central watchdog catches remote changes and leader tab closure; no screen polling.
      schedule(requested ? 5_000 : 60_000);
    } catch {
      attempt++;
      schedule(
        Math.min(60_000, 1000 * 2 ** Math.min(attempt, 6)) *
          (0.75 + Math.random() * 0.5),
      );
    } finally {
      running = false;
    }
  };
  const requestSync = () => {
    requested = true;
    if (!running) schedule(0);
  };
  const start = () => {
    if (started) return;
    started = true;
    globalThis.addEventListener?.("online", requestSync);
    subscription = liveQuery(async () =>
      (await store.db.outbox.toArray())
        .filter((m) => m.state === "pending")
        .map((m) => m.mutationId)
        .join(","),
    ).subscribe({
      next: (value) => {
        if (value !== lastPending) {
          lastPending = value;
          requestSync();
        }
      },
    });
    void store.db.outbox
      .filter((m) => m.state === "pending")
      .count()
      .then((pending) => {
        if (!started) return;
        if (pending > 0) requestSync();
        else schedule(250);
      })
      .catch(() => {
        if (started) schedule(250);
      });
  };
  const stop = () => {
    started = false;
    clearTimeout(timer);
    generation++;
    for (const controller of controllers) controller.abort();
    subscription?.unsubscribe();
    globalThis.removeEventListener?.("online", requestSync);
  };
  const syncNow = (collection?: string, force = false): Promise<void> => {
    const key = `${collection ?? "$all"}:${force ? "refresh" : "provision"}`;
    const existing = foreground.get(key);
    // A forced refresh follows a committed write and must not reuse an older pull.
    if (existing && !force) return existing;
    const expectedGeneration = generation;
    const pending = (async () => {
      if (!globalThis.navigator?.locks)
        throw new Error("Background synchronization requires Web Locks");
      const ready = async () => {
        if (!collection || force) return false;
        const definition = await store.db.collections.get(collection);
        return (
          definition?.capability === "remote" ||
          Boolean(
            definition && (await store.db.syncState.get(collection))?.hydrated,
          )
        );
      };
      if (await ready()) return;
      // Foreground provisioning takes priority over a background pass. Aborted
      // pushes keep their durable mutation IDs and are safe to retry.
      if (collection) backgroundController?.abort();
      const resumeAfterRecovery = Boolean((await store.status()).syncError);
      await navigator.locks.request(
        `savia-sync:${store.scope}`,
        { mode: "exclusive" },
        async () => {
          if (generation !== expectedGeneration)
            throw new DOMException("Synchronization stopped", "AbortError");
          // Another reader/tab may have provisioned it while the lock was held.
          if (await ready()) return;
          await synchronize(collection);
        },
      );
      if (resumeAfterRecovery && !started) start();
    })();
    foreground.set(key, pending);
    const cleanup = () => {
      if (foreground.get(key) === pending) foreground.delete(key);
      if (started) {
        if (collection) schedule(250);
        else schedule(60_000);
      }
    };
    void pending.then(cleanup, cleanup);
    return pending;
  };
  const resolveBundle = async (
    mutationId: string,
    mode: "server" | "local",
  ) => {
    if (!navigator.locks)
      throw new Error("Synchronization requires Web Locks support");
    const expectedGeneration = generation;
    const controller = new AbortController();
    controllers.add(controller);
    try {
      await navigator.locks.request(
        `savia-sync:${store.scope}`,
        { mode: "exclusive" },
        async () => {
          if (generation !== expectedGeneration)
            throw new DOMException("Synchronization stopped", "AbortError");
          await resolveQueuedBundle(
            store,
            async (path, init) => {
              controller.signal.throwIfAborted();
              const response = await transport(path, {
                ...init,
                signal: controller.signal,
              });
              controller.signal.throwIfAborted();
              return response;
            },
            expectedPrincipalId,
            mutationId,
            mode,
          );
        },
      );
      requestSync();
    } catch (error) {
      if (error instanceof SyncAuthorizationError) stop();
      throw error;
    } finally {
      controllers.delete(controller);
    }
  };
  return { start, requestSync, syncNow, resolveBundle, stop };
}
