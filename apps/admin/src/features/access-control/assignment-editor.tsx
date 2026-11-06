import {
  useRealtimeRefresh,
  RemoteChangesNotice,
} from "@/realtime/use-realtime-refresh";
import { roleDisplayLabel, type VisibleAccessRole } from "./system-role";
import { useMessages } from "@/i18n/core";
import { accessMessages } from "@/i18n/locales/access";
import { EffectivePermissions } from "./effective-permissions";
import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOnlineStatus } from "@/offline/use-online-status";
import type {
  AccessControlClient,
  AccessRole,
} from "@/api/access-control-client";
export function AssignmentEditor({
  client,
  scope,
  roles,
  onSaved,
}: {
  client: AccessControlClient;
  scope: string;
  roles: AccessRole[];
  onSaved: () => void;
}) {
  const t = useMessages(accessMessages);
  const [members, setMembers] = useState<
      Awaited<ReturnType<AccessControlClient["getMembers"]>>
    >([]),
    [principal, setPrincipal] = useState("");
  const [selection, setSelection] = useState<string[]>([]),
    [revision, setRevision] = useState<number>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const online = useOnlineStatus();
  const [dirty, setDirty] = useState(false);
  const [remoteVersion, setRemoteVersion] = useState(0);
  const remote = useRealtimeRefresh({
    topics: ["access-control"],
    tenantId: Number(scope.slice(7)),
    blocked: dirty || busy,
    refresh: () => {
      setDirty(false);
      setRemoteVersion((value) => value + 1);
    },
  });
  useEffect(() => {
    let active = true;
    client
      .getMembers(scope)
      .then((m) => {
        if (active) setMembers(m);
      })
      .catch((e) => {
        if (active) setError(String(e.message));
      });
    return () => {
      active = false;
    };
  }, [scope, client, remoteVersion]);
  useEffect(() => {
    let active = true;
    setRevision(undefined);
    setSelection([]);
    setMessage("");
    if (principal)
      client
        .getAssignments(scope, principal)
        .then((a) => {
          if (active) {
            setSelection(a.roleIds);
            setRevision(a.revision);
          }
        })
        .catch((e) => {
          if (active) setError(String(e.message));
        });
    return () => {
      active = false;
    };
  }, [scope, principal, client, remoteVersion]);
  return (
    <section className="space-y-5">
      <RemoteChangesNotice {...remote} />
      <div>
        <h2 className="text-lg font-semibold">{t("Members")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(
            "Assign several roles to the same user. Their existing tenant membership and protected role remain in place.",
          )}
        </p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {Object.hasOwn(accessMessages, error)
            ? t(error as keyof typeof accessMessages)
            : error}
        </p>
      )}
      {message && (
        <p role="status" className="text-sm">
          {Object.hasOwn(accessMessages, message)
            ? t(message as keyof typeof accessMessages)
            : message}
        </p>
      )}
      <label className="grid max-w-md gap-2 text-sm">
        {t("User")}
        <select
          className="h-10 rounded-md border bg-background px-3"
          value={principal}
          onChange={(e) => {
            setDirty(false);
            setPrincipal(e.target.value);
          }}
        >
          <option value="">{t("Select a user")}</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName} — {m.email}
            </option>
          ))}
        </select>
      </label>
      {principal && (
        <section className="space-y-2">
          <h3 className="text-sm font-medium">{t("System roles")}</h3>
          {(roles as VisibleAccessRole[])
            .filter(
              (role) =>
                role.protected &&
                role.assignedUsers?.some((user) => user.id === principal),
            )
            .map((role) => (
              <p key={role.id} className="text-sm">
                {roleDisplayLabel(role, t)}{" "}
                <span className="text-muted-foreground">
                  · {t("Read only")}
                </span>
              </p>
            ))}
          <p className="text-sm text-muted-foreground">
            {t(
              "System roles are inherited from identity or tenant membership. Custom assignments below do not remove that access.",
            )}
          </p>
        </section>
      )}
      {principal && (
        <fieldset
          disabled={!online || busy || revision === undefined}
          className="space-y-4"
        >
          <legend className="mb-3 text-sm font-medium">
            {t("Custom roles")}
          </legend>
          {roles
            .filter((r) => !r.protected)
            .map((r) => (
              <label key={r.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  disabled={!r.enabled && !selection.includes(r.id)}
                  checked={selection.includes(r.id)}
                  onChange={(e) => {
                    setDirty(true);
                    setSelection(
                      e.target.checked
                        ? [...selection, r.id]
                        : selection.filter((id) => id !== r.id),
                    );
                  }}
                />
                {r.label}
                {!r.enabled && t(" (disabled)")}
              </label>
            ))}
          <Button
            className="max-sm:size-11 max-sm:p-0 max-sm:has-[>svg]:px-0"
            onClick={async () => {
              if (revision === undefined) return;
              setBusy(true);
              setError("");
              try {
                const result = await client.replaceAssignments({
                  scope,
                  principalId: principal,
                  roleIds: selection,
                  expectedRevision: revision,
                });
                setDirty(false);
                setRevision(result.revision);
                setMessage("Roles saved.");
                onSaved();
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : t("Unable to assign roles"),
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <Save aria-hidden="true" />
            <span className="sr-only sm:not-sr-only">
              {busy ? t("Saving…") : t("Save assignments")}
            </span>
          </Button>
        </fieldset>
      )}
      {principal && (
        <EffectivePermissions
          client={client}
          scope={scope}
          principalId={principal}
          revision={revision}
        />
      )}
    </section>
  );
}
