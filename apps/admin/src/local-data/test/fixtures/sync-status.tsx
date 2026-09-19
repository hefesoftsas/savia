import Dexie from "dexie";
import { createRoot } from "react-dom/client";
import { LocalSyncStatus } from "../../sync-status";
import { openLocalStore } from "../../store";
import { createSyncCoordinator } from "../../sync";
import type { LocalWorkspace } from "../../workspaces";
import type { CollectionManifest } from "../../contracts";
import "@/styles/globals.css";

// Local browser verification: synthetic IndexedDB scope, no server requests.
const store = await openLocalStore(`sync-verification:${crypto.randomUUID()}`);
const collection = {
  name: "verification",
  object: { config: { fields: {} } },
  capability: "read-write",
  schemaVersion: 1,
} as CollectionManifest;
await store.refreshManifest([collection]);
await store.mutate("verification", "create", "example", {
  name: "Synthetic pending edit",
});
let connected = false;
const coordinator = createSyncCoordinator(store, async (path) => {
  if (!connected) throw new TypeError("Failed to fetch");
  if (path.endsWith("manifest"))
    return Response.json({ collections: [collection] });
  if (path.includes("/push/"))
    return Response.json({
      data: { id: "example", name: "Synthetic pending edit", _version: 1 },
    });
  return Response.json({ documents: [], cursor: "1", hasMore: false });
});
const workspace = { store, ...coordinator } as unknown as LocalWorkspace;
createRoot(document.getElementById("root")!).render(
  <main className="mx-auto max-w-5xl p-4">
    <h1 className="mb-4 text-2xl font-semibold">
      Verificación local de sincronización
    </h1>
    <p className="mb-4">
      Datos sintéticos. Esta prueba no envía información al servidor.
    </p>
    <LocalSyncStatus workspace={workspace} />
    <div className="mt-4 flex flex-wrap gap-4">
      <button onClick={() => coordinator.start()}>
        Simular fallo de conexión
      </button>
      <button
        onClick={() => {
          connected = true;
        }}
      >
        Restablecer conexión simulada
      </button>
      <button
        onClick={() => {
          coordinator.stop();
          store.close();
          void Dexie.getDatabaseNames().then(async (names) => {
            for (const name of names.filter((name) =>
              name.startsWith("savia-local-v1:sync-verification:"),
            ))
              await Dexie.delete(name);
          });
        }}
      >
        Eliminar datos de prueba
      </button>
    </div>
  </main>,
);

import.meta.hot?.dispose(() => {
  coordinator.stop();
  store.close();
});
