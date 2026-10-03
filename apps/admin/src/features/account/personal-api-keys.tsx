import { useEffect, useMemo, useRef, useState } from "react";
import type { ApiClient } from "@/api/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMessages, useAppLocale, intlLocale } from "@/i18n/core";
import { personalApiKeyMessages } from "@/i18n/locales/personal-api-keys";
import {
  PersonalApiKeysClient,
  type PersonalKey,
  type RecordingScope,
} from "./personal-api-keys-client";
// Extend account settings with the existing neutral surfaces and explicit form labels.
export function PersonalApiKeysPanel({ api }: { api: ApiClient }) {
  const client = useMemo(() => new PersonalApiKeysClient(api), [api]);
  const t = useMessages(personalApiKeyMessages),
    locale = useAppLocale();
  const [keys, setKeys] = useState<PersonalKey[]>([]),
    [tenants, setTenants] = useState<{ id: number; name: string }[]>([]);
  const [tenant, setTenant] = useState(""),
    [name, setName] = useState(""),
    [days, setDays] = useState(30);
  const [scopes, setScopes] = useState<RecordingScope[]>([
    "recordings:read",
    "recordings:upload",
  ]);
  const [secret, setSecret] = useState(""),
    [copied, setCopied] = useState(false),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(false);
  const inFlight = useRef(false);
  const load = async () => {
    setLoading(true);
    setError(false);
    try {
      const [list, eligible] = await Promise.all([
        client.list(),
        client.tenants(),
      ]);
      setKeys(list.keys);
      setTenants(eligible.tenants);
      setTenant((v) =>
        eligible.tenants.some((w) => String(w.id) === v)
          ? v
          : String(eligible.tenants[0]?.id ?? ""),
      );
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [client]);
  const run = async (action: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(false);
    try {
      await action();
    } catch {
      setError(true);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const date = (s: string) => new Date(s).toLocaleString(intlLocale(locale));
  const labels = {
    "recordings:read": t("Read"),
    "recordings:upload": t("Upload"),
    "recordings:process": t("Process"),
    "recordings:delete": t("Delete"),
  };
  return (
    <section className="space-y-6 py-4" aria-label={t("API keys")}>
      <header>
        <h2 className="text-xl font-semibold">{t("API keys")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("Connect your apps with limited access.")}
        </p>
      </header>
      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 text-sm text-destructive"
        >
          <p>{t("Could not complete the operation.")}</p>
          <Button variant="outline" disabled={busy} onClick={() => void load()}>
            {t("Retry")}
          </Button>
        </div>
      )}
      {loading ? (
        <p role="status">{t("Loading")}</p>
      ) : (
        <>
          {secret ? (
            <section
              className="space-y-3 rounded-lg border p-4"
              aria-label={t("New key")}
            >
              <p>{t("Copy it into Companion. It will not be shown again.")}</p>
              <Label htmlFor="personal-key-secret">{t("New key")}</Label>
              <Input
                id="personal-key-secret"
                readOnly
                value={secret}
                autoComplete="off"
                spellCheck={false}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() =>
                    void navigator.clipboard.writeText(secret).then(
                      () => setCopied(true),
                      () => setError(true),
                    )
                  }
                >
                  {copied ? t("Copied") : t("Copy")}
                </Button>
                <Button
                  onClick={() => {
                    setSecret("");
                    setCopied(false);
                  }}
                >
                  {t("I saved the key")}
                </Button>
              </div>
            </section>
          ) : (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  const created = await client.create({
                    name: name.trim(),
                    tenantId: Number(tenant),
                    scopes,
                    lifetimeDays: days,
                  });
                  setSecret(created.secret);
                  setCopied(false);
                  setKeys((v) => [created.key, ...v]);
                  setName("");
                });
              }}
            >
              <fieldset
                disabled={busy || tenants.length === 0}
                className="space-y-4"
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="personal-key-name">{t("Key name")}</Label>
                    <Input
                      id="personal-key-name"
                      required
                      maxLength={80}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      autoComplete="off"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="personal-key-tenant">{t("Tenant")}</Label>
                    <select
                      id="personal-key-tenant"
                      className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                      value={tenant}
                      onChange={(e) => setTenant(e.target.value)}
                      required
                    >
                      {tenants.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="personal-key-expiry">{t("Expiry")}</Label>
                  <select
                    id="personal-key-expiry"
                    className="h-10 rounded-md border bg-background px-3 text-sm"
                    value={days}
                    onChange={(e) => setDays(Number(e.target.value))}
                  >
                    {[7, 30, 90].map((d) => (
                      <option key={d} value={d}>
                        {d} {t("days")}
                      </option>
                    ))}
                  </select>
                </div>
                <fieldset className="grid gap-3">
                  <legend className="mb-3 text-sm font-medium">
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
                        onChange={(e) =>
                          setScopes((v) =>
                            e.target.checked
                              ? [...v, scope]
                              : v.filter((s) => s !== scope),
                          )
                        }
                      />
                      {labels[scope]}
                    </label>
                  ))}
                </fieldset>
                <Button
                  type="submit"
                  disabled={
                    busy || !name.trim() || !scopes.length || tenant === ""
                  }
                >
                  {busy ? t("Loading") : t("Create key")}
                </Button>
              </fieldset>
              {!tenants.length && <p>{t("No eligible workspace.")}</p>}
            </form>
          )}
          <p className="max-w-prose text-sm text-muted-foreground">
            {t(
              "Keys only access your recordings in the selected workspace. Legacy recordings remain available on the web.",
            )}
          </p>
          {!keys.length ? (
            <p>{t("No keys yet.")}</p>
          ) : (
            <ul className="divide-y">
              {keys.map((key) => (
                <li
                  key={key.id}
                  className="flex flex-wrap items-start justify-between gap-3 py-4"
                >
                  <div className="min-w-0 space-y-1">
                    <h3 className="break-words font-medium">{key.name}</h3>
                    <p className="text-sm text-muted-foreground">
                      {tenants.find((w) => w.id === key.tenantId)?.name ??
                        key.tenantId}{" "}
                      · {key.prefix}
                    </p>
                    <p className="text-sm">
                      {key.scopes.map((s) => labels[s]).join(" · ")}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {t("Expiry")}: {date(key.expiresAt)} · {t("Last used")}:{" "}
                      {key.lastUsedAt ? date(key.lastUsedAt) : t("Never")}
                    </p>
                  </div>
                  {key.revokedAt ? (
                    <span className="text-sm">{t("Revoked")}</span>
                  ) : (
                    <div className="flex items-center gap-2">
                      {Date.parse(key.expiresAt) <= Date.now() && (
                        <span className="text-sm">{t("Expired")}</span>
                      )}
                      <Button
                        variant="outline"
                        disabled={busy}
                        aria-label={`${t("Revoke")} ${key.name}`}
                        onClick={() =>
                          void run(async () => {
                            await client.revoke(key.id);
                            setKeys((await client.list()).keys);
                          })
                        }
                      >
                        {t("Revoke")}
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
