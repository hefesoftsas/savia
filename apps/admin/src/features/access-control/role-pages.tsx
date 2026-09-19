import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { createAccessControlClient } from "@/api/access-control-client";
import type { AppServices } from "@/app-services";
import { RoleEditor } from "./role-editor";
import { AssignmentEditor } from "./assignment-editor";
export function RolePages({ services }: { services: AppServices }) {
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
          <h1 className="text-2xl font-semibold">Roles and permissions</h1>
          <p className="mt-2 max-w-prose text-sm text-muted-foreground">
            Manage access within a workspace. Changes apply to the next
            authorized server operation.
          </p>
        </div>
        <label className="grid gap-2 text-sm">
          Workspace
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
            Reload permissions
          </Button>
        </div>
      )}
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      {!error && (!roles.data || !catalog.data) && (
        <p role="status">Loading permissions…</p>
      )}
      {roles.data && catalog.data && !error && (
        <Tabs defaultValue="roles" key={scope}>
          <TabsList>
            <TabsTrigger value="roles">Roles</TabsTrigger>
            <TabsTrigger value="members">Members</TabsTrigger>
          </TabsList>
          <TabsContent
            value="roles"
            className="mt-6 grid gap-6 md:grid-cols-[14rem_minmax(0,1fr)]"
          >
            <nav aria-label="Roles" className="space-y-2">
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  setSelected("new");
                  setMessage("");
                }}
              >
                Create role
              </Button>
              {roles.data.roles.map((r) => (
                <button
                  type="button"
                  aria-current={selected === r.id ? "true" : undefined}
                  key={r.id}
                  className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted aria-[current=true]:bg-muted"
                  onClick={() => {
                    setSelected(r.id);
                    setMessage("");
                  }}
                >
                  <span className="block font-medium">{r.label}</span>
                  {r.protected && (
                    <span className="text-xs text-muted-foreground">
                      Protected role
                    </span>
                  )}
                  {!r.enabled && (
                    <span className="text-xs text-muted-foreground">
                      Disabled
                    </span>
                  )}
                </button>
              ))}
            </nav>
            <div>
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
                <p className="py-8 text-sm text-muted-foreground">
                  Select a role to inspect its permissions, or create a role
                  with no initial access.
                </p>
              )}
            </div>
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
        </Tabs>
      )}
    </main>
  );
}
