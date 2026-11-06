export type SharedLinkDraft = {
  captureId: string;
  title: string;
  url: string;
  note: string;
  receivedAt: number;
  parentId?: string;
  attempt?: SharedLinkAttempt;
};

export type SharedLinkCaptureInput = {
  captureId: string;
  title: string;
  url: string;
  note?: string;
  parentId?: string;
  folderTitle?: string;
};

export type SharedLinkAttempt = {
  accountId: string;
  input: SharedLinkCaptureInput;
};

const STORAGE_KEY = "savia.shared-link.v1";
const DRAFT_LIFETIME_MS = 60 * 60 * 1000;
const MAX_TITLE_LENGTH = 200;
const MAX_URL_LENGTH = 8192;
const MAX_NOTE_LENGTH = 10000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let memoryDraft: SharedLinkDraft | null = null;
let storageAvailable = true;

function safeHttpUrl(value: string): string | null {
  if (!value || value.length > MAX_URL_LENGTH) return null;
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      !url.hostname ||
      url.username ||
      url.password
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}

function extractUrl(text: string): { url: string; note: string } | null {
  const entireUrl = safeHttpUrl(text.trim());
  if (entireUrl && !/\s/.test(text.trim())) return { url: entireUrl, note: "" };
  const candidatePattern = /https?:\/\/[^\s<>"']+/gi;
  for (const match of text.matchAll(candidatePattern)) {
    let raw = (match[0] ?? "").replace(/[.,;!?]+$/g, "");
    // A closing parenthesis may belong to the URL (for example Wikipedia).
    // Remove only unmatched prose delimiters around a link.
    for (const [open, close] of [
      ["(", ")"],
      ["[", "]"],
      ["{", "}"],
    ]) {
      while (
        raw.endsWith(close) &&
        raw.split(close).length > raw.split(open).length
      )
        raw = raw.slice(0, -1);
    }
    const url = safeHttpUrl(raw);
    if (!url) continue;
    const start = match.index ?? -1;
    const note =
      start >= 0
        ? `${text.slice(0, start)} ${text.slice(start + match[0].length)}`
            .replace(/\s+/g, " ")
            .trim()
        : text;
    return { url, note };
  }
  return null;
}

function parseSharedDraft(search: string, now: number): SharedLinkDraft | null {
  const params = new URLSearchParams(search);
  const title = (params.get("title") ?? "").trim().slice(0, MAX_TITLE_LENGTH);
  const text = (params.get("text") ?? "").slice(0, MAX_NOTE_LENGTH);
  const paramUrl = safeHttpUrl((params.get("url") ?? "").trim());
  const extracted = extractUrl(text);
  const url = paramUrl ?? extracted?.url;
  if (!url) return null;

  let note = text;
  if (extracted && extracted.url === url) note = extracted.note;
  note = note.slice(0, MAX_NOTE_LENGTH);

  return {
    captureId: crypto.randomUUID(),
    title,
    url,
    note,
    receivedAt: now,
  };
}

function hasOnlyKeys(value: object, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isValidCaptureInput(
  value: unknown,
  captureId: string,
): value is SharedLinkCaptureInput {
  if (!value || typeof value !== "object") return false;
  const input = value as Partial<SharedLinkCaptureInput>;
  if (
    !hasOnlyKeys(value, [
      "captureId",
      "title",
      "url",
      "note",
      "parentId",
      "folderTitle",
    ]) ||
    input.captureId !== captureId ||
    typeof input.title !== "string" ||
    input.title.trim().length === 0 ||
    input.title.length > MAX_TITLE_LENGTH ||
    typeof input.url !== "string" ||
    safeHttpUrl(input.url) === null ||
    (input.note !== undefined &&
      (typeof input.note !== "string" ||
        input.note.length > MAX_NOTE_LENGTH)) ||
    (input.parentId !== undefined &&
      (typeof input.parentId !== "string" || input.parentId.length > 128)) ||
    (input.folderTitle !== undefined &&
      (typeof input.folderTitle !== "string" ||
        input.folderTitle.length > MAX_TITLE_LENGTH))
  )
    return false;
  return true;
}

function isValidAttempt(
  value: unknown,
  captureId: string,
): value is SharedLinkAttempt {
  if (!value || typeof value !== "object") return false;
  const attempt = value as Partial<SharedLinkAttempt>;
  return (
    hasOnlyKeys(value, ["accountId", "input"]) &&
    typeof attempt.accountId === "string" &&
    attempt.accountId.length > 0 &&
    attempt.accountId.length <= 256 &&
    isValidCaptureInput(attempt.input, captureId)
  );
}

function isValidDraft(value: unknown, now: number): value is SharedLinkDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<SharedLinkDraft>;
  return (
    hasOnlyKeys(value, [
      "captureId",
      "title",
      "url",
      "note",
      "receivedAt",
      "parentId",
      "attempt",
    ]) &&
    typeof draft.captureId === "string" &&
    UUID_PATTERN.test(draft.captureId) &&
    typeof draft.title === "string" &&
    draft.title.length <= MAX_TITLE_LENGTH &&
    typeof draft.url === "string" &&
    draft.url.length <= MAX_URL_LENGTH &&
    typeof draft.note === "string" &&
    draft.note.length <= MAX_NOTE_LENGTH &&
    (draft.parentId === undefined ||
      (typeof draft.parentId === "string" && draft.parentId.length <= 128)) &&
    (draft.attempt === undefined ||
      isValidAttempt(draft.attempt, draft.captureId)) &&
    typeof draft.receivedAt === "number" &&
    Number.isFinite(draft.receivedAt) &&
    draft.receivedAt <= now &&
    now - draft.receivedAt < DRAFT_LIFETIME_MS
  );
}

function browserSessionStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    storageAvailable = false;
    return null;
  }
}

