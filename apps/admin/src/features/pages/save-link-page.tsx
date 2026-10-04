import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bookmark, LockKeyhole, LoaderCircle } from "lucide-react";
import type { AppServices } from "@/app-services";
import type { AuthSession } from "@/auth/auth-session";
import { ApiClientError } from "@/api/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useMessages } from "@/i18n/core";
import {
  clearSharedLink,
  readSharedLink,
  updateSharedLink,
  sharedLinkStorageAvailable,
  type SharedLinkDraft,
} from "@/pwa/share-target";
import { usePagesIndex } from "./use-pages-index";
import type { CaptureLinkInput } from "./client";
import { saveLinkMessages } from "./save-link-messages";

function validLink(value: string) {
  if (value.length > 8192) return false;
  try {
    const url = new URL(value);
    return (
      ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

export function SaveLinkPage({
  services,
}: {
  services: Pick<AppServices, "apiClient"> & {
    authSession: Pick<AuthSession, "getIdentity" | "login">;
  };
}) {
  const t = useMessages(saveLinkMessages);
  const navigate = useNavigate();
  const [draft, setDraft] = useState<SharedLinkDraft>(
    () =>
      readSharedLink() ?? {
        captureId: crypto.randomUUID(),
        title: "",
        url: "",
        note: "",
        receivedAt: Date.now(),
      },
  );
  const [parentId, setParentId] = useState(draft.parentId ?? "");
  const [account, setAccount] = useState<{
    id: string;
    label: string;
    workspace: string;
  } | null>(null);
  const [accountError, setAccountError] = useState(false);
  const [accountAttempt, setAccountAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(!!draft.attempt);
  const [rejected, setRejected] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [sessionChanged, setSessionChanged] = useState(false);
  const [online, setOnline] = useState(navigator.onLine !== false);
  const attempt = useRef<CaptureLinkInput | null>(draft.attempt?.input ?? null);
  const attemptedAccount = useRef(draft.attempt?.accountId);
  const saving = useRef(false);
  const active = useRef(true);
  const {
    client,
    pages,
    loading,
    error: foldersError,
    refresh,
  } = usePagesIndex(services.apiClient);
  const folders = pages.filter(
    (page) => page.kind === "folder" && page.role !== "reader",
  );

  useEffect(() => {
    let current = true;
    setAccount(null);
    setAccountError(false);
    void Promise.all([
      services.authSession.getIdentity(),
      services.apiClient.get<{ data: { name: string } }>("/v1/tenants/current"),
    ])
      .then(([identity, tenant]) => {
        if (
          current &&
          attemptedAccount.current &&
          attemptedAccount.current !== String(identity.id)
        ) {
          setSessionChanged(true);
          return;
        }
        if (current)
          setAccount({
            id: String(identity.id),
            label: String(identity.email || identity.fullName || identity.id),
            workspace: tenant.data.name,
          });
      })
      .catch(() => {
        if (current) setAccountError(true);
      });
    return () => {
      current = false;
    };
  }, [services.authSession, services.apiClient, accountAttempt]);

  useEffect(() => {
    active.current = true;
    const connectivity = () => setOnline(navigator.onLine !== false);
    const reset = () => {
      active.current = false;
      clearSharedLink();
      setDraft({
        captureId: crypto.randomUUID(),
        title: "",
        url: "",
        note: "",
        receivedAt: Date.now(),
      });
      setSessionChanged(true);
    };
    const sessionEnded = () => {
      active.current = false;
      setNeedsLogin(true);
      setBusy(false);
    };
    window.addEventListener("online", connectivity);
    window.addEventListener("offline", connectivity);
    window.addEventListener("savia:session-cleared", sessionEnded);
    window.addEventListener("savia:identity-changed", reset);
    return () => {
      active.current = false;
      window.removeEventListener("online", connectivity);
      window.removeEventListener("offline", connectivity);
      window.removeEventListener("savia:session-cleared", sessionEnded);
      window.removeEventListener("savia:identity-changed", reset);
    };
  }, []);

  function change(field: "title" | "url" | "note" | "parentId", value: string) {
    const next = { ...draft, [field]: value };
    setDraft(next);
    updateSharedLink(next);
  }

  async function save() {
    if (
      saving.current ||
      !account ||
      sessionChanged ||
      needsLogin ||
      !online ||
      !validLink(draft.url.trim())
    )
      return;
    saving.current = true;
    setBusy(true);
    setFailed(false);
    setRejected(false);
    try {
      const identity = await services.authSession.getIdentity();
      if (!active.current) return;
      if (String(identity.id) !== account.id) {
        clearSharedLink();
        setSessionChanged(true);
        return;
      }
      attempt.current ??= {
        captureId: draft.captureId,
        title: draft.title.trim() || new URL(draft.url).hostname.slice(0, 200),
        url: draft.url.trim(),
        note: draft.note,
        ...(parentId ? { parentId } : { folderTitle: t("saved") }),
      };
      const pending = {
        ...draft,
        attempt: { accountId: account.id, input: attempt.current },
      };
      setDraft(pending);
      updateSharedLink(pending);
      const page = await client.capture(attempt.current);
      if (!active.current) return;
      clearSharedLink();
      navigate(`/pages/${encodeURIComponent(page.id)}`, { replace: true });
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 401) {
        setNeedsLogin(true);
      } else if (active.current) {
        if (
          error instanceof ApiClientError &&
          [400, 403, 404, 409, 422].includes(error.status)
        ) {
          attempt.current = null;
          const editable = { ...draft, attempt: undefined };
          setDraft(editable);
          updateSharedLink(editable);
          setRejected(true);
        } else setFailed(true);
      }
    } finally {
      saving.current = false;
      if (active.current) setBusy(false);
    }
  }

  const locked = busy || !!attempt.current || sessionChanged || needsLogin;
  return (
    <main className="mx-auto w-full max-w-xl px-4 py-6 sm:px-6 sm:py-10">
      <div className="mb-6 space-y-2">
        <Bookmark className="mb-3 size-6 text-primary" aria-hidden="true" />
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("heading")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("intro")}</p>
        {account && (
          <p className="break-words text-sm">
            {t("account", {
              account: account.label,
              workspace: account.workspace,
            })}
          </p>
        )}
        {!account && !accountError && (
          <p role="status" className="text-sm text-muted-foreground">
            {t("loading")}
          </p>
        )}
      </div>
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="space-y-2">
          <label htmlFor="capture-url" className="text-sm font-medium">
            {t("url")}
          </label>
          <Input
            id="capture-url"
            className="min-h-11"
            type="url"
            inputMode="url"
            autoCapitalize="none"
            autoComplete="off"
            maxLength={8192}
            required
            value={draft.url}
            disabled={locked}
            onChange={(event) => change("url", event.target.value)}
            aria-describedby="capture-url-hint"
            aria-invalid={!!draft.url && !validLink(draft.url.trim())}
          />
          <p id="capture-url-hint" className="text-sm text-muted-foreground">
            {draft.url
              ? !validLink(draft.url.trim())
                ? t("invalid")
                : new URL(draft.url).hostname
              : t("empty")}
          </p>
        </div>
        <div className="space-y-2">
          <label htmlFor="capture-title" className="text-sm font-medium">
            {t("title")}
          </label>
          <Input
            id="capture-title"
            className="min-h-11"
            maxLength={200}
            value={draft.title}
            disabled={locked}
            onChange={(event) => change("title", event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="capture-note" className="text-sm font-medium">
            {t("note")}
          </label>
          <Textarea
            id="capture-note"
            className="min-h-24"
            maxLength={10000}
            value={draft.note}
            disabled={locked}
            onChange={(event) => change("note", event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="capture-folder" className="text-sm font-medium">
            {t("folder")}
          </label>
          <select
            id="capture-folder"
            className="border-input bg-background focus-visible:ring-ring flex min-h-11 w-full rounded-md border px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 disabled:opacity-50 sm:text-sm"
            value={parentId}
            disabled={locked || loading}
            onChange={(event) => {
              setParentId(event.target.value);
              change("parentId", event.target.value);
            }}
            aria-describedby="capture-privacy"
          >
            <option value="">{t("defaultFolder")}</option>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.title}
              </option>
            ))}
          </select>
          <p
            id="capture-privacy"
            className="flex items-start gap-2 text-sm text-muted-foreground"
          >
            <LockKeyhole
              className="mt-0.5 size-4 shrink-0"
              aria-hidden="true"
            />
            {t(parentId ? "inherited" : "privacy")}
          </p>
          {foldersError && (
            <div className="text-sm">
              <p>{t("foldersFailed")}</p>
              <Button
                type="button"
                variant="link"
                onClick={() => void refresh()}
              >
                {t("reload")}
              </Button>
            </div>
          )}
        </div>
        {!sharedLinkStorageAvailable() && (
          <p role="status" className="text-sm">
            {t("storage")}
          </p>
        )}
        {!online && (
          <p role="status" className="text-sm">
            {t("offline")}
          </p>
        )}
        {accountError && (
          <div role="alert" className="text-sm text-destructive">
            <p>{t("accountFailed")}</p>
            <Button
              type="button"
              variant="outline"
              onClick={() => setAccountAttempt((value) => value + 1)}
            >
              {t("reload")}
            </Button>
          </div>
        )}
        {sessionChanged && (
          <p role="alert" className="text-sm text-destructive">
            {t("sessionChanged")}
          </p>
        )}
        {failed && (
          <p role="alert" className="text-sm text-destructive">
            {t("failed")}
          </p>
        )}
        {rejected && (
          <p role="alert" className="text-sm text-destructive">
            {t("rejected")}
          </p>
        )}
        {needsLogin && (
          <div role="alert" className="space-y-2 text-sm">
            <p>{t("expired")}</p>
            <Button
              type="button"
              onClick={() => {
                updateSharedLink(draft);
                void services.authSession
                  .login()
                  .catch(() => setAccountError(true));
              }}
            >
              {t("signIn")}
            </Button>
          </div>
        )}
        <div className="flex flex-col gap-3 pt-2 sm:flex-row-reverse">
          <Button
            type="submit"
            className="min-h-11 sm:min-w-40"
            disabled={
              busy ||
              !account ||
              !online ||
              sessionChanged ||
              needsLogin ||
              !validLink(draft.url.trim())
            }
          >
            {busy && (
              <LoaderCircle
                className="size-4 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            )}
            {t(busy ? "saving" : failed ? "retry" : "save")}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={busy}
            onClick={() => {
              clearSharedLink();
              navigate("/pages", { replace: true });
            }}
          >
            {t("cancel")}
          </Button>
        </div>
      </form>
    </main>
  );
}
