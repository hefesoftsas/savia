import type { FlowCostUsage } from "@savia/flows-types";
import useSWR from "swr";
import { useAuth } from "./auth-context";
import { Button } from "./ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "./ui/card";
import { makeOrgRequest } from "@/services/utils";

export function FlowCostUsageCard() {
  const { organization } = useAuth();
  const id = organization?.id;
  const { data, error, isLoading, mutate } = useSWR<FlowCostUsage>(
    id ? `/${id}/usage/limits` : null,
    id ? () => makeOrgRequest<FlowCostUsage>(id, "/usage/limits", "") : null,
    { refreshInterval: 60_000, refreshWhenHidden: false },
  );
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Execution budget</CardTitle>
        <CardDescription>
          Usage and alerts for the current UTC day and month. Quotas are shared
          across Savia Flows.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <p role="status">Loading execution usage…</p>
        ) : error ? (
          <div role="alert" className="space-y-2">
            <p>Execution usage is unavailable.</p>
            <Button variant="outline" size="sm" onClick={() => void mutate()}>
              Retry
            </Button>
          </div>
        ) : data ? (
          <>
            <p className="text-sm">
              {data.executionsEnabled
                ? "Executions enabled"
                : "Executions paused"}
              {!data.quotasEnabled ? " · Quota tracking is disabled" : ""}
            </p>
            {data.quotasEnabled ? (
              <>
                <dl className="grid gap-4 sm:grid-cols-3">
                  <Metric
                    label="Your runs this month"
                    value={data.organization.monthlyRuns.toLocaleString()}
                  />
                  <Metric
                    label="Steps in those runs"
                    value={data.organization.monthlySteps.toLocaleString()}
                  />
                  <Metric
                    label="Active runs across Flows"
                    value={`${data.shared.activeRuns.toLocaleString()} / ${data.limits.concurrentRuns?.toLocaleString() ?? "—"}`}
                  />
                </dl>
                <dl className="grid gap-4 sm:grid-cols-2">
                  <Metric
                    label="Shared daily quota"
                    value={`${data.shared.dailyRuns.toLocaleString()} / ${data.limits.dailyRuns?.toLocaleString() ?? "—"}`}
                  />
                  <Metric
                    label="Shared monthly quota"
                    value={`${data.shared.monthlyRuns.toLocaleString()} / ${data.limits.monthlyRuns?.toLocaleString() ?? "—"}`}
                  />
                </dl>
                {data.alerts.map((alert) => (
                  <p
                    key={alert.period}
                    role="alert"
                    className="rounded-md border border-border bg-muted p-3 text-sm"
                  >
                    {alert.period === "day" ? "Daily" : "Monthly"} quota{" "}
                    {alert.level === "exhausted"
                      ? "exhausted"
                      : "nearly exhausted"}
                    : {alert.percentage}%.{" "}
                    {alert.level === "exhausted"
                      ? "New runs cannot start until the quota resets."
                      : "Review frequent triggers and batch collection changes."}
                  </p>
                ))}
              </>
            ) : null}
            <p className="text-xs text-muted-foreground">
              These are operational limits, not a Cloudflare invoice or a
              guaranteed spending cap. CPU, storage and other Savia services
              also affect billing.
            </p>
          </>
        ) : (
          <p>No execution usage available.</p>
        )}
      </CardContent>
    </Card>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-lg font-semibold tabular-nums">
        {value}
      </dd>
    </div>
  );
}
