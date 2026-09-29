import { useMessages } from "@/i18n/core";
import { accessMessages } from "@/i18n/locales/access";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { AccessCatalog, AccessRole } from "@/api/access-control-client";

export type VisibleAccessRole = AccessRole & {
  source?: "system" | "custom";
  assignedUsers?: { id: string; displayName: string; email: string | null }[];
};
export function roleDisplayLabel(
  role: AccessRole,
  t: (key: keyof typeof accessMessages) => string,
) {
  const names: Record<string, keyof typeof accessMessages> = {
    platform_admin: "Platform administrator",
    tenant_admin: "Tenant administrator",
    agency_admin: "Tenant administrator",
    tenant_member: "Tenant member",
    agency_user: "Tenant member",
  };
  return role.protected && names[role.legacy_role ?? role.name]
    ? t(names[role.legacy_role ?? role.name])
    : role.label;
}
export function SystemRoleDetails({
  role,
  catalog = [],
}: {
  role: VisibleAccessRole;
  catalog?: AccessCatalog;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const resources = [...new Set(role.grants.map((grant) => grant.resource))];
  const t = useMessages(accessMessages);
  return (
    <section className="space-y-5">
      <header className="space-y-2">
        <span className="text-xs font-medium text-muted-foreground">
          {t("System role · Read only")}
        </span>
        <h2 className="text-lg font-semibold">{roleDisplayLabel(role, t)}</h2>
        <p className="text-sm text-muted-foreground">
          {role.legacy_role === "platform_admin" ||
          role.name === "platform_admin"
            ? t(
                "This access comes from the user's platform administrator assignment, not from a role created in this tenant. It grants administration across the platform.",
              )
            : t(
                "This access comes from the user's membership in this tenant. It is managed through membership, not through custom role assignments.",
              )}
        </p>
      </header>
      <details className="border-y py-3">
        <summary className="cursor-pointer font-medium focus-visible:outline-ring">
          {t("Assigned users")} ({role.assignedUsers?.length ?? 0})
        </summary>
        {role.assignedUsers?.length ? (
          <ul className="divide-y">
            {role.assignedUsers.map((user) => (
              <li key={user.id} className="py-2 text-sm">
                <strong className="block">{user.displayName}</strong>
                <span className="break-all text-muted-foreground">
                  {user.email ?? user.id}
                </span>
                {role.assignedUsers!.some(
                  (other) =>
                    other.id !== user.id &&
                    other.email === user.email &&
                    other.displayName === user.displayName,
                ) && (
                  <span className="block break-all text-xs text-muted-foreground">
                    {t("ID")}: {user.id}
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("No assigned users.")}
          </p>
        )}
      </details>
      <section className="space-y-2">
        <h3 className="font-medium">{t("Permissions")}</h3>
        <p className="text-sm text-muted-foreground">
          {t(
            "Permissions below reflect the resources currently available in this tenant.",
          )}
        </p>
        {role.grants.length ? (
          <div>
            <div className="flex flex-wrap gap-2 pb-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setExpanded(new Set(resources))}
              >
                {t("Expand all")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setExpanded(new Set())}
              >
                {t("Collapse all")}
              </Button>
            </div>
            <div className="divide-y border-y">
              {resources.map((resource) => {
                const grants = role.grants.filter(
                  (grant) => grant.resource === resource,
                );
                const label =
                  catalog.find((entry) => entry.resource === resource)?.label ??
                  resource.split(":").slice(1).join(":").replaceAll("_", " ");
                const kind = resource.startsWith("collection:")
                  ? t("Data")
                  : resource.startsWith("page:")
                    ? t("Page")
                    : t("Resource");
                return (
                  <details
                    key={resource}
                    open={expanded.has(resource)}
                    onToggle={(event) => {
                      const open = event.currentTarget.open;
                      setExpanded((current) => {
                        if (current.has(resource) === open) return current;
                        const next = new Set(current);
                        if (open) next.add(resource);
                        else next.delete(resource);
                        return next;
                      });
                    }}
                  >
                    <summary className="cursor-pointer py-3 text-sm focus-visible:outline-ring">
                      <span className="font-medium">{label}</span>
                      <span className="ml-2 text-muted-foreground">
                        {kind} · {grants.length} {t("actions")}
                      </span>
                    </summary>
                    <dl className="divide-y pb-3 text-sm">
                      {grants.map((grant) => (
                        <div
                          key={grant.id}
                          className="grid gap-1 py-2 sm:grid-cols-[8rem_1fr]"
                        >
                          <dt className="font-medium">
                            {Object.hasOwn(accessMessages, grant.action)
                              ? t(grant.action as keyof typeof accessMessages)
                              : grant.action}
                          </dt>
                          <dd className="min-w-0 space-y-1 break-words text-muted-foreground">
                            <p>
                              {"all" in grant.predicate
                                ? t("All records")
                                : t("Matching conditions")}
                            </p>
                            {grant.fields.length > 0 && (
                              <p>
                                {t("Fields")}: {grant.fields.join(", ")}
                              </p>
                            )}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                );
              })}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t(
              "No resource-specific permissions to list yet. The system role remains assigned.",
            )}
          </p>
        )}
      </section>
    </section>
  );
}
