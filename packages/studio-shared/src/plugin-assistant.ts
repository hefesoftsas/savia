export type PluginAssistantOpenRequest = {
  title: string;
  actionId: string;
  connectionId?: string;
  context: Record<string, unknown>;
  initialMessage?: string;
  taskCollection?: string;
};

export type PluginAssistantRequest =
  | { method: "load" }
  | { method: "generate-document"; actionId: string }
  | { method: "open-source"; messageId: string; citationId: string }
  | {
      method: "send";
      message: string;
      idempotencyKey: string;
      conversationId?: string;
      expectedRevision?: number;
    }
  | { method: "poll"; jobId: string };

export type PluginAssistantTaskSuggestion = {
  id: string;
  title: string;
  description: string;
  citationIds: string[];
};
export type PluginAssistantTaskDraft = {
  suggestion: PluginAssistantTaskSuggestion;
  title: string;
  assignee: string;
  dueDate: string;
  sourceReference: string;
};

export type PluginAssistantResponse = {
  conversationId?: string;
  revision: number;
  messages: Array<{
    id: string;
    role: "user" | "assistant";
    text: string;
    citations?: Array<{
      id: string;
      label: string;
      excerpt: string;
      canOpen?: boolean;
    }>;
    taskSuggestions?: PluginAssistantTaskSuggestion[];
    stale?: boolean;
    insufficientEvidence?: boolean;
  }>;
  source?: { url: string; page?: number };
  documentActions?: Array<{
    id: string;
    label: string;
    format: "docx";
    fileName?: string;
  }>;
  document?: { url: string; fileName: string; format: "docx" };
  pendingJobId?: string;
  coverage?: { label: string; complete: boolean };
};

export type PluginAssistantProvider = PluginAssistantOpenRequest & {
  sessionId: string;
  invoke(request: PluginAssistantRequest): Promise<PluginAssistantResponse>;
  createTask?(
    draft: PluginAssistantTaskDraft,
  ): Promise<{ id: string; created: boolean }>;
  close(): void;
};

const MAX_OPEN_SIZE = 32_000;
const MAX_CONTEXT_SIZE = 16_384;
const MAX_CONTEXT_DEPTH = 12;
const MAX_MESSAGES = 2_000;
const MAX_RESPONSE_SIZE = 2_000_000;
const MAX_MESSAGE_TEXT = 500_000;
const MAX_CITATIONS = 1_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeJsonSize(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function validContext(
  value: unknown,
  depth = 0,
): value is Record<string, unknown> {
  if (!isRecord(value) || depth > MAX_CONTEXT_DEPTH) return false;
  for (const item of Object.values(value)) {
    if (item === null || typeof item === "string" || typeof item === "boolean")
      continue;
    if (typeof item === "number" && Number.isFinite(item)) continue;
    if (Array.isArray(item)) {
      if (
        item.length > 100 ||
        item.some((entry) => !validContextValue(entry, depth + 1))
      )
        return false;
      continue;
    }
    if (isRecord(item) && validContext(item, depth + 1)) continue;
    return false;
  }
  return true;
}

function validContextValue(value: unknown, depth: number): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value))
    return (
      value.length <= 100 &&
      value.every((entry) => validContextValue(entry, depth + 1))
    );
  return isRecord(value) && validContext(value, depth + 1);
}

/** Strictly validate the plugin request before it is bound to a host chat session. */
export function parsePluginAssistantOpenRequest(
  value: unknown,
): PluginAssistantOpenRequest | null {
  if (!isRecord(value)) return null;
  if (
    Object.keys(value).some(
      (key) =>
        ![
          "title",
          "actionId",
          "connectionId",
          "context",
          "initialMessage",
          "taskCollection",
        ].includes(key),
    )
  )
    return null;
  if (
    typeof value.title !== "string" ||
    !value.title.trim() ||
    value.title.length > 160
  )
    return null;
  if (
    typeof value.actionId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value.actionId)
  )
    return null;
  if (
    value.connectionId !== undefined &&
    (typeof value.connectionId !== "string" ||
      !value.connectionId.trim() ||
      value.connectionId.length > 256)
  )
    return null;
  if (
    value.taskCollection !== undefined &&
    (typeof value.taskCollection !== "string" ||
      !/^[A-Za-z][A-Za-z0-9_]{0,99}$/.test(value.taskCollection))
  )
    return null;
  if (
    value.initialMessage !== undefined &&
    (typeof value.initialMessage !== "string" ||
      value.initialMessage.length > 8_000)
  )
    return null;
  if (
    !validContext(value.context) ||
    safeJsonSize(value.context) > MAX_CONTEXT_SIZE ||
    safeJsonSize(value) > MAX_OPEN_SIZE
  )
    return null;
  return {
    title: value.title.trim(),
    actionId: value.actionId,
    ...(value.connectionId === undefined
      ? {}
      : { connectionId: value.connectionId }),
    context: value.context,
    ...(value.taskCollection === undefined
      ? {}
      : { taskCollection: value.taskCollection as string }),
    ...(value.initialMessage === undefined
      ? {}
      : { initialMessage: value.initialMessage }),
  };
}

