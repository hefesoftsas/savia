import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { NativeRun } from "@/services/native-workflow-service";
import { NativeRunDetails } from "./native-run-details";

const makeRun = (overrides: Partial<NativeRun> = {}): NativeRun => ({
  id: "run-1",
  status: "completed",
  version_id: "version-1",
  node_id: null,
  created_at: "2026-10-12T10:00:00.000Z",
  ...overrides,
});

describe("NativeRunDetails", () => {
  it("renders completed job output in an expandable, escaped text block", () => {
    const html = renderToStaticMarkup(
      <NativeRunDetails
        run={makeRun({
          jobs: [
            {
              node_id: "step_2",
              type: "transform",
              attempts: 2,
              output: { note: "<script>alert('x')</script>" },
            },
          ],
        })}
        busy={false}
        onCancel={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(html).toContain("<details>");
    expect(html).toContain("step_2 · transform · 2 attempts");
    expect(html).toContain("&quot;note&quot;: &quot;&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("offers retry for blocked runs and disables the action while busy", () => {
    const html = renderToStaticMarkup(
      <NativeRunDetails
        run={makeRun({ status: "blocked" })}
        busy
        onCancel={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(html).toContain("Retry failed step");
    expect(html).toContain("disabled");
  });

  it("disables cancellation while another run action is busy", () => {
    const html = renderToStaticMarkup(
      <NativeRunDetails
        run={makeRun({ status: "running" })}
        busy
        onCancel={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(html).toContain("Cancel run");
    expect(html).toContain("disabled");
  });
});
