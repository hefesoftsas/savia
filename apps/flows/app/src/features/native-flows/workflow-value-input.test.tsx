import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { WorkflowValue } from "@savia/studio-shared/workflows";
import { ValueInput } from "./workflow-editor";

describe("ValueInput label associations", () => {
  it.each<WorkflowValue>([
    "Text",
    false,
    null,
    { concat: ["Prefix", { ref: "trigger.title" }] },
    { dateOffset: { value: "2026-10-12", days: 1 } },
  ])("associates every label with an existing control for %j", (value) => {
    const html = renderToStaticMarkup(
      <ValueInput
        label="Output value"
        value={value}
        variables={["trigger.title"]}
        onChange={vi.fn()}
      />,
    );
    const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
    const targets = [...html.matchAll(/\bfor="([^"]+)"/g)].map((m) => m[1]);
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) expect(ids.has(target)).toBe(true);
  });
});
