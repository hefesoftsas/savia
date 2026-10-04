import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ApiClient } from "@/api/api-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { KeyRound, Plus, Copy, Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMessages, useAppLocale, intlLocale } from "@/i18n/core";
import type { ApiKeyScope } from "@/features/account/personal-api-keys-client";
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
  const [scopes, setScopes] = useState<ApiKeyScope[]>([
    "recordings:read",
    "recordings:upload",
  ]);
  const [secret, setSecret] = useState<RevealedSecret | null>(null);
  const [copied, setCopied] = useState(false);
  const [creating, setCreating] = useState(false);
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
    setCreating(false);
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
  const recordingLabels: Record<
    Extract<ApiKeyScope, `recordings:${string}`>,
    string
  > = {
    "recordings:read": t("Read"),
    "recordings:upload": t("Upload"),
    "recordings:process": t("Process"),
    "recordings:delete": t("Delete"),
  };

  const recordingDescriptions: Record<
    Extract<ApiKeyScope, `recordings:${string}`>,
    string
  > = {
    "recordings:read": t("Read recordings"),
    "recordings:upload": t("Upload recordings"),
    "recordings:process": t("Process recordings"),
    "recordings:delete": t("Delete recordings"),
  };
  const recordLabels: Record<
    Extract<ApiKeyScope, `records:${string}`>,
    string
  > = {
    "records:read": t("Read records"),
    "records:create": t("Create records"),
    "records:update": t("Update records"),
  };
  const recordDescriptions: Record<
    Extract<ApiKeyScope, `records:${string}`>,
    string
  > = {
    "records:read": t("Read records description"),
    "records:create": t("Create records description"),
    "records:update": t("Update records description"),
  };
  const scopeLabels: Record<ApiKeyScope, string> = {
    ...recordingLabels,
    ...recordLabels,
  };
  const toggleScope = (scope: ApiKeyScope, checked: boolean) =>
    setScopes((current) =>
      checked
        ? current.includes(scope)
          ? current
          : [...current, scope]
        : current.filter((value) => value !== scope),
    );

  return (
    <section className="grid min-w-0 gap-6" aria-label={t("Tenant API keys")}>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-2">
          <h2 className="text-lg font-semibold">{t("Tenant API keys")}</h2>
          <p className="max-w-prose text-sm text-muted-foreground">
            {t("Manage API keys for tenant member integrations.")}
          </p>
        </div>
        {!loading &&
        loadedContext === context &&
        !creating &&
        !visibleSecret ? (
          <Button
            type="button"
            disabled={busy || !visibleMembers.length}
            onClick={() => setCreating(true)}
          >
            <Plus aria-hidden="true" />
            {t("New key")}
          </Button>
        ) : null}
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
              className="grid gap-4 border-y bg-muted/30 p-5 sm:p-6"
              aria-label={t("New key")}
            >
              <h3 className="font-semibold">{t("New key")}</h3>
              <p className="text-sm text-muted-foreground">
                {t("Copy the key into your app or integration")}
              </p>
              <Label htmlFor={`${id}-secret`}>{t("New key")}</Label>
              <Input
                id={`${id}-secret`}
                readOnly
                value={visibleSecret}
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
                onFocus={(event) => event.target.select()}
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
                  {copied ? (
                    <Check aria-hidden="true" />
                  ) : (
                    <Copy aria-hidden="true" />
                  )}
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
          ) : creating ? (
            <section
              className="grid gap-5 border-y bg-muted/30 p-5 sm:p-6"
              aria-label={t("Create key")}
            >
              <h3 className="font-semibold">{t("Create key")}</h3>
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
                    className="h-11 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
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
                  className="h-11 w-full max-w-xs rounded-md border bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
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
              <fieldset className="grid gap-4">
                <legend className="mb-1 text-sm font-medium">
                  {t("Permissions")}
                </legend>
                <fieldset className="grid gap-2">
                  <legend className="mb-1 text-sm font-medium">
                    {t("Companion recordings")}
                  </legend>
                  <p className="text-sm text-muted-foreground">
                    {t("Select permissions for this key.")}
                  </p>
                  {(
                    Object.keys(recordingLabels) as Array<
                      keyof typeof recordingLabels
                    >
                  ).map((scope) => (
                    <label
                      key={scope}
                      className="flex min-h-14 cursor-pointer items-start gap-3 rounded-md p-2 text-sm hover:bg-muted has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring"
                    >
                      <input
                        type="checkbox"
                        className="mt-1 size-4 shrink-0 accent-primary"
                        checked={scopes.includes(scope)}
                        onChange={(event) =>
                          toggleScope(scope, event.target.checked)
                        }
                      />
                      <span className="grid gap-1">
                        <span className="font-medium">
                          {recordingLabels[scope]}
                        </span>
                        <span className="text-xs leading-relaxed text-muted-foreground">
                          {recordingDescriptions[scope]}
                        </span>
                      </span>
                    </label>
                  ))}
                </fieldset>
                <fieldset className="grid gap-2 border-t pt-3">
                  <legend className="mb-1 text-sm font-medium">
                    {t("Savia collection data")}
                  </legend>
                  <p className="text-sm text-muted-foreground">
                    {t("Collection data description")}
                  </p>
                  {(
                    Object.keys(recordLabels) as Array<
                      keyof typeof recordLabels
                    >
                  ).map((scope) => (
                    <label
                      key={scope}
                      className="flex min-h-14 cursor-pointer items-start gap-3 rounded-md p-2 text-sm hover:bg-muted has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring"
                    >
                      <input
                        type="checkbox"
                        className="mt-1 size-4 shrink-0 accent-primary"
                        checked={scopes.includes(scope)}
                        onChange={(event) =>
                          toggleScope(scope, event.target.checked)
                        }
                      />
                      <span className="grid gap-1">
                        <span className="font-medium">
                          {recordLabels[scope]}
                        </span>
                        <span className="text-xs leading-relaxed text-muted-foreground">
                          {recordDescriptions[scope]}
                        </span>
                      </span>
                    </label>
                  ))}
                </fieldset>
                <p className="text-sm text-muted-foreground">
                  {t("Key owner access explanation")}
                </p>
              </fieldset>
              <div className="flex flex-wrap gap-3 border-t pt-4">
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
                      setCreating(false);
                    })
                  }
                >
                  {busy ? t("Loading") : t("Create key")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setCreating(false);
                    setName("");
                  }}
                >
                  {t("Cancel")}
                </Button>
              </div>
              {!visibleMembers.length ? (
                <p className="text-sm text-muted-foreground">
                  {t("No active members are available.")}
                </p>
              ) : null}
            </section>
          ) : null}
          {!visibleMembers.length && !creating && !visibleSecret ? (
            <p className="text-sm text-muted-foreground">
              {t("No active members are available.")}
            </p>
          ) : null}
          {!visibleKeys.length ? (
            <div className="grid justify-items-center gap-2 border-y py-12 text-center">
              <KeyRound
                className="mb-2 size-6 text-muted-foreground"
                aria-hidden="true"
              />
              <h3 className="font-medium">{t("No keys yet.")}</h3>
              <p className="max-w-prose text-sm text-muted-foreground">
                {t("Create your first tenant integration key.")}
              </p>
            </div>
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
                    className="flex flex-wrap items-start justify-between gap-4 py-5 sm:flex-nowrap"
                  >
                    <div className="grid min-w-0 flex-1 gap-4 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,0.8fr)]">
                      <div className="min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="break-words font-medium">
                            {key.name}
                          </h3>
                          <Badge
                            variant={
                              revoked || expired ? "outline" : "secondary"
                            }
                          >
                            {status}
                          </Badge>
                        </div>
                        <p className="break-all font-mono text-xs text-muted-foreground">
                          {key.prefix}
                        </p>
                      </div>
                      <div className="min-w-0 space-y-1">
                        <p className="text-xs text-muted-foreground">
                          {t("Owner")}
                        </p>
                        <p className="break-words text-sm font-medium">
                          {key.ownerName}
                        </p>
                        <p className="break-all text-xs text-muted-foreground">
                          {key.ownerEmail}
                        </p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">
                          {t("Expiry")}
                        </p>
                        <p className="text-sm tabular-nums">
                          {date(key.expiresAt)}
                        </p>
                      </div>
                      <details className="sm:col-span-3">
                        <summary className="w-fit cursor-pointer rounded-sm py-2 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
                          {t("Key details")}
                        </summary>
                        <dl className="grid gap-3 py-3 text-sm sm:grid-cols-3">
                          <div>
                            <dt className="mb-1 text-xs text-muted-foreground">
                              {t("Permissions")}
                            </dt>
                            <dd>
                              {key.scopes
                                .map((scope) => scopeLabels[scope])
                                .join(" · ")}
                            </dd>
                          </div>
                          <div>
                            <dt className="mb-1 text-xs text-muted-foreground">
                              {t("Created")}
                            </dt>
                            <dd className="tabular-nums">
                              {date(key.createdAt)}
                            </dd>
                          </div>
                          <div>
                            <dt className="mb-1 text-xs text-muted-foreground">
                              {t("Last used")}
                            </dt>
                            <dd className="tabular-nums">
                              {key.lastUsedAt
                                ? date(key.lastUsedAt)
                                : t("Never")}
                            </dd>
                          </div>
                        </dl>
                      </details>
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
