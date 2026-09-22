import { useMessages } from "@/i18n/core";
import { accessMessages } from "@/i18n/locales/access";
import { useEffect, useMemo, useState, lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Plus, ShieldCheck } from "lucide-react";
import { createAccessControlClient } from "@/api/access-control-client";
import type { AppServices } from "@/app-services";
import { RoleEditor } from "./role-editor";
import { AssignmentEditor } from "./assignment-editor";
const AuditBrowser = lazy(() => import("./audit-browser"));
export function RolePages({ services }: { services: AppServices }) {
  const t = useMessages(accessMessages);
  const client = useMemo(
    () => createAccessControlClient(services.apiClient),
    [services.apiClient],
  );
  const [scope, setScope] = useState(""),
    [selected, setSelected] = useState<string>(),
    [message, setMessage] = useState("");
  const scopes = useQuery({
    queryKey: ["access-control", "scopes"],
    queryFn: async () =>
      (
        await services.apiClient.get<{
          data: Array<{ id: string; label: string; kind: string }>;
        }>("/v1/data-domains")
      ).data,
  });
  useEffect(() => {
    if (!scope && scopes.data?.length) {
      const d = scopes.data[0];
      setScope(d.kind === "custom" ? "domain:" + d.id : d.id);
    }
  }, [scopes.data, scope]);
  const roles = useQuery({
    queryKey: ["access-control", "roles", scope],
    enabled: Boolean(scope),
    queryFn: () => client.listRoles(scope),
  });
  const catalog = useQuery({
    queryKey: ["access-control", "catalog", scope],
    enabled: Boolean(scope),
    queryFn: () => client.getCatalog(scope),
  });
  const error = scopes.error ?? roles.error ?? catalog.error;
  const refresh = async () => {
    await roles.refetch();
    await services.queryClient.invalidateQueries({
      queryKey: ["access-control", "effective"],
    });
  };
  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">
            {t("Roles and permissions")}
          </h1>
          <p className="mt-2 max-w-prose text-sm text-muted-foreground">
            {t(
              "Manage access within a workspace. Changes apply to the next authorized server operation.",
            )}
          </p>
        </div>
        <label className="grid gap-2 text-sm">
          {t("Workspace")}
          <select
            className="h-10 min-w-48 rounded-md border bg-background px-3"
            value={scope}
            onChange={(e) => {
              setScope(e.target.value);
              setSelected(undefined);
              setMessage("");
            }}
          >
            {scopes.data?.map((d) => (
              <option
                key={d.id}
                value={d.kind === "custom" ? "domain:" + d.id : d.id}
              >
                {d.label}
              </option>
            ))}
          </select>
        </label>
      </header>
      {error && (
        <div role="alert" className="space-y-2 text-sm text-destructive">
          <p>{error.message}</p>
          <Button
            variant="outline"
            onClick={() => {
              void scopes.refetch();
              void roles.refetch();
              void catalog.refetch();
            }}
          >
            {t("Reload permissions")}
          </Button>
        </div>
      )}
      {message && (
        <p role="status" className="text-sm">
          {Object.hasOwn(accessMessages, message)
            ? t(message as keyof typeof accessMessages)
            : message}
        </p>
      )}
      {!error && (!roles.data || !catalog.data) && (
        <p role="status">{t("Loading permissions…")}</p>
      )}
      {roles.data && catalog.data && !error && (
        <Tabs defaultValue="roles" key={scope}>
          <TabsList>
            <TabsTrigger value="roles">{t("Roles")}</TabsTrigger>
            <TabsTrigger value="members">{t("Members")}</TabsTrigger>
            <TabsTrigger value="audit">{t("Audit")}</TabsTrigger>
          </TabsList>
          <TabsContent value="roles" className="mt-5">
            <section className="grid overflow-hidden rounded-xl border bg-card shadow-xs lg:grid-cols-[15rem_minmax(0,1fr)]">
              <nav
                aria-label={t("Roles")}
                className="border-b bg-muted/20 lg:border-b-0 lg:border-r"
              >
                <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <h2 className="text-sm font-semibold">{t("Roles")}</h2>
                    <span className="inline-flex min-w-6 items-center justify-center rounded-full border bg-background px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground">
                      {roles.data.roles.length}
                    </span>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      setSelected("new");
                      setMessage("");
                    }}
                  >
                    <Plus aria-hidden="true" />
                    {t("Create role")}
                  </Button>
                </div>
                {roles.data.roles.length > 0 ? (
                  <ul className="space-y-1 p-2">
                    {roles.data.roles.map((r) => (
                      <li key={r.id}>
                        <button
                          type="button"
                          aria-current={selected === r.id ? "true" : undefined}
                          className="block w-full rounded-md px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[current=true]:bg-background aria-[current=true]:font-medium aria-[current=true]:shadow-xs"
                          onClick={() => {
                            setSelected(r.id);
                            setMessage("");
                          }}
                        >
                          <span className="block truncate font-medium">
                            {r.label}
                          </span>
                          {(r.protected || !r.enabled) && (
                            <span className="mt-1 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                              {r.protected && (
                                <span>{t("Protected role")}</span>
                              )}
                              {!r.enabled && <span>{t("Disabled")}</span>}
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="px-4 py-5 text-sm leading-6 text-muted-foreground">
                    {t("No roles have been created in this workspace yet.")}
                  </p>
                )}
              </nav>
              <div className="min-w-0 bg-background p-5 sm:p-6">
                {selected ? (
                  <RoleEditor
                    key={scope + ":" + selected}
                    scope={scope}
                    revision={roles.data.revision}
                    role={roles.data.roles.find((r) => r.id === selected)}
                    catalog={catalog.data}
                    onDelete={async (id, revision) => {
                      await client.deleteRole(scope, id, revision);
                      await refresh();
                      setSelected(undefined);
                      setMessage("Role deleted.");
                    }}
                    onSave={async (input, id) => {
                      const saved = await client.saveRole(input, id);
                      await refresh();
                      setSelected(undefined);
                      setMessage(
                        "Role saved. Select it to review its current permissions.",
                      );
                      return saved;
                    }}
                  />
                ) : (
                  <div className="flex min-h-48 flex-col items-center justify-center px-6 py-8 text-center sm:min-h-64 sm:py-10">
                    <div className="mb-4 flex size-12 items-center justify-center rounded-xl border bg-muted/30 text-muted-foreground">
                      <ShieldCheck aria-hidden="true" className="size-5" />
                    </div>
                    <p className="max-w-md text-sm leading-6 text-muted-foreground">
                      {t(
                        "Select a role to inspect its permissions, or create a role with no initial access.",
                      )}
                    </p>
                  </div>
                )}
              </div>
            </section>
          </TabsContent>
          <TabsContent value="members" className="mt-6">
            <AssignmentEditor
              client={client}
              scope={scope}
              roles={roles.data.roles}
              onSaved={() => {
                void refresh();
              }}
            />
          </TabsContent>
          <TabsContent value="audit" className="mt-6">
            <Suspense fallback={<p role="status">{t("Loading history…")}</p>}>
              <AuditBrowser client={client} scope={scope} />
            </Suspense>
          </TabsContent>
        </Tabs>
      )}
    </main>
  );
}