export function safeSourceUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 8192) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !!url.hostname &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

export function parsePluginAssistantResponse(
  value: unknown,
): PluginAssistantResponse | null {
  if (!isRecord(value) || safeJsonSize(value) > MAX_RESPONSE_SIZE) return null;
  // HTTP extension actions commonly wrap a provider payload in output.data.data.
  const nested =
    isRecord(value.data) && isRecord(value.data.data) ? value.data.data : value;
  if (
    !isRecord(nested) ||
    !Number.isSafeInteger(nested.revision) ||
    (nested.revision as number) < 0 ||
    !Array.isArray(nested.messages) ||
    nested.messages.length > MAX_MESSAGES
  )
    return null;
  if (
    nested.conversationId !== undefined &&
    (typeof nested.conversationId !== "string" ||
      nested.conversationId.length > 256)
  )
    return null;
  if (
    nested.pendingJobId !== undefined &&
    (typeof nested.pendingJobId !== "string" ||
      nested.pendingJobId.length > 256)
  )
    return null;
  if (
    nested.coverage !== undefined &&
    (!isRecord(nested.coverage) ||
      typeof nested.coverage.label !== "string" ||
      nested.coverage.label.length > 2_000 ||
      typeof nested.coverage.complete !== "boolean")
  )
    return null;
  if (nested.source !== undefined) {
    if (
      !isRecord(nested.source) ||
      !safeSourceUrl(nested.source.url) ||
      (nested.source.page !== undefined &&
        (!Number.isSafeInteger(nested.source.page) ||
          (nested.source.page as number) < 1))
    )
      return null;
  }
  if (nested.documentActions !== undefined) {
    if (
      !Array.isArray(nested.documentActions) ||
      nested.documentActions.length > 4
    )
      return null;
    const ids = new Set<string>();
    for (const action of nested.documentActions) {
      if (
        !isRecord(action) ||
        typeof action.id !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(action.id) ||
        typeof action.label !== "string" ||
        !action.label.trim() ||
        action.label.length > 100 ||
        action.format !== "docx" ||
        (action.fileName !== undefined &&
          (typeof action.fileName !== "string" ||
            !action.fileName.trim() ||
            action.fileName.length > 200 ||
            !action.fileName.endsWith(".docx") ||
            /[\\/]/.test(action.fileName))) ||
        ids.has(action.id)
      )
        return null;
      ids.add(action.id);
    }
  }
  if (
    nested.document !== undefined &&
    (!isRecord(nested.document) ||
      !safeSourceUrl(nested.document.url) ||
      typeof nested.document.fileName !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._ -]{0,180}\.docx$/.test(
        nested.document.fileName,
      ) ||
      nested.document.format !== "docx")
  )
    return null;
  const messages: PluginAssistantResponse["messages"] = [];
  for (const item of nested.messages) {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      item.id.length > 256 ||
      (item.role !== "user" && item.role !== "assistant") ||
      typeof item.text !== "string" ||
      item.text.length > MAX_MESSAGE_TEXT
    )
      return null;
    if (
      item.citations !== undefined &&
      (!Array.isArray(item.citations) || item.citations.length > MAX_CITATIONS)
    )
      return null;
    const citations: NonNullable<
      PluginAssistantResponse["messages"][number]["citations"]
    > = [];
    for (const citation of item.citations ?? []) {
      if (
        !isRecord(citation) ||
        typeof citation.id !== "string" ||
        citation.id.length > 256 ||
        typeof citation.label !== "string" ||
        citation.label.length > 2_000 ||
        typeof citation.excerpt !== "string" ||
        citation.excerpt.length > 20_000 ||
        (citation.canOpen !== undefined &&
          typeof citation.canOpen !== "boolean")
      )
        return null;
      citations.push({
        id: citation.id,
        label: citation.label,
        excerpt: citation.excerpt,
        ...(citation.canOpen === undefined
          ? {}
          : { canOpen: citation.canOpen as boolean }),
      });
    }
    if (item.stale !== undefined && typeof item.stale !== "boolean")
      return null;
    if (
      item.insufficientEvidence !== undefined &&
      typeof item.insufficientEvidence !== "boolean"
    )
      return null;
    const suggestions: PluginAssistantTaskSuggestion[] = [];
    if (item.taskSuggestions !== undefined) {
      if (
        !Array.isArray(item.taskSuggestions) ||
        item.taskSuggestions.length > 1000 ||
        item.role !== "assistant"
      )
        return null;
      const seen = new Set<string>();
      for (const suggestion of item.taskSuggestions) {
        if (
          !isRecord(suggestion) ||
          typeof suggestion.id !== "string" ||
          !suggestion.id ||
          suggestion.id.length > 256 ||
          seen.has(suggestion.id) ||
          typeof suggestion.title !== "string" ||
          !suggestion.title.trim() ||
          suggestion.title.length > 200 ||
          typeof suggestion.description !== "string" ||
          suggestion.description.length > 20_000 ||
          !Array.isArray(suggestion.citationIds) ||
          suggestion.citationIds.length > 1000 ||
          suggestion.citationIds.some(
            (id) =>
              typeof id !== "string" || !citations.some((c) => c.id === id),
          )
        )
          return null;
        seen.add(suggestion.id);
        suggestions.push({
          id: suggestion.id,
          title: suggestion.title,
          description: suggestion.description,
          citationIds: [...suggestion.citationIds] as string[],
        });
      }
    }
    messages.push({
      id: item.id,
      role: item.role,
      text: item.text,
      ...(citations.length ? { citations } : {}),
      ...(suggestions.length ? { taskSuggestions: suggestions } : {}),
      ...(item.stale === undefined ? {} : { stale: item.stale }),
      ...(item.insufficientEvidence === undefined
        ? {}
        : { insufficientEvidence: item.insufficientEvidence }),
    });
  }
  return {
    ...(nested.conversationId === undefined
      ? {}
      : { conversationId: nested.conversationId as string }),
    revision: nested.revision as number,
    ...(nested.source === undefined
      ? {}
      : { source: nested.source as PluginAssistantResponse["source"] }),
    ...(nested.documentActions === undefined
      ? {}
      : {
          documentActions: (
            nested.documentActions as NonNullable<
              PluginAssistantResponse["documentActions"]
            >
          ).map(({ id, label, format, fileName }) => ({
            id,
            label,
            format,
            ...(fileName ? { fileName } : {}),
          })),
        }),
    ...(nested.document === undefined
      ? {}
      : {
          document: {
            url: (nested.document as Record<string, unknown>).url as string,
            fileName: (nested.document as Record<string, unknown>)
              .fileName as string,
            format: "docx" as const,
          },
        }),
    messages,
    ...(nested.pendingJobId === undefined
      ? {}
      : { pendingJobId: nested.pendingJobId as string }),
    ...(nested.coverage === undefined
      ? {}
      : { coverage: nested.coverage as PluginAssistantResponse["coverage"] }),
  };
}

let current: PluginAssistantProvider | null = null;
const listeners = new Set<() => void>();

export function getPluginAssistantProvider(): PluginAssistantProvider | null {
  return current;
}
export function subscribePluginAssistantProvider(
  listener: () => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function openPluginAssistantProvider(
  provider: PluginAssistantProvider,
): void {
  if (current && current.sessionId !== provider.sessionId) current.close();
  current = provider;
  for (const listener of listeners) listener();
}
export function closePluginAssistantProvider(sessionId: string): void {
  if (current?.sessionId !== sessionId) return;
  current = null;
  for (const listener of listeners) listener();
}
