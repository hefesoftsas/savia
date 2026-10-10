import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAppServices } from "@/features/assistant/assistant-context";
import { createEmbeddedTransport } from "@/api/embedded-transport";
import { useAppLocale } from "@/i18n/core";
import { apiFetch } from "./api";
import { getStudioRuntime } from "./runtime";
import PluginIde from "./plugin-ide";
import { createPluginProject } from "./plugin-ide-project";
import {
  PluginProjectSession,
  type ProjectDraft,
  type RecoveryDraft,
  type SaveState,
} from "./plugin-project-session";
import { pluginProjectSaveSchema } from "@savia/studio-shared/plugin-projects";
import { compareSolutionVersions } from "@savia/studio-shared/solution-package";
import { findMissingPluginSourceAssets } from "./plugin-source-compiler";
type Project = RecoveryDraft & { id: string; updatedAt: string };
type StoreCatalogItem = { id: string; label: string; version: string };

function groupStoreVersions(items: StoreCatalogItem[]) {
  const byId = new Map<string, StoreCatalogItem[]>();
  for (const item of items) {
    const versions = byId.get(item.id);
    if (versions) versions.push(item);
    else byId.set(item.id, [item]);
  }
  return [...byId.entries()]
    .map(([id, versions]) => {
      const sorted = [...versions].sort((a, b) =>
        compareSolutionVersions(b.version, a.version),
      );
      return { id, latest: sorted[0], older: sorted.slice(1) };
    })
    .sort((a, b) => a.latest.label.localeCompare(b.latest.label));
}

function nextPatchVersion(version: string): string {
  const parts = version.split(".");
  if (parts.length !== 3 || parts.some((part) => !/^\d+$/.test(part)))
    throw new Error(`Cannot increment invalid plugin version: ${version}`);
  return `${parts[0]}.${parts[1]}.${(BigInt(parts[2]) + 1n).toString()}`;
}

