import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ApiClient } from "@/api/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMessages, useAppLocale, intlLocale } from "@/i18n/core";
import type { RecordingScope } from "@/features/account/personal-api-keys-client";
import {
  TenantApiKeysClient,
  type TenantApiKey,
  type TenantApiKeyMember,
} from "./tenant-api-keys-client";
import { tenantApiKeyMessages } from "./messages";

type RevealedSecret = { context: object; value: string };

export function TenantApiKeysPanel({
  api,
  tenantId,
}: {
  api: ApiClient;
  tenantId: number;
}) {
  const client = useMemo(() => new TenantApiKeysClient(api), [api]);
  const [attempt, setAttempt] = useState(0);
  const context = useMemo(() => ({}), [client, tenantId, attempt]);
  const t = useMessages(tenantApiKeyMessages);
  const locale = useAppLocale();
  const [keys, setKeys] = useState<TenantApiKey[]>([]);
  const [members, setMembers] = useState<TenantApiKeyMember[]>([]);
  const [loadedContext, setLoadedContext] = useState<object | null>(null);
  const [member, setMember] = useState("");
  const [name, setName] = useState("");
  const [days, setDays] = useState(30);
  const [scopes, setScopes] = useState<RecordingScope[]>([
    "recordings:read",
    "recordings:upload",
  ]);
  const [secret, setSecret] = useState<RevealedSecret | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const inFlight = useRef<object | null>(null);
  const contextRef = useRef(context);
  contextRef.current = context;
  const id = useId();

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    setLoadedContext(null);
    setKeys([]);
    setMembers([]);
    setMember("");
    setName("");
    setSecret(null);
    setCopied(false);
    setBusy(false);
    void Promise.all([client.list(tenantId), client.members(tenantId)])
      .then(([list, roster]) => {
        if (!active) return;
        setKeys(list.keys);
        setMembers(roster.members);
        setMember(roster.members[0]?.id ?? "");
        setLoadedContext(context);
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, tenantId, context]);

  const visibleKeys = loadedContext === context ? keys : [];
  const visibleMembers = loadedContext === context ? members : [];
  const visibleSecret = secret?.context === context ? secret.value : "";
  const run = async (action: () => Promise<void>) => {
    if (inFlight.current === context) return;
    inFlight.current = context;
    setBusy(true);
    setError(false);
    try {
      await action();
    } catch {
      if (contextRef.current === context) setError(true);
    } finally {
      if (inFlight.current === context) {
        inFlight.current = null;
        if (contextRef.current === context) setBusy(false);
      }
    }
  };
  const date = (value: string) =>
    new Date(value).toLocaleString(intlLocale(locale));
  const labels: Record<RecordingScope, string> = {
    "recordings:read": t("Read"),
    "recordings:upload": t("Upload"),
    "recordings:process": t("Process"),
    "recordings:delete": t("Delete"),
  };

  return (
    <section className="grid min-w-0 gap-5" aria-label={t("Tenant API keys")}>
      <header className="grid gap-1">
        <h2 className="text-base font-semibold">{t("Tenant API keys")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("Manage Companion API keys for tenant members.")}
        </p>
      </header>
      {error ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 text-sm text-destructive"
        >
          <p>{t("Could not complete the operation.")}</p>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => setAttempt((value) => value + 1)}
          >
            {t("Retry")}
          </Button>
        </div>
      ) : null}
      {loading ? (
        <p role="status">{t("Loading")}</p>
      ) : loadedContext !== context ? null : (
        <>
          {visibleSecret ? (
            <section
              className="grid max-w-2xl gap-3 rounded-lg border p-4"
              aria-label={t("New key")}
            >
              <p className="text-sm">
                {t("Copy it into Companion. It will not be shown again.")}
              </p>
              <Label htmlFor={`${id}-secret`}>{t("New key")}</Label>
              <Input
                id={`${id}-secret`}
                readOnly
                value={visibleSecret}
                autoComplete="off"
                spellCheck={false}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    void navigator.clipboard.writeText(visibleSecret).then(
                      () => {
                        if (contextRef.current === context) setCopied(true);
                      },
                      () => {
                        if (contextRef.current === context) setError(true);
                      },
                    )
                  }
                >
                  {copied ? t("Copied") : t("Copy")}
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    setSecret(null);
                    setCopied(false);
                  }}
                >
                  {t("I saved the key")}
                </Button>
              </div>
            </section>
          ) : (
            <div className="grid max-w-2xl gap-4" aria-label={t("Create key")}>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor={`${id}-name`}>{t("Key name")}</Label>
                  <Input
                    id={`${id}-name`}
                    maxLength={80}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    autoComplete="off"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor={`${id}-member`}>{t("Member")}</Label>
                  <select
                    id={`${id}-member`}
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                    value={member}
                    onChange={(event) => setMember(event.target.value)}
                  >
                    <option value="">{t("Select a member")}</option>
                    {visibleMembers.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.displayName} ({user.email})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor={`${id}-expiry`}>{t("Expiry")}</Label>
                <select
                  id={`${id}-expiry`}
                  className="h-10 w-fit rounded-md border bg-background px-3 text-sm"
                  value={days}
                  onChange={(event) => setDays(Number(event.target.value))}
                >
                  {[7, 30, 90].map((value) => (
                    <option key={value} value={value}>
                      {value} {t("days")}
                    </option>
                  ))}
                </select>
              </div>
              <fieldset className="grid gap-3">
                <legend className="mb-1 text-sm font-medium">
                  {t("Permissions")}
                </legend>
                {(Object.keys(labels) as RecordingScope[]).map((scope) => (
                  <label
                    key={scope}
                    className="flex items-center gap-3 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={scopes.includes(scope)}
                      onChange={(event) =>
                        setScopes((current) =>
                          event.target.checked
                            ? [...current, scope]
                            : current.filter((value) => value !== scope),
                        )
                      }
                    />
                    {labels[scope]}
                  </label>
                ))}
              </fieldset>
              <div>
                <Button
                  type="button"
                  disabled={busy || !name.trim() || !member || !scopes.length}
                  onClick={() =>
                    void run(async () => {
                      const owner = visibleMembers.find(
                        (candidate) => candidate.id === member,
                      );
                      const created = await client.create(tenantId, {
                        principalId: member,
                        name: name.trim(),
                        scopes,
                        lifetimeDays: days,
                      });
                      if (contextRef.current !== context) return;
                      setSecret({ context, value: created.secret });
                      setCopied(false);
                      setKeys((current) => [
                        {
                          ...created.key,
                          principalId: member,
                          ownerName: owner?.displayName || owner?.email || "",
                          ownerEmail: owner?.email ?? "",
                        },
                        ...current,
                      ]);
                      setName("");
                    })
                  }
                >
                  {busy ? t("Loading") : t("Create key")}
                </Button>
              </div>
              {!visibleMembers.length ? (
                <p className="text-sm text-muted-foreground">
                  {t("No active members are available.")}
                </p>
              ) : null}
            </div>
          )}
          {!visibleKeys.length ? (
            <p className="text-sm text-muted-foreground">{t("No keys yet.")}</p>
          ) : (
            <ul className="divide-y">
              {visibleKeys.map((key) => {
                const revoked = Boolean(key.revokedAt);
                const expired = Date.parse(key.expiresAt) <= Date.now();
                const status = revoked
                  ? t("Revoked")
                  : expired
                    ? t("Expired")
                    : t("Active");
                return (
                  <li
                    key={key.id}
                    className="flex flex-wrap items-start justify-between gap-3 py-4"
                  >
                    <div className="min-w-0 space-y-1">
                      <h3 className="break-words font-medium">{key.name}</h3>
                      <p className="break-all text-sm text-muted-foreground">
                        {key.prefix}
                      </p>
                      <p className="break-all text-sm">
                        {t("Owner")}: {key.ownerName} ({key.ownerEmail})
                      </p>
                      <p className="text-sm">
                        {key.scopes.map((scope) => labels[scope]).join(" · ")}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {t("Created")}: {date(key.createdAt)} · {t("Expiry")}:{" "}
                        {date(key.expiresAt)} · {t("Last used")}:{" "}
                        {key.lastUsedAt ? date(key.lastUsedAt) : t("Never")}
                      </p>
                      <p className="text-sm">{status}</p>
                    </div>
                    {!revoked ? (
                      <Button
                        type="button"
                        variant="outline"
                        disabled={busy}
                        aria-label={`${t("Revoke")} ${key.name}`}
                        onClick={() => {
                          if (
                            !window.confirm(
                              t("Revoke key confirmation", {
                                owner: key.ownerName,
                              }),
                            )
                          )
                            return;
                          void run(async () => {
                            await client.revoke(tenantId, key.id);
                            if (contextRef.current !== context) return;
                            setKeys((current) =>
                              current.map((value) =>
                                value.id === key.id
                                  ? {
                                      ...value,
                                      revokedAt: new Date().toISOString(),
                                    }
                                  : value,
                              ),
                            );
                          });
                        }}
                      >
                        {t("Revoke")}
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
