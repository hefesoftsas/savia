import { Button } from "@/components/ui/button";
import type { NativeRun } from "@/services/native-workflow-service";

export function formatNativeRunOutput(output: unknown): string {
  if (output === undefined) return "No output recorded";
  if (typeof output === "string") return output;
  try {
    return JSON.stringify(output, null, 2) ?? String(output);
  } catch {
    return String(output);
  }
}

export function NativeRunDetails({
  run,
  busy,
  onCancel,
  onRetry,
}: {
  run: NativeRun;
  busy: boolean;
  onCancel: () => void;
  onRetry: () => void;
}) {
  const canCancel = ["queued", "running", "waiting"].includes(run.status);
  const canRetry = run.status === "failed" || run.status === "blocked";

  return (
    <section className="native-run-detail" aria-label="Run details">
      <strong>{run.status}</strong>
      {run.error ? <p>{run.error}</p> : null}
      {run.deliveries?.map((attempt) => (
        <p
          key={`${attempt.node_id}-${attempt.sequence}`}
          className="wf-delivery"
        >
          {attempt.node_id} · attempt {attempt.sequence} ·{" "}
          {attempt.status ?? attempt.error ?? "pending"}
        </p>
      ))}
      {run.jobs?.length ? (
        <div className="native-run-jobs" aria-label="Completed step details">
          {run.jobs.map((job, index) => (
            <details key={`${job.node_id}-${job.type}-${index}`}>
              <summary>
                {job.node_id} · {job.type} · {job.attempts} attempts
              </summary>
              <pre>{formatNativeRunOutput(job.output)}</pre>
            </details>
          ))}
        </div>
      ) : null}
      <div className="native-run-actions">
        {canCancel ? (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel run
          </Button>
        ) : null}
        {canRetry ? (
          <Button size="sm" disabled={busy} onClick={onRetry}>
            Retry failed step
          </Button>
        ) : null}
      </div>
    </section>
  );
}
