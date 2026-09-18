import { isOfflineError } from "@/offline/offline-error";
import { validateRecord } from "@savia/crm-shared/metadata";
import type { LocalStore } from "./store";
import type { SyncTransport } from "./contracts";
import { queryRecords, querySummary, queryRecordDetail } from "./query";
import { readWorkspaceMetadata, writeWorkspaceMetadata } from "./session";

const response = (error: string, status = 503) =>
  Response.json({ error }, { status });
/** CRM transport whose record read/write critical path is always IndexedDB. */
export function createLocalTransport(
  store: LocalStore,
  network: SyncTransport,
  syncNow: (collection?: string) => Promise<void>,
  requestSync: () => void = () => {
    void syncNow().catch(() => undefined);
  },
): SyncTransport {
  return async (path, init = {}) => {
    let decoded = path;
    try {
      for (let i = 0; i < 4; i++) decoded = decodeURIComponent(decoded);
    } catch {
      return response("Ruta no permitida.", 400);
    }
    if (
      !decoded.startsWith("/api/") ||
      decoded.includes("..") ||
      decoded.includes("\\") ||
      /[\r\n]/.test(decoded)
    )
      return response("Ruta no permitida.", 400);
    const url = new URL(path, "https://local.invalid");
    const segments = url.pathname
      .split("/")
      .filter(Boolean)
      .map(decodeURIComponent);
    const method = (init.method ?? "GET").toUpperCase();
    const bootstrapRoute =
      url.pathname === "/api/bootstrap" ||
      url.pathname === "/api/business/setup";
    if (segments[1] === "local-sync") return network(path, init);
    if (
      method === "POST" &&
      bootstrapRoute &&
      navigator.onLine === false &&
      (await store.db.collections.count()) > 0
    )
      return Response.json({ ok: true });
    const recordRoute =
      segments[1] === "records" &&
      ((segments.length === 3 && ["GET", "POST"].includes(method)) ||
        (segments.length === 4 &&
          segments[3] === "summary" &&
          method === "GET") ||
        (segments.length === 4 &&
          !["summary", "bulk"].includes(segments[3]) &&
          ["GET", "PATCH", "DELETE"].includes(method)));
    const detailRoute =
      segments[1] === "record-detail" &&
      segments.length === 4 &&
      method === "GET";
    if ((recordRoute || detailRoute) && segments[2]) {
      const collection = segments[2];
      let definition = await store.db.collections.get(collection);
      if (!definition) {
        await syncNow(collection);
        definition = await store.db.collections.get(collection);
      }
      if (definition && definition.capability !== "remote") {
        const state = await store.db.syncState.get(collection);
        if (!state?.hydrated) {
          await syncNow(collection);
          if (!(await store.db.syncState.get(collection))?.hydrated)
            return response(
              "Esta colección todavía no está lista sin conexión. Conecta para completar la descarga.",
            );
        }
        try {
          if (
            method === "GET" &&
            segments[1] === "records" &&
            segments.length === 3
          )
            return Response.json(
              await queryRecords(
                store.db,
                collection,
                definition.object,
                url.searchParams,
              ),
            );
          if (
            method === "GET" &&
            segments[1] === "records" &&
            segments[3] === "summary"
          )
            return Response.json(
              await querySummary(
                store.db,
                collection,
                definition.object,
                url.searchParams,
              ),
            );
          if (method === "GET" && segments.length === 4) {
            const document = await store.get(collection, segments[3]);
            if (!document || document.deleted_at != null)
              return response("Registro no encontrado.", 404);
            if (segments[1] === "record-detail") {
              const hydrated = new Set(
                (await store.db.syncState.toArray())
                  .filter((s) => s.hydrated)
                  .map((s) => s.collection),
              );
              return Response.json(
                await queryRecordDetail(
                  store.db,
                  collection,
                  segments[3],
                  url.searchParams,
                  await store.db.collections.toArray(),
                  hydrated,
                ),
              );
            }
            return Response.json({ data: document });
          }
          const action =
            method === "POST" && segments.length === 3
              ? "create"
              : method === "PATCH" && segments.length === 4
                ? "update"
                : method === "DELETE" && segments.length === 4
                  ? "delete"
                  : undefined;
          if (action) {
            if (definition.capability !== "read-write")
              return response("Esta colección es de solo lectura local.", 403);
            const id = action === "create" ? crypto.randomUUID() : segments[3];
            const existing =
              action === "create" ? undefined : await store.get(collection, id);
            if (
              action !== "create" &&
              (!existing || existing.deleted_at != null)
            )
              return response("Registro no encontrado.", 404);
            const input =
              action === "delete"
                ? {}
                : (JSON.parse(String(init.body ?? "{}")) as Record<
                    string,
                    unknown
                  >);
            const validated =
              action === "delete"
                ? { data: undefined, errors: {} }
                : validateRecord(
                    definition.object,
                    Object.fromEntries(
                      Object.entries({ ...existing, ...input }).filter(
                        ([key]) => key in definition.object.config.fields,
                      ),
                    ),
                  );
            if (Object.keys(validated.errors).length)
              return response(Object.values(validated.errors).join(" "), 422);
            const baseVersion =
              action === "create"
                ? undefined
                : typeof input._version === "number"
                  ? input._version
                  : existing?._version;
            const data = await store.mutate(
              collection,
              action,
              id,
              validated.data,
              baseVersion,
            );
            // A durable local transaction, not a network acknowledgement, is success here.
            return Response.json(
              { data, local: true },
              { status: action === "create" ? 201 : 200 },
            );
          }
        } catch (error) {
          return response(
            error instanceof Error
              ? error.message
              : "No se pudo guardar o consultar el registro local.",
            error instanceof SyntaxError ? 422 : 400,
          );
        }
      }
    }
    // Only non-sensitive UI metadata is cached; credentials and actions never are.
    const cacheable =
      method === "GET" &&
      ["objects", "views", "collection-relations"].includes(segments[1]);
    const key = `${store.scope}:metadata:${path}`;
    const cached = cacheable
      ? await readWorkspaceMetadata<unknown>(key)
      : undefined;
    if (cached !== undefined) {
      if (navigator.onLine !== false) {
        void network(path, init)
          .then(async (result) => {
            if (result.ok) {
              const body = await result.json();
              await writeWorkspaceMetadata(key, body);
              if (segments[1] === "objects" && segments.length === 2)
                await writeWorkspaceMetadata(`${store.scope}:objects`, body);
            }
          })
          .catch(() => undefined);
      }
      return Response.json(cached);
    }
    let result: Response;
    try {
      result = await network(path, init);
    } catch (error) {
      if (isOfflineError(error)) {
        if (cached !== undefined) return Response.json(cached);
        if (
          method === "POST" &&
          bootstrapRoute &&
          (await store.db.collections.count()) > 0
        )
          return Response.json({ ok: true });
      }
      throw error;
    }
    if (cacheable && result.ok) {
      const body = await result.clone().json();
      await writeWorkspaceMetadata(key, body);
      if (segments[1] === "objects" && segments.length === 2)
        await writeWorkspaceMetadata(`${store.scope}:objects`, body);
    }
    if (!result.ok && result.status >= 500 && cached !== undefined)
      return Response.json(cached);
    if (
      result.status >= 500 &&
      method === "POST" &&
      bootstrapRoute &&
      (await store.db.collections.count()) > 0
    )
      return Response.json({ ok: true });
    if (method !== "GET" && result.ok) requestSync();
    return result;
  };
}
