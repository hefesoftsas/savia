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
type Project = RecoveryDraft & { id: string; updatedAt: string };
export default function PluginProjectWorkspace({
  tenantId,
  source,
  onClose,
  onPublished,
}: {
  tenantId: number;
  source?: { id: string; version: string };
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
  const [project, setProject] = useState<Project | null>(null);
  const [status, setStatus] = useState<SaveState>({ state: "saved" });
  const [error, setError] = useState("");
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
      if (source) {
        const response = await request<{ data: ProjectDraft }>(
          `/plugin-store/${encodeURIComponent(source.id)}/source?version=${encodeURIComponent(source.version)}`,
        );
        if (cancelled) return;
        const files = { ...response.data.files };
        const manifest = JSON.parse(files["savia-extension.json"]);
        const parts = String(manifest.version).split(".");
        if (parts.length === 3 && parts.every((part) => /^\d+$/.test(part)))
          manifest.version = `${parts[0]}.${parts[1]}.${Number(parts[2]) + 1}`;
        files["savia-extension.json"] = JSON.stringify(manifest, null, 2);
        await create({ files, history: [] });
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
    window.addEventListener("savia:identity-changed", leave);
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
      window.removeEventListener("savia:identity-changed", leave);
    };
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
      onClose();
    } catch (reason) {
      fail(reason);
    }
  }
  return (
    <div className="space-y-3">
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {project ? (
        <>
          <div className="flex flex-wrap items-center gap-3" role="status">
            <span>
              {status.state === "saved"
                ? tr("Proyecto guardado", "Project saved", "Projeto salvo")
                : status.state === "error"
                  ? tr(
                      "No se pudo guardar",
                      "Could not save",
                      "Não foi possível salvar",
                    )
                  : tr("Guardando…", "Saving…", "Salvando…")}
            </span>
            {status.state === "error" && (
              <>
                <span>
                  {String(
                    status.error instanceof Error
                      ? status.error.message
                      : status.error,
                  )}
                </span>
                <Button
                  onClick={() => void session.current?.flush().catch(fail)}
                >
                  {tr("Reintentar", "Retry", "Tentar novamente")}
                </Button>
                <Button
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
                  {tr(
                    "Guardar como copia",
                    "Save as copy",
                    "Salvar como cópia",
                  )}
                </Button>
              </>
            )}
          </div>
          <div inert={acting}>
            <PluginIde
              key={project.id}
              tenantId={tenantId}
              initialFiles={project.files}
              initialHistory={project.history}
              onDraftChange={(draft) => {
                latest.current = draft;
                session.current?.update(draft);
              }}
              canPublishShared={canPublishShared}
              onClose={() => void close()}
              onPublished={onPublished}
            />
          </div>
        </>
      ) : (
        <>
          <Button variant="ghost" onClick={onClose}>
            {tr("Volver al store", "Back to store", "Voltar à loja")}
          </Button>
          <h2 className="text-xl font-semibold">
            {tr(
              "Tus proyectos de plugins",
              "Your plugin projects",
              "Seus projetos de plugins",
            )}
          </h2>
          <Button
            disabled={loading || acting}
            onClick={() => void action(() => create())}
          >
            {tr("Nuevo proyecto", "New project", "Novo projeto")}
          </Button>
          {loading ? (
            <p role="status">{tr("Cargando…", "Loading…", "Carregando…")}</p>
          ) : (
            projects.map((item) => (
              <div key={item.id}>
                <Button
                  variant="outline"
                  disabled={acting}
                  onClick={() =>
                    void action(() =>
                      request<{ data: Project }>(
                        `/plugin-projects/${item.id}`,
                      ).then((result) => activate(result.data)),
                    )
                  }
                >
                  {item.label}
                </Button>
                <span className="ml-3 text-sm text-muted-foreground">
                  {item.updatedAt}
                </span>
                <Button
                  variant="ghost"
                  disabled={acting}
                  onClick={() =>
                    void action(() => remove(item.id, item.version))
                  }
                >
                  {tr("Eliminar", "Delete", "Excluir")}
                </Button>
              </div>
            ))
          )}
        </>
      )}
    </div>
  );
}
