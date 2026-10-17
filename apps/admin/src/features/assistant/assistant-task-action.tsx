import { useEffect, useMemo, useRef, useState } from "react";
import { CheckSquare2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMessages, type MessageCatalog } from "@/i18n/core";
import type {
  PluginAssistantProvider,
  PluginAssistantResponse,
  PluginAssistantTaskSuggestion,
} from "@savia/studio-shared/plugin-assistant";

const messages = {
  "Crear pendiente": ["Crear pendiente", "Create task", "Criar tarefa"],
  "Buscar requisitos": [
    "Buscar requisitos",
    "Search requirements",
    "Buscar requisitos",
  ],
  "Requisito por preparar o verificar": [
    "Requisito por preparar o verificar",
    "Requirement to prepare or verify",
    "Requisito a preparar ou verificar",
  ],
  "Selecciona un requisito": [
    "Selecciona un requisito",
    "Select a requirement",
    "Selecione um requisito",
  ],
  "Busca por título, descripción o referencia.": [
    "Busca por título, descripción o referencia.",
    "Search by title, description, or reference.",
    "Busque por título, descrição ou referência.",
  ],
  Título: ["Título", "Title", "Título"],
  Responsable: ["Responsable", "Responsible person", "Responsável"],
  "Fecha límite": ["Fecha límite", "Due date", "Data limite"],
  "Revisa la fuente original: la extracción OCR y la evidencia de la empresa pueden estar incompletas.":
    [
      "Revisa la fuente original: la extracción OCR y la evidencia de la empresa pueden estar incompletas.",
      "Check the original source: OCR extraction and company evidence may be incomplete.",
      "Confira a fonte original: a extração por OCR e as evidências da empresa podem estar incompletas.",
    ],
  "Guardar pendiente": ["Guardar pendiente", "Save task", "Salvar tarefa"],
  "Guardando…": ["Guardando…", "Saving…", "Salvando…"],
  "Pendiente creado.": ["Pendiente creado.", "Task created.", "Tarefa criada."],
  "Este pendiente ya existía.": [
    "Este pendiente ya existía.",
    "This task already existed.",
    "Esta tarefa já existia.",
  ],
  "No se pudo guardar el pendiente. Intenta de nuevo.": [
    "No se pudo guardar el pendiente. Intenta de nuevo.",
    "Could not save the task. Try again.",
    "Não foi possível salvar a tarefa. Tente novamente.",
  ],
  "Selecciona un requisito y completa el título, responsable y fecha límite.": [
    "Selecciona un requisito y completa el título, responsable y fecha límite.",
    "Select a requirement and enter a title, responsible person, and due date.",
    "Selecione um requisito e informe o título, responsável e data limite.",
  ],
  "La fecha límite no es válida.": [
    "La fecha límite no es válida.",
    "The due date is invalid.",
    "A data limite é inválida.",
  ],
  "Esta respuesta usa una versión anterior de la fuente. Actualiza la respuesta antes de crear un pendiente.":
    [
      "Esta respuesta usa una versión anterior de la fuente. Actualiza la respuesta antes de crear un pendiente.",
      "This answer uses an earlier source version. Refresh the answer before creating a task.",
      "Esta resposta usa uma versão anterior da fonte. Atualize a resposta antes de criar uma tarefa.",
    ],
  "Las referencias seleccionadas exceden el límite permitido.": [
    "Las referencias seleccionadas exceden el límite permitido.",
    "The selected source references exceed the allowed limit.",
    "As referências selecionadas excedem o limite permitido.",
  ],
  "Ver pendientes": ["Ver pendientes", "View tasks", "Ver tarefas"],
} satisfies MessageCatalog;

type Props = {
  provider: PluginAssistantProvider;
  message: PluginAssistantResponse["messages"][number];
};

function contextKey(
  provider: PluginAssistantProvider,
  message: PluginAssistantResponse["messages"][number],
) {
  return JSON.stringify([
    provider.sessionId,
    provider.connectionId ?? "",
    provider.context,
    message.id,
  ]);
}

function isValidCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function sourceReference(
  suggestion: PluginAssistantTaskSuggestion,
  message: Props["message"],
) {
  const selected = new Set(suggestion.citationIds);
  return (message.citations ?? [])
    .filter((citation) => selected.has(citation.id))
    .map((citation) => `${citation.label}\n${citation.excerpt}`)
    .join("\n\n");
}

function taskCollectionHref(collection: string | undefined) {
  if (!collection || !/^[A-Za-z][A-Za-z0-9_]{0,99}$/.test(collection))
    return null;
  const current = new URL(window.location.href);
  const hashParts = current.hash.slice(1).split("?", 2);
  const hashParams = new URLSearchParams(hashParts[1] ?? "");
  const tenantId =
    hashParams.get("tenantId") ?? current.searchParams.get("tenantId");
  const params = new URLSearchParams();
  if (tenantId) params.set("tenantId", tenantId);
  params.set("object", collection);
  params.set("view", "records");
  return `#/studio?${params.toString()}`;
}

export function AssistantTaskAction({ provider, message }: Props) {
  const t = useMessages(messages);
  const suggestions = message.taskSuggestions ?? [];
  if (!provider.createTask || suggestions.length === 0) return null;
  if (message.stale) {
    return (
      <div className="min-w-0">
        <div className="w-full max-w-xl text-sm">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-9"
            disabled
          >
            <CheckSquare2 aria-hidden="true" />
            {t("Crear pendiente")}
          </Button>
          <p className="mt-2 text-xs text-muted-foreground" role="status">
            {t(
              "Esta respuesta usa una versión anterior de la fuente. Actualiza la respuesta antes de crear un pendiente.",
            )}
          </p>
        </div>
      </div>
    );
  }
  const key = contextKey(provider, message);
  return (
    <TaskActionForm
      key={key}
      contextKey={key}
      provider={provider}
      message={message}
      suggestions={suggestions}
    />
  );
}

