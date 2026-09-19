import { useQuery } from "@tanstack/react-query";
import type { AccessControlClient } from "@/api/access-control-client";
export function EffectivePermissions({
  client,
  scope,
  principalId,
  revision,
}: {
  client: AccessControlClient;
  scope: string;
  principalId: string;
  revision?: number;
}) {
  const policy = useQuery({
    queryKey: ["access-control", "effective", scope, principalId, revision],
    queryFn: () => client.getEffective(scope, principalId),
  });
  return (
    <section className="space-y-3 border-t pt-5">
      <h3 className="font-medium">Effective permissions</h3>
      <p className="max-w-prose text-sm text-muted-foreground">
        The server combines the user's protected role and custom roles. A field
        is available only when that rule's record condition matches.
      </p>
      {policy.isPending && (
        <p role="status" className="text-sm">
          Loading current permissions…
        </p>
      )}
      {policy.error && (
        <p role="alert" className="text-sm text-destructive">
          {policy.error.message}
        </p>
      )}
      {policy.data && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-2 pr-4">Resource</th>
                <th className="py-2 pr-4">Action</th>
                <th className="py-2 pr-4">Fields</th>
                <th className="py-2">Record scope</th>
              </tr>
            </thead>
            <tbody>
              {policy.data.grants.map((g) => (
                <tr key={g.id} className="border-b">
                  <td className="py-2 pr-4">{g.resource}</td>
                  <td className="py-2 pr-4">{g.action}</td>
                  <td className="py-2 pr-4">{g.fields.join(", ") || "None"}</td>
                  <td className="py-2">
                    {"all" in g.predicate
                      ? "All records"
                      : g.predicate.field === "$createdBy"
                        ? "Created by user"
                        : "Matching conditions"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {policy.data.grants.length === 0 && (
            <p className="py-4">This user has no grants in this workspace.</p>
          )}
        </div>
      )}
    </section>
  );
}
