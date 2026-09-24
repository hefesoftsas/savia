import { useMessages } from "@/i18n/core";
import { accessMessages } from "@/i18n/locales/access";
import { accessPredicateSchema } from "@savia/studio-shared/access-control";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useOnlineStatus } from "@/offline/use-online-status";
import type {
  AccessRole,
  AccessCatalog,
  RoleInput,
} from "@/api/access-control-client";
import { GrantEditor } from "./grant-editor";
export function RoleEditor({
  scope,
  revision,
  role,
  catalog,
  onSave,
  onDelete,
}: {
  scope: string;
  revision: number;
  role?: AccessRole;
  catalog: AccessCatalog;
  onDelete?: (id: string, revision: number) => Promise<void>;
  onSave: (input: RoleInput, id?: string) => Promise<unknown>;
}) {
  const t = useMessages(accessMessages);
  const [draft, setDraft] = useState<RoleInput>({
    scope,
    expectedRevision: revision,
    name: role?.name ?? "",
    label: role?.label ?? "",
    description: role?.description ?? "",
    enabled: role?.enabled ?? true,
    grants:
      role?.grants.map(({ resource, action, predicate, fields }) => ({
        resource,
        action,
        predicate,
        fields,
      })) ?? [],
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const online = useOnlineStatus();
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <form
      className="space-y-6"
      onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        if (
          draft.grants.some(
            (g) => !accessPredicateSchema.safeParse(g.predicate).success,
          )
        ) {
          setError("Complete every record condition before saving.");
          return;
        }
        setBusy(true);
        try {
          await onSave(draft, role?.id);
        } catch (e) {
          setError(e instanceof Error ? e.message : t("Unable to save role"));
        } finally {
          setBusy(false);
        }
      }}
    >
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {Object.hasOwn(accessMessages, error)
            ? t(error as keyof typeof accessMessages)
            : error}
        </p>
      )}
      {role?.protected && (
        <p className="text-sm text-muted-foreground">
          {t(
            "This built-in role is protected. Create a custom role to grant additional access.",
          )}
        </p>
      )}
      <fieldset
        disabled={busy || role?.protected || !online}
        className="space-y-6"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="role-name">{t("Role name")}</Label>
            <Input
              id="role-name"
              required
              pattern="[a-z][a-z0-9_-]{0,63}"
              title={t(
                "Start with a lowercase letter; use lowercase letters, numbers, underscores or hyphens.",
              )}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="role-label">{t("Display name")}</Label>
            <Input
              id="role-label"
              required
              value={draft.label}
              onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="role-description">{t("Description")}</Label>
          <Input
            id="role-description"
            value={draft.description}
            onChange={(e) =>
              setDraft({ ...draft, description: e.target.value })
            }
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
          />
          {t("Role enabled")}
        </label>
        <div>
          <h2 className="text-lg font-semibold">
            {t("Pages and data permissions")}
          </h2>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            {t(
              "Roles add access. Each rule grants its fields only on records that match its conditions. New actions start with no allowed fields.",
            )}
          </p>
          {catalog.length === 0 && (
            <p className="mt-4 text-sm text-muted-foreground">
              {t("No collections are available in this scope.")}
            </p>
          )}
          {catalog.map((entry) => (
            <GrantEditor
              key={entry.resource}
              entry={entry}
              grants={draft.grants.filter((g) => g.resource === entry.resource)}
              onChange={(grants) =>
                setDraft({
                  ...draft,
                  grants: [
                    ...draft.grants.filter(
                      (g) => g.resource !== entry.resource,
                    ),
                    ...grants,
                  ],
                })
              }
            />
          ))}
        </div>
        {!role?.protected && (
          <Button type="submit">{busy ? t("Saving…") : t("Save role")}</Button>
        )}
      </fieldset>
      {role && !role.protected && onDelete && (
        <div className="space-y-2 border-t pt-4">
          {confirmDelete && (
            <p className="text-sm">
              {t(
                "Deleting this role removes its assignments. The user's other roles remain in effect.",
              )}
            </p>
          )}
          <Button
            type="button"
            variant="destructive"
            disabled={busy || !online}
            onClick={async () => {
              if (!confirmDelete) {
                setConfirmDelete(true);
                return;
              }
              setBusy(true);
              try {
                await onDelete(role.id, draft.expectedRevision);
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : t("Unable to delete role"),
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmDelete ? t("Confirm delete role") : t("Delete role")}
          </Button>
          {confirmDelete && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirmDelete(false)}
            >
              {t("Cancel deletion")}
            </Button>
          )}
        </div>
      )}
      {!online && (
        <p role="status" className="text-sm text-muted-foreground">
          {t("Connect to the internet to change permissions.")}
        </p>
      )}
    </form>
  );
}
