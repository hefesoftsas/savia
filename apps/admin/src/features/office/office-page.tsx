import { useEffect, useRef, useState } from "react";
import {
  OfficeApi,
  type OfficeMetadata,
  type OfficeRevision,
} from "./office-api";
import { loadOfficeEngine, type OfficeEngine } from "./office-engine";
function download(bytes: Uint8Array, name: string, mime: string) {
  const url = URL.createObjectURL(
    new Blob([bytes.slice().buffer], { type: mime }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function OfficePage({
  search = window.location.search,
}: {
  search?: string;
}) {
  const returnTo =
    new URLSearchParams(search).get("base") === "/v1/office-documents"
      ? "/#/office-suite"
      : "/";
  const canvas = useRef<HTMLCanvasElement>(null),
    engine = useRef<OfficeEngine | null>(null);
  const api = useRef<OfficeApi | null>(null),
    busy = useRef(false),
    changed = useRef(false),
    saveAction = useRef(() => {});
  const changes = useRef(0);
  const readOnly = useRef(false);
  const originalBytes = useRef<Uint8Array | null>(null);
  const [meta, setMeta] = useState<OfficeMetadata | null>(null);
  const [revisions, setRevisions] = useState<OfficeRevision[]>([]);
  const [status, setStatus] = useState("Abriendo documento…"),
    [error, setError] = useState("");
  const [ready, setReady] = useState(false),
    [dirty, setDirty] = useState(false),
    [saving, setSaving] = useState(false);
  function markDirty() {
    if (readOnly.current) return;
    changes.current++;
    changed.current = true;
    setDirty(true);
  }
  useEffect(() => {
    let cancelled = false;
    readOnly.current = false;
    originalBytes.current = null;
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (changed.current || busy.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    const keydown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        e.stopPropagation();
        saveAction.current();
      }
    };
    window.addEventListener("keydown", keydown, true);
    void (async () => {
      try {
        const query = new URLSearchParams(search),
          client = new OfficeApi(
            query.get("base") ?? "",
            query.get("file") ?? "",
          );
        api.current = client;
        const info = await client.metadata();
        if (cancelled) return;
        setMeta(info);
        readOnly.current = info.readOnly;
        document.title = info.name + " · Savia";
        if (info.size > info.maxSize)
          throw new Error(
            "El archivo supera el tamaño admitido por el editor.",
          );
        setStatus("Cargando editor… La primera apertura puede tardar.");
        const bytes = await client.download(info.version);
        if (cancelled) return;
        originalBytes.current = bytes.slice();
        const runtime = await loadOfficeEngine(canvas.current!, {
          onDirty: markDirty,
          onError: (e) => {
            if (!cancelled) {
              setError(e.message);
              setReady(false);
            }
          },
          onSave: () => {
            if (!readOnly.current) saveAction.current();
          },
        });
        if (cancelled) {
          runtime.dispose();
          return;
        }
        engine.current = runtime;
        await runtime.open(bytes, info.name, { readOnly: info.readOnly });
        if (cancelled) return;
        setReady(true);
        setStatus(info.readOnly ? "Modo de solo lectura" : "Guardado en Savia");
        try {
          setRevisions(await client.revisions());
        } catch {
          /* history can be retried by reopening */
        }
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error ? e.message : "No se pudo abrir el documento.",
          );
          setStatus("No se pudo abrir el documento");
        }
      }
    })();
    return () => {
      cancelled = true;
      engine.current?.dispose();
      engine.current = null;
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("keydown", keydown, true);
    };
  }, [search]);
  async function save() {
    if (
      !ready ||
      !meta ||
      meta.readOnly ||
      !engine.current ||
      busy.current ||
      !changed.current
    )
      return;
    busy.current = true;
    setSaving(true);
    setError("");
    try {
      const bytes = await engine.current.save();
      const generation = changes.current;
      const result = await api.current!.save(meta, bytes);
      setMeta({ ...meta, version: result.version, size: bytes.length });
      changed.current = changes.current !== generation;
      setDirty(changed.current);
      setStatus("Guardado en Savia");
      try {
        setRevisions(await api.current!.revisions());
      } catch {
        setRevisions([]);
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "No se pudo guardar. Descarga una copia para conservar tus cambios.",
      );
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }
  saveAction.current = () => void save();
  async function recovery() {
    if (!meta || (!meta.readOnly && !engine.current) || busy.current) return;
    busy.current = true;
    setSaving(true);
    try {
      const bytes = meta.readOnly
        ? originalBytes.current
        : await engine.current!.save();
      if (!bytes)
        throw new Error("No se pudo descargar el documento original.");
      download(bytes, meta.name, meta.mime);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }
  async function versionDownload(version: number) {
    if (!meta) return;
    try {
      download(
        await api.current!.download(version),
        meta.name.replace(/(\.[^.]+)$/, "-v" + version + "$1"),
        meta.mime,
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <main className="office-page">
      <header className="office-header">
        <a
          className="office-back"
          href={returnTo}
          onClick={(e) => {
            if (
              (changed.current || busy.current) &&
              !window.confirm("Hay cambios sin guardar. ¿Salir del documento?")
            )
              e.preventDefault();
          }}
        >
          ← Savia
        </a>
        <div className="office-title">
          <span className="office-suite-label">Suite de ofimática</span>
          <h1>{meta?.name ?? "Editar documento"}</h1>
          <p role="status">
            {saving ? "Guardando…" : dirty ? "Cambios sin guardar" : status}
            {meta && (
              <span className="office-version">Versión {meta.version}</span>
            )}
          </p>
        </div>
        <div className="office-actions">
          <button onClick={() => void recovery()} disabled={!ready || saving}>
            Descargar copia
          </button>
          {!meta?.readOnly ? (
            <button
              className="office-save"
              onClick={() => void save()}
              disabled={!ready || !dirty || saving}
            >
              Guardar
            </button>
          ) : null}
        </div>
      </header>
      {error && (
        <div className="office-error" role="alert">
          <p>{error}</p>
          {ready ? (
            <p>
              Tus cambios siguen en esta ventana. Descarga una copia antes de
              volver a abrir el archivo.
            </p>
          ) : (
            <a href={returnTo}>Volver a Savia</a>
          )}
        </div>
      )}
      <section className="office-workspace" aria-label="Documento">
        {!ready && !error && (
          <div className="office-loading" role="status">
            <div className="office-loading-mark" aria-hidden="true">
              S
            </div>
            <strong>Preparando tu espacio de trabajo</strong>
            <p>{status}</p>
            <span>Motor de edición: ZetaOffice · WebAssembly</span>
          </div>
        )}
        <canvas
          ref={canvas}
          id="qtcanvas"
          contentEditable={!meta?.readOnly}
          suppressContentEditableWarning
          aria-readonly={meta?.readOnly || undefined}
          tabIndex={0}
          aria-label="Contenido del documento"
          style={{ visibility: ready ? "visible" : "hidden" }}
          inert={saving}
          onContextMenu={(e) => e.preventDefault()}
          onKeyDown={(e) => e.preventDefault()}
        />
      </section>
      <footer className="office-footer">
        <div className="office-footer-info">
          <span>
            {meta?.readOnly
              ? "Documento abierto en modo de solo lectura."
              : "Los cambios se guardan al pulsar Guardar."}
          </span>
          <span className="office-attribution">
            Motor de edición: ZetaOffice
          </span>
        </div>
        <details>
          <summary>Historial de versiones</summary>
          <ul>
            {revisions.map((r) => (
              <li key={r.version}>
                <span>
                  Versión {r.version} ·{" "}
                  {new Date(r.created_at).toLocaleString("es-CO")}
                </span>
                <button onClick={() => void versionDownload(r.version)}>
                  Descargar versión {r.version}
                </button>
              </li>
            ))}
          </ul>
          {!revisions.length && (
            <p>El historial se actualizará al volver a abrir el documento.</p>
          )}
        </details>
      </footer>
    </main>
  );
}