export default function PluginProjectWorkspace({
  tenantId,
  source,
  onSourceOpened,
  onClose,
  onPublished,
}: {
  tenantId: number;
  source?: { id: string; version: string };
  onSourceOpened?: () => void;
  onClose: () => void;
  onPublished: () => void | Promise<unknown>;
}) {
  const services = useAppServices();
  const locale = useAppLocale();
  const tr = (es: string, en: string, pt: string) =>
    locale.startsWith("es") ? es : locale.startsWith("pt") ? pt : en;
  const [transport] = useState(
    () =>
      getStudioRuntime().pluginTransport ??
      createEmbeddedTransport(
        services.apiClient,
        getStudioRuntime().apiBasePath ?? `/v1/studio/${tenantId}`,
      ),
  );
  const [requests] = useState(() => new AbortController());
  const request = <T,>(path: string, method = "GET", data?: unknown) =>
    apiFetch<T>(
      `/api${path}`,
      {
        method,
        signal: requests.signal,
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      },
      transport,
    );
  const [projects, setProjects] = useState<
    { id: string; label: string; version: number; updatedAt: string }[]
  >([]);
  const [storeItems, setStoreItems] = useState<
    { id: string; label: string; version: string }[]
  >([]);
  const [project, setProject] = useState<Project | null>(null);
  const [status, setStatus] = useState<SaveState>({ state: "saved" });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [canPublishShared, setCanPublishShared] = useState(false);
  const session = useRef<PluginProjectSession | null>(null);
  const owner = useRef("");
  const latest = useRef<ProjectDraft | null>(null);
  const mounted = useRef(true);
  const key = (id: string) =>
    `savia:plugin-project:${encodeURIComponent(owner.current)}:${tenantId}:${id}`;
  function activate(value: Project) {
    session.current?.dispose();
    let recovery: RecoveryDraft | undefined;
    try {
      const raw = localStorage.getItem(key(value.id));
      if (raw) recovery = pluginProjectSaveSchema.parse(JSON.parse(raw));
    } catch {
      /* Invalid recovery is never executed. */
    }
    if (recovery && recovery.version !== value.version) {
      setError(
        tr(
          "Hay una copia local pendiente. Se recuperará como proyecto separado.",
          "Pending local changes will be recovered as a separate project.",
          "As alterações locais serão recuperadas em um projeto separado.",
        ),
      );
      void create(recovery)
        .then(() => localStorage.removeItem(key(value.id)))
        .catch(fail);
      return;
    }
    const draft: ProjectDraft = recovery ?? value;
    latest.current = { files: draft.files, history: draft.history };
    const initial = { files: value.files, history: value.history };
    const current = new PluginProjectSession(
      value.version,
      initial,
      async (input) => {
        const identity = await services.authSession.getIdentity();
        if (String(identity?.id) !== owner.current)
          throw new Error(
            "The signed-in account changed. Reopen this project with its owner account.",
          );
        return (
          await request<{ data: Project }>(
            `/plugin-projects/${value.id}`,
            "PUT",
            input,
          )
        ).data;
      },
      (input) => {
        try {
          if (input) localStorage.setItem(key(value.id), JSON.stringify(input));
          else localStorage.removeItem(key(value.id));
        } catch {
          if (mounted.current)
            setError(
              tr(
                "La recuperación local no está disponible. Mantén abierta la página hasta guardar.",
                "Local recovery is unavailable. Keep this page open until saved.",
                "A recuperação local não está disponível. Mantenha a página aberta até salvar.",
              ),
            );
        }
      },
      (state) => {
        if (mounted.current) setStatus(state);
      },
    );
    session.current = current;
    setProject({ ...value, ...draft });
    setStatus({ state: "saved" });
    if (recovery)
      current.update({ files: recovery.files, history: recovery.history });
  }
  function fail(reason: unknown) {
    if (mounted.current)
      setError(reason instanceof Error ? reason.message : String(reason));
  }
  function formatUpdatedAt(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString(locale, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  }
  async function create(
    draft: ProjectDraft = { files: createPluginProject(), history: [] },
  ) {
    const id = crypto.randomUUID();
    const result = await request<{ data: Project }>(
      `/plugin-projects/${id}`,
      "PUT",
      { ...draft, version: 0 },
    );
    if (mounted.current) activate(result.data);
  }
  async function importFromStore(sourceId: string, sourceVersion: string) {
    const response = await request<{
      data: ProjectDraft & { synthesized?: boolean };
    }>(
      `/plugin-store/${encodeURIComponent(sourceId)}/source?version=${encodeURIComponent(sourceVersion)}`,
    );
    const catalog = await request<{
      data: Array<{
        manifest: { id: string; label?: string };
        version: string;
      }>;
    }>("/plugin-store");
    const versions = catalog.data
      .filter(
        (item) =>
          item?.manifest?.id === sourceId && typeof item.version === "string",
      )
      .map((item) => item.version);
    if (!versions.includes(sourceVersion))
      throw new Error(
        tr(
          "La versión seleccionada ya no está disponible. Actualiza el catálogo e inténtalo de nuevo.",
          "The selected release is no longer available. Refresh the catalog and try again.",
          "A versão selecionada não está mais disponível. Atualize o catálogo e tente novamente.",
        ),
      );
    const latestVersion = versions.reduce((latest, candidate) =>
      compareSolutionVersions(candidate, latest) > 0 ? candidate : latest,
    );
    const files = { ...response.data.files };
    const missingAssets = files["original-source.json"]
      ? findMissingPluginSourceAssets(files["original-source.json"])
      : [];
    if (missingAssets.length) {
      const compiled = await transport(
        `/api/plugin-store/${encodeURIComponent(sourceId)}/entry?version=${encodeURIComponent(sourceVersion)}`,
        { method: "GET", signal: requests.signal },
      );
      if (!compiled.ok)
        throw new Error("Could not recover the compiled plugin entry.");
      files["entry.tsx"] = await compiled.text();
      delete files["original-source.json"];
    }
    const manifest = JSON.parse(files["savia-extension.json"]);
    const targetVersion = nextPatchVersion(latestVersion);
    manifest.version = targetVersion;
    files["savia-extension.json"] = JSON.stringify(manifest, null, 2);
    const notices = [
      tr(
        `Se abrió ${sourceVersion} como base; el nuevo borrador será ${targetVersion} (última publicada: ${latestVersion}).`,
        `Opened ${sourceVersion} as the base; the new draft will be ${targetVersion} (latest release: ${latestVersion}).`,
        `A versão ${sourceVersion} foi aberta como base; o novo rascunho será ${targetVersion} (última publicada: ${latestVersion}).`,
      ),
      (response.data as { synthesized?: boolean }).synthesized
        ? tr(
            "Este plugin no incluía su código fuente; se abrió una copia de su JavaScript compilado.",
            "This plugin did not include its source; a copy of its compiled JavaScript was opened.",
            "Este plugin não incluía seu código-fonte; uma cópia do JavaScript compilado foi aberta.",
          )
        : "",
      missingAssets.length
        ? tr(
            "Esta versión no conserva todos sus archivos fuente; se recuperó su JavaScript compilado como base editable.",
            "This release does not retain all of its source files; its compiled JavaScript was recovered as the editable base.",
            "Esta versão não conserva todos os arquivos-fonte; seu JavaScript compilado foi recuperado como base editável.",
          )
        : "",
    ].filter(Boolean);
    setNotice(notices.join(" "));
    await create({ files, history: [] });
  }
  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    void (async () => {
      const identity = await services.authSession.getIdentity();
      if (cancelled) return;
      if (!identity?.id) throw new Error("A signed-in identity is required.");
      owner.current = String(identity.id);
      const result = await request<{ data: typeof projects }>(
        "/plugin-projects",
      );
      if (cancelled) return;
      setProjects(result.data);
      void request<{
        data: Array<{
          manifest: { id: string; label?: string };
          version: string;
        }>;
      }>("/plugin-store")
        .then((store) => {
          if (cancelled || !Array.isArray(store.data)) return;
          const items = store.data
            .filter(
              (item) =>
                item &&
                typeof item.manifest?.id === "string" &&
                typeof item.version === "string",
            )
            .map((item) => ({
              id: item.manifest.id,
              label:
                typeof item.manifest.label === "string" &&
                item.manifest.label.trim()
                  ? item.manifest.label
                  : item.manifest.id,
              version: item.version,
            }))
            .sort((a, b) => a.label.localeCompare(b.label));
          if (!cancelled) setStoreItems(items);
        })
        .catch(() => {
          /* The store list is best-effort; projects remain usable. */
        });
      if (source) {
        await importFromStore(source.id, source.version);
        if (cancelled) return;
        onSourceOpened?.();
      }
      const registry = await request<{ canPublish?: boolean }>(
        "/plugin-store/registry",
      ).catch(() => null);
      if (!cancelled) setCanPublishShared(registry?.canPublish === true);
    })()
      .catch(fail)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    const leave = () => {
      cancelled = true;
      requests.abort();
      session.current?.cancel();
      session.current = null;
      setProject(null);
      setProjects([]);
      setLoading(true);
      // The store closes this workspace; reopening captures the new account and transport.
      onClose();
    };
    window.addEventListener("savia:session-cleared", leave);
    window.addEventListener("savia:principal-changed", leave);
    const guard = (event: BeforeUnloadEvent) => {
      if (session.current && !session.current.isSaved) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => {
      cancelled = true;
      mounted.current = false;
      void session.current?.flush().catch(() => {});
      session.current?.dispose();
      window.removeEventListener("beforeunload", guard);
      window.removeEventListener("savia:session-cleared", leave);
      window.removeEventListener("savia:principal-changed", leave);
    };
    // The direct-source route is captured on mount. Clearing its query after
    // opening must not re-run the import and create a duplicate draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function action(run: () => Promise<unknown>) {
    if (acting) return;
    setActing(true);
    try {
      await run();
    } catch (reason) {
      fail(reason);
    } finally {
      if (mounted.current) setActing(false);
    }
  }
  async function remove(id: string, version: number) {
    if (
      !window.confirm(
        tr(
          "¿Eliminar este proyecto guardado? No elimina versiones publicadas.",
          "Delete this saved project? Published releases are kept.",
          "Excluir este projeto salvo? As versões publicadas serão mantidas.",
        ),
      )
    )
      return;
    await request(`/plugin-projects/${id}?version=${version}`, "DELETE");
    localStorage.removeItem(key(id));
    setProjects((values) => values.filter((item) => item.id !== id));
  }
  async function close() {
    try {
      await session.current?.flush();
      const refreshed = await request<{ data: typeof projects }>(
        "/plugin-projects",
      );
      setProjects(refreshed.data);
      session.current?.dispose();
      session.current = null;
      setProject(null);
      setStatus({ state: "saved" });
    } catch (reason) {
      fail(reason);
    }
  }
  const groupedStoreItems = groupStoreVersions(storeItems);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {project ? (
        <section
          aria-label={tr(
            "Editor de plugins",
            "Plugin Studio",
            "Editor de plugins",
          )}
          className="flex min-h-0 min-w-0 flex-1 flex-col"
        >
          {error && (
            <p role="alert" className="mb-2 text-sm text-destructive">
              {error}
            </p>
          )}
          {notice && (
            <div
              role="status"
              className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300"
            >
              <span className="min-w-0 flex-1">{notice}</span>
              <Button size="sm" variant="ghost" onClick={() => setNotice("")}>
                {tr("Entendido", "Got it", "Entendi")}
              </Button>
            </div>
          )}
          {status.state === "error" && (
            <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1">
                {tr(
                  "No se pudo guardar",
                  "Could not save",
                  "Não foi possível salvar",
                )}
                :{" "}
                {String(
                  status.error instanceof Error
                    ? status.error.message
                    : status.error,
                )}
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void session.current?.flush().catch(fail)}
              >
                {tr("Reintentar", "Retry", "Tentar novamente")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={acting}
                onClick={() => {
                  const draft = latest.current;
                  const previousKey = key(project.id);
                  if (draft)
                    void action(async () => {
                      await create(draft);
                      try {
                        localStorage.removeItem(previousKey);
                      } catch {
                        /* The new server copy is already saved. */
                      }
                    });
                }}
              >
                {tr("Guardar como copia", "Save as copy", "Salvar como cópia")}
              </Button>
            </div>
          )}
          <div className="min-h-0 min-w-0 flex-1" inert={acting}>
            <PluginIde
              key={project.id}
              tenantId={tenantId}
              initialFiles={project.files}
              initialHistory={project.history}
              backLabel={tr(
                "Volver a proyectos",
                "Back to plugin projects",
                "Voltar aos projetos de plugins",
              )}
              saveStatus={
                <span data-save-state={status.state}>
                  {status.state === "saved"
                    ? tr("Guardado", "Saved", "Salvo")
                    : status.state === "error"
                      ? tr(
                          "No se pudo guardar",
                          "Could not save",
                          "Não foi possível salvar",
                        )
                      : tr("Guardando…", "Saving…", "Salvando…")}
                </span>
              }
              onDraftChange={(draft) => {
                latest.current = draft;
                session.current?.update(draft);
              }}
              canPublishShared={canPublishShared}
              onClose={() => void close()}
              onPublished={onPublished}
            />
          </div>
        </section>
      ) : (
        <section
          aria-label={tr(
            "Tus proyectos de plugins",
            "Your plugin projects",
            "Seus projetos de plugins",
          )}
          className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col gap-4 overflow-y-auto px-4 py-4 sm:px-6"
        >
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {notice && (
            <div
              role="status"
              className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300"
            >
              <span className="min-w-0 flex-1">{notice}</span>
              <Button size="sm" variant="ghost" onClick={() => setNotice("")}>
                {tr("Entendido", "Got it", "Entendi")}
              </Button>
            </div>
          )}
          <header className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:flex-wrap sm:items-center">
            <Button
              variant="ghost"
              size="sm"
              className="self-start"
              onClick={onClose}
            >
              {tr(
                "Volver a extensiones",
                "Back to extensions",
                "Voltar às extensões",
              )}
            </Button>
            <h1 className="min-w-0 flex-1 text-lg font-semibold tracking-tight text-foreground">
              {tr(
                "Tus proyectos de plugins",
                "Your plugin projects",
                "Seus projetos de plugins",
              )}
            </h1>
            <Button
              size="sm"
              disabled={loading || acting}
              onClick={() => void action(() => create())}
            >
              {tr("Nuevo proyecto", "New project", "Novo projeto")}
            </Button>
          </header>
          {loading ? (
            <p role="status" className="py-4 text-sm text-muted-foreground">
              {tr("Cargando…", "Loading…", "Carregando…")}
            </p>
          ) : projects.length === 0 ? (
            <div className="py-6">
              <h2 className="text-sm font-medium text-foreground">
                {tr(
                  "Todavía no hay proyectos",
                  "No projects yet",
                  "Ainda não há projetos",
                )}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {tr(
                  "Crea un proyecto para empezar a diseñar y probar un plugin.",
                  "Create a project to start building and previewing a plugin.",
                  "Crie um projeto para começar a criar e testar um plugin.",
                )}
              </p>
            </div>
          ) : (
            <ul className="divide-y rounded-lg border bg-background px-3">
              {projects.map((item) => (
                <li
                  key={item.id}
                  className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 py-2.5"
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    className="min-w-0"
                    disabled={acting}
                    onClick={() =>
                      void action(() =>
                        request<{ data: Project }>(
                          `/plugin-projects/${item.id}`,
                        ).then((result) => activate(result.data)),
                      )
                    }
                  >
                    <span className="truncate">{item.label}</span>
                  </Button>
                  <span
                    className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground"
                    title={item.updatedAt}
                  >
                    {formatUpdatedAt(item.updatedAt)}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={acting}
                    onClick={() =>
                      void action(() => remove(item.id, item.version))
                    }
                  >
                    {tr("Eliminar", "Delete", "Excluir")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {!loading && storeItems.length > 0 && (
            <section
              aria-label={tr(
                "Abrir un plugin existente",
                "Open an existing plugin",
                "Abrir um plugin existente",
              )}
              className="flex flex-col gap-2 rounded-lg border bg-background px-3 py-3"
            >
              <h2 className="text-sm font-medium text-foreground">
                {tr(
                  "Abrir un plugin existente",
                  "Open an existing plugin",
                  "Abrir um plugin existente",
                )}
              </h2>
              <p className="text-sm text-muted-foreground">
                {tr(
                  "La última versión inicia una actualización. Las anteriores solo sirven como base para un nuevo borrador.",
                  "Start an update from the latest release. Older releases are available only as bases for a new draft.",
                  "Comece uma atualização a partir da última versão. As versões anteriores só podem ser usadas como base para um novo rascunho.",
                )}
              </p>
              <ul className="divide-y">
                {groupedStoreItems.map(({ id, latest, older }) => (
                  <li key={id} className="py-2">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {latest.label}{" "}
                        <span className="text-xs text-muted-foreground">
                          {latest.version}
                        </span>
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0"
                        disabled={acting}
                        onClick={() =>
                          void action(() => importFromStore(id, latest.version))
                        }
                      >
                        {tr(
                          "Editar última versión",
                          "Edit latest",
                          "Editar última versão",
                        )}
                      </Button>
                    </div>
                    {older.length > 0 && (
                      <details className="mt-2 pl-3 text-sm">
                        <summary className="cursor-pointer text-muted-foreground">
                          {tr(
                            `Versiones anteriores (${older.length})`,
                            `Older versions (${older.length})`,
                            `Versões anteriores (${older.length})`,
                          )}
                        </summary>
                        <ul className="mt-1 divide-y border-l pl-3">
                          {older.map((item) => (
                            <li
                              key={`${item.id}@${item.version}`}
                              className="flex min-w-0 items-center gap-3 py-2"
                            >
                              <span className="min-w-0 flex-1 truncate text-sm">
                                {item.version}
                              </span>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="shrink-0"
                                disabled={acting}
                                onClick={() =>
                                  void action(() =>
                                    importFromStore(item.id, item.version),
                                  )
                                }
                              >
                                {tr(
                                  "Usar como base",
                                  "Use as base",
                                  "Usar como base",
                                )}
                              </Button>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </section>
      )}
    </div>
  );
}