export function updateSharedLink(draft: SharedLinkDraft): void {
  memoryDraft = draft;
  const storage = browserSessionStorage();
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(draft));
    storageAvailable = true;
  } catch {
    storageAvailable = false;
  }
}

export function readSharedLink(): SharedLinkDraft | null {
  const now = Date.now();
  const storage = browserSessionStorage();
  if (storage) {
    try {
      const raw = storage.getItem(STORAGE_KEY);
      storageAvailable = true;
      if (raw === null)
        return memoryDraft && isValidDraft(memoryDraft, now)
          ? memoryDraft
          : null;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        storage.removeItem(STORAGE_KEY);
        memoryDraft = null;
        return null;
      }
      if (isValidDraft(parsed, now)) {
        memoryDraft = parsed;
        storageAvailable = true;
        return parsed;
      }
      storage.removeItem(STORAGE_KEY);
      memoryDraft = null;
      return null;
    } catch {
      storageAvailable = false;
      return memoryDraft && isValidDraft(memoryDraft, now) ? memoryDraft : null;
    }
  }
  return memoryDraft && isValidDraft(memoryDraft, now) ? memoryDraft : null;
}

export function clearSharedLink(): void {
  memoryDraft = null;
  const storage = browserSessionStorage();
  if (!storage) return;
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    storageAvailable = false;
  }
}

export function sharedLinkStorageAvailable(): boolean {
  return storageAvailable;
}

export function sharedLinkRouteAfterAuth(): string | null {
  return readSharedLink() ? "#/save-link" : null;
}

export function receiveSharedLink(): void {
  const current = new URL(window.location.href);
  if (current.pathname !== "/") return;

  if (current.searchParams.get("resume-share") === "1") {
    const hash = readSharedLink() ? "#/save-link" : "#/my-day";
    window.history.replaceState({}, "", `${current.pathname}${hash}`);
    return;
  }
  if (current.searchParams.get("share-target") !== "1") return;

  const draft = parseSharedDraft(current.search, Date.now());
  if (draft) updateSharedLink(draft);
  else clearSharedLink();
  window.history.replaceState({}, "", `${current.pathname}#/save-link`);
}
