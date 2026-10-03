import { useEffect, useRef, useState } from "react";
import { ApiClientError, type ApiClient } from "@/api/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMessages } from "@/i18n/core";
import { officeSuiteMessages } from "./messages";

type Member = { principalId: string; displayName: string; email: string };
type Share = { principalId: string; role: "reader" | "editor" };
type Shares = { version: number; shares: (Share & Member)[] };

export function OfficeSharePanel({
  apiClient,
  documentId,
  onDone,
}: {
  apiClient: ApiClient;
  documentId: string;
  onDone(): void;
}) {
  const t = useMessages(officeSuiteMessages);
  const [query, setQuery] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [knownMembers, setKnownMembers] = useState<Member[]>([]);
  const [shares, setShares] = useState<Share[]>([]);
  const [version, setVersion] = useState<number>();
  const [membersLoaded, setMembersLoaded] = useState(false);
  const [membersLoading, setMembersLoading] = useState(true);
  const [membersError, setMembersError] = useState(false);
  const [sharesLoading, setSharesLoading] = useState(true);
  const [sharesError, setSharesError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [reload, setReload] = useState(0);
  const [membersReload, setMembersReload] = useState(0);
  const active = useRef(true);
  const savingRef = useRef(false);
  const base = `/v1/office-documents/${encodeURIComponent(documentId)}/shares`;

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    setSharesLoading(true);
    setSharesError(false);
    setVersion(undefined);
    void apiClient
      .get<{ data: Shares }>(base)
      .then(({ data }) => {
        if (cancelled) return;
        if (
          !data ||
          !Number.isInteger(data.version) ||
          !Array.isArray(data.shares)
        )
          throw new Error("Invalid shares response");
        setVersion(data.version);
        setShares(
          data.shares.map(({ principalId, role }) => ({ principalId, role })),
        );
        setKnownMembers(data.shares);
        setConflict(false);
        setSaveError("");
      })
      .catch(() => {
        if (!cancelled) setSharesError(true);
      })
      .finally(() => {
        if (!cancelled) setSharesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient, base, reload]);
  useEffect(() => {
    let cancelled = false;
    setMembersLoading(true);
    setMembersError(false);
    const timer = window.setTimeout(
      () => {
        void apiClient
          .get<{ data: Member[] }>(
            `/v1/office-documents/members?${new URLSearchParams({ q: query })}`,
          )
          .then(({ data }) => {
            if (cancelled) return;
            if (!Array.isArray(data))
              throw new Error("Invalid members response");
            setMembers(data);
            setKnownMembers((previous) => [
              ...previous.filter(
                (member) =>
                  !data.some((item) => item.principalId === member.principalId),
              ),
              ...data,
            ]);
            setMembersLoaded(true);
          })
          .catch(() => {
            if (!cancelled) setMembersError(true);
          })
          .finally(() => {
            if (!cancelled) setMembersLoading(false);
          });
      },
      query ? 200 : 0,
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [apiClient, query, reload, membersReload]);

  const displayed = [
    ...members,
    ...knownMembers.filter(
      (member) =>
        shares.some((share) => share.principalId === member.principalId) &&
        !members.some((item) => item.principalId === member.principalId),
    ),
  ];
  const disabled =
    saving ||
    sharesLoading ||
    version === undefined ||
    !membersLoaded ||
    conflict;
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (disabled || savingRef.current) return;
        savingRef.current = true;
        setSaving(true);
        setSaveError("");
        void apiClient
          .put<{ data: Shares }>(base, { version, shares })
          .then(() => {
            if (active.current) onDone();
          })
          .catch((error) => {
            if (!active.current) return;
            if (error instanceof ApiClientError && error.status === 409) {
              setConflict(true);
              setSaveError(
                t("Permissions changed. Reload them before saving again."),
              );
            } else setSaveError(t("Could not save permissions. Try again."));
          })
          .finally(() => {
            savingRef.current = false;
            if (active.current) setSaving(false);
          });
      }}
    >
      <p className="text-sm text-muted-foreground">
        {t("Only active members of this workspace can receive access.")}
      </p>
      <Input
        aria-label={t("Search workspace members")}
        placeholder={t("Search workspace members")}
        value={query}
        disabled={saving}
        onChange={(event) => setQuery(event.target.value)}
      />
      {membersLoading || sharesLoading ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t("Loading permissions…")}
        </p>
      ) : null}
      {membersError || sharesError ? (
        <div role="alert" className="space-y-2">
          <p className="text-sm text-destructive">
            {t("Could not load sharing. Try again.")}
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={() => {
              if (sharesError) setReload((value) => value + 1);
              else setMembersReload((value) => value + 1);
            }}
          >
            {t("Retry")}
          </Button>
        </div>
      ) : null}
      {!sharesLoading && version !== undefined ? (
        <div className="max-h-72 space-y-3 overflow-y-auto">
          {displayed.map((member) => (
            <label
              key={member.principalId}
              className="flex min-w-0 items-center justify-between gap-3 text-sm"
            >
              <span className="min-w-0 break-words">
                <span className="block font-medium">
                  {member.displayName || member.email}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {member.email}
                </span>
              </span>
              <select
                aria-label={`${t("Permission for")} ${member.displayName || member.email}`}
                className="h-10 shrink-0 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                disabled={saving || conflict}
                value={
                  shares.find(
                    (share) => share.principalId === member.principalId,
                  )?.role ?? "none"
                }
                onChange={(event) => {
                  const role = event.target.value;
                  setShares((current) => [
                    ...current.filter(
                      (share) => share.principalId !== member.principalId,
                    ),
                    ...(role === "none"
                      ? []
                      : [
                          {
                            principalId: member.principalId,
                            role: role as Share["role"],
                          },
                        ]),
                  ]);
                }}
              >
                <option value="none">{t("No access")}</option>
                <option value="reader">{t("Can view")}</option>
                <option value="editor">{t("Can edit")}</option>
              </select>
            </label>
          ))}
          {!membersLoading && !membersError && !displayed.length ? (
            <p className="text-sm text-muted-foreground">
              {t("No matching workspace members.")}
            </p>
          ) : null}
        </div>
      ) : null}
      {saveError ? (
        <p role="alert" className="text-sm text-destructive">
          {saveError}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        {conflict ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => setReload((value) => value + 1)}
          >
            {t("Reload permissions")}
          </Button>
        ) : null}
        <Button type="submit" disabled={disabled}>
          {t(saving ? "Saving permissions…" : "Save permissions")}
        </Button>
      </div>
    </form>
  );
}