function TaskActionForm({
  contextKey: currentContext,
  provider,
  message,
  suggestions,
}: Props & {
  contextKey: string;
  suggestions: PluginAssistantTaskSuggestion[];
}) {
  const t = useMessages(messages);
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<
    "save" | "validation" | "date" | "source" | null
  >(null);
  const [created, setCreated] = useState<boolean | null>(null);
  const mounted = useRef(true);
  const attempt = useRef(0);
  const selected = suggestions.find((item) => item.id === selectedId);
  const collectionUrl = useMemo(
    () => taskCollectionHref(provider.taskCollection),
    [provider.taskCollection, currentContext],
  );
  const filteredSuggestions = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    if (!search) return suggestions;
    return suggestions.filter((item) =>
      `${item.title}\n${item.description}\n${item.id}`
        .toLocaleLowerCase()
        .includes(search),
    );
  }, [query, suggestions]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      attempt.current += 1;
    };
  }, []);

  function chooseSuggestion(id: string) {
    setSelectedId(id);
    setQuery("");
    const suggestion = suggestions.find((item) => item.id === id);
    setTitle(suggestion?.title ?? "");
    setError(null);
    setCreated(null);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || created !== null) return;
    const normalizedTitle = title.trim();
    const normalizedAssignee = assignee.trim();
    if (
      !selected ||
      !normalizedTitle ||
      normalizedTitle.length > 200 ||
      !normalizedAssignee ||
      normalizedAssignee.length > 120 ||
      !dueDate
    ) {
      setError("validation");
      return;
    }
    if (!isValidCalendarDate(dueDate)) {
      setError("date");
      return;
    }
    const reference = sourceReference(selected, message);
    if (reference.length > 20_000) {
      setError("source");
      return;
    }
    const currentAttempt = ++attempt.current;
    setPending(true);
    setError(null);
    try {
      const result = await provider.createTask!({
        suggestion: selected,
        title: normalizedTitle,
        assignee: normalizedAssignee,
        dueDate,
        sourceReference: reference,
      });
      if (!mounted.current || currentAttempt !== attempt.current) return;
      setCreated(result.created);
    } catch {
      if (!mounted.current || currentAttempt !== attempt.current) return;
      setError("save");
    } finally {
      if (mounted.current && currentAttempt === attempt.current)
        setPending(false);
    }
  }

  return (
    <div className={expanded ? "w-full min-w-0" : "min-w-0"}>
      <div className="w-full max-w-xl text-sm">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-9"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <CheckSquare2 aria-hidden="true" />
          {t("Crear pendiente")}
        </Button>
        {expanded && (
          <form
            aria-label={t("Crear pendiente")}
            className="mt-3 grid max-h-[55dvh] gap-3 overflow-y-auto overscroll-contain border-t border-border/70 bg-card/50 p-3 pr-1 shadow-xs"
            onSubmit={(event) => void submit(event)}
          >
            <div className="grid gap-1.5">
              <label
                htmlFor={`assistant-task-search-${message.id}`}
                className="font-medium"
              >
                {t("Buscar requisitos")}
              </label>
              <Input
                id={`assistant-task-search-${message.id}`}
                type="search"
                value={query}
                disabled={pending || created !== null}
                placeholder={t("Busca por título, descripción o referencia.")}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <label
                htmlFor={`assistant-task-requirement-${message.id}`}
                className="font-medium"
              >
                {t("Requisito por preparar o verificar")}
              </label>
              <select
                id={`assistant-task-requirement-${message.id}`}
                required
                value={selectedId}
                disabled={pending || created !== null}
                onChange={(event) => chooseSuggestion(event.target.value)}
                className="min-h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-foreground focus-visible:outline-2 focus-visible:outline-ring"
              >
                <option value="">{t("Selecciona un requisito")}</option>
                {filteredSuggestions.map((suggestion) => (
                  <option key={suggestion.id} value={suggestion.id}>
                    {suggestion.title}
                  </option>
                ))}
              </select>
            </div>
            {selected && (
              <div className="rounded-md border border-border/70 bg-muted/40 p-3">
                <p className="whitespace-pre-wrap">{selected.description}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {t(
                    "Revisa la fuente original: la extracción OCR y la evidencia de la empresa pueden estar incompletas.",
                  )}
                </p>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5 sm:col-span-2">
                <label
                  htmlFor={`assistant-task-title-${message.id}`}
                  className="font-medium"
                >
                  {t("Título")}
                </label>
                <Input
                  id={`assistant-task-title-${message.id}`}
                  required
                  maxLength={200}
                  value={title}
                  disabled={pending || created !== null}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <label
                  htmlFor={`assistant-task-assignee-${message.id}`}
                  className="font-medium"
                >
                  {t("Responsable")}
                </label>
                <Input
                  id={`assistant-task-assignee-${message.id}`}
                  required
                  maxLength={120}
                  value={assignee}
                  disabled={pending || created !== null}
                  onChange={(event) => setAssignee(event.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <label
                  htmlFor={`assistant-task-date-${message.id}`}
                  className="font-medium"
                >
                  {t("Fecha límite")}
                </label>
                <Input
                  id={`assistant-task-date-${message.id}`}
                  type="date"
                  required
                  value={dueDate}
                  disabled={pending || created !== null}
                  onChange={(event) => setDueDate(event.target.value)}
                />
              </div>
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {t(
                  error === "save"
                    ? "No se pudo guardar el pendiente. Intenta de nuevo."
                    : error === "date"
                      ? "La fecha límite no es válida."
                      : error === "source"
                        ? "Las referencias seleccionadas exceden el límite permitido."
                        : "Selecciona un requisito y completa el título, responsable y fecha límite.",
                )}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="submit"
                size="sm"
                disabled={pending || created !== null}
              >
                {pending ? t("Guardando…") : t("Guardar pendiente")}
              </Button>
              {created !== null && (
                <p role="status" className="text-sm text-muted-foreground">
                  {t(
                    created
                      ? "Pendiente creado."
                      : "Este pendiente ya existía.",
                  )}
                </p>
              )}
              {created !== null && collectionUrl && (
                <a
                  className="font-medium text-primary underline underline-offset-4"
                  href={collectionUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t("Ver pendientes")}
                </a>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
