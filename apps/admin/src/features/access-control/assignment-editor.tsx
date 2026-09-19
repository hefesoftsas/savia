import { EffectivePermissions } from "./effective-permissions";
import { useEffect, useState } from "react";
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
  }, [scope, client]);
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
  }, [scope, principal, client]);
  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Members</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Assign several roles to the same user. Their existing tenant
          membership and protected role remain in place.
        </p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      <label className="grid max-w-md gap-2 text-sm">
        User
        <select
          className="h-10 rounded-md border bg-background px-3"
          value={principal}
          onChange={(e) => setPrincipal(e.target.value)}
        >
          <option value="">Select a user</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName} — {m.email}
            </option>
          ))}
        </select>
      </label>
      {principal && (
        <fieldset
          disabled={!online || busy || revision === undefined}
          className="space-y-4"
        >
          <legend className="mb-3 text-sm font-medium">Custom roles</legend>
          {roles
            .filter((r) => !r.protected)
            .map((r) => (
              <label key={r.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  disabled={!r.enabled && !selection.includes(r.id)}
                  checked={selection.includes(r.id)}
                  onChange={(e) =>
                    setSelection(
                      e.target.checked
                        ? [...selection, r.id]
                        : selection.filter((id) => id !== r.id),
                    )
                  }
                />
                {r.label}
                {!r.enabled && " (disabled)"}
              </label>
            ))}
          <Button
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
                setRevision(result.revision);
                setMessage("Roles saved.");
                onSaved();
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : "Unable to assign roles",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Saving…" : "Save assignments"}
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
