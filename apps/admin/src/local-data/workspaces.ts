import Dexie from "dexie";
import type { AuthSession } from "@/auth/auth-session";
import type { ApiClient } from "@/api/api-client";
import { createEmbeddedTransport } from "@/api/embedded-transport";
import { openLocalStore } from "./store";
import { createSyncCoordinator } from "./sync";
import { createLocalTransport } from "./transport";
import {
  readWorkspaceMetadata,
  writeWorkspaceMetadata,
  removeWorkspaceMetadata,
} from "./session";
import { isOfflineError } from "@/offline/offline-error";

export type LocalWorkspace = Awaited<
  ReturnType<ReturnType<typeof createWorkspaceManager>["open"]>
>;
export function createWorkspaceManager(
  session: AuthSession,
  client: ApiClient,
  environment: string,
) {
  const active = new Set<{
    close: () => void;
    store: Awaited<ReturnType<typeof openLocalStore>>;
  }>();
  let generation = 0;
  const principalScope = async () => {
    const identity = await session.getIdentity();
    return JSON.stringify([environment, String(identity.id)]);
  };
  return {
    async cachedMetadata<T>(name: string, load: () => Promise<T>): Promise<T> {
      const scope = await principalScope();
      const key = `${scope}:${name}`;
      const saved = await readWorkspaceMetadata<T>(key);
      if (navigator.onLine === false && saved !== undefined) return saved;
      try {
        const value = await load();
        await writeWorkspaceMetadata(key, value);
        return value;
      } catch (error) {
        if (isOfflineError(error) && saved !== undefined) return saved;
        throw error;
      }
    },
    async open(apiBasePath: string) {
      const expected = generation;
      const principal = await principalScope();
      const permissions = await session.getPermissions();
      // Permission changes create a new authorized scope; old data is never reused.
      const scope = JSON.stringify([principal, apiBasePath, permissions]);
      const store = await openLocalStore(scope);
      if (expected !== generation) {
        store.close();
        throw new Error("La sesión cambió.");
      }
      const network = createEmbeddedTransport(client, apiBasePath);
      const coordinator = createSyncCoordinator(
        store,
        network,
        String(JSON.parse(principal)[1]),
      );
      let closed = false;
      const syncNow = async () => {
        if (closed || expected !== generation) return;
        if (await store.authorizationError()) {
          // This is a real authenticated request for this tenant. Cached session
          // leases must never unlock a server-revoked replica.
          const authorization = await network("/api/local-sync/manifest");
          if (!authorization.ok)
            throw new Error(
              `Workspace authorization HTTP ${authorization.status}`,
            );
          const proof = (await authorization.json()) as {
            principalId?: string;
          };
          if (String(proof.principalId) !== JSON.parse(principal)[1])
            throw new Error("La sesión cambió.");
          if (closed || expected !== generation) return;
          await store.resumeAuthorization();
          coordinator.start();
        }
        await coordinator.syncNow();
      };
      const workspace = {
        store,
        scope,
        transport: createLocalTransport(store, network, syncNow),
        requestSync: coordinator.requestSync,
        syncNow,
        close: () => {
          if (closed) return;
          closed = true;
          coordinator.stop();
          store.close();
          active.delete(workspace);
        },
      };
      active.add(workspace);
      if (await store.authorizationError())
        void syncNow().catch(() => undefined);
      else coordinator.start();
      // Do not block local boot on a server request. First uncached read waits for sync.
      return workspace;
    },
    async clear() {
      generation++;
      for (const workspace of active) workspace.close();
      if (typeof indexedDB === "undefined") return;
      // Outboxes remain scoped and inaccessible to other principals. Never delete unsent work.
      for (const name of await Dexie.getDatabaseNames().catch(() => [])) {
        if (!name.startsWith("savia-local-v1:")) continue;
        const scope = name.slice("savia-local-v1:".length);
        let matches = false;
        try {
          matches = JSON.parse(JSON.parse(scope)[0])[0] === environment;
        } catch {
          continue;
        }
        if (!matches) continue;
        let store: Awaited<ReturnType<typeof openLocalStore>> | undefined;
        try {
          store = await openLocalStore(scope);
          const pending = await store.db.outbox.count();
          if (!pending) await store.destroy();
        } catch {
          // An inaccessible database is preserved; cleanup must not prevent logout.
        } finally {
          store?.close();
        }
      }
      // Preserve the retired database: its outbox can contain unsent work from older clients.
    },
    async forgetMetadata() {
      const scope = await principalScope();
      await removeWorkspaceMetadata(`${scope}:`);
    },
  };
}
