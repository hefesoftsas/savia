import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { ActionBarButton } from "./action-bar";

function renderActionButton(tooltip: React.ReactNode, accessibleName?: string) {
  return renderToStaticMarkup(
    <TooltipProvider>
      <ActionBarButton
        onClick={() => {}}
        tooltip={tooltip}
        accessibleName={accessibleName}
      >
        <svg aria-hidden="true" />
      </ActionBarButton>
    </TooltipProvider>,
  );
}

describe("ActionBarButton accessible names", () => {
  it("uses a string tooltip as the accessible name for icon buttons", () => {
    const markup = renderActionButton("Fit to Screen");

    expect(markup).toContain('aria-label="Fit to Screen"');
  });

  it("uses the explicit accessible name when the tooltip contains rich content", () => {
    const markup = renderActionButton(
      <span>
        Execute Workflow <kbd>⌘ Enter</kbd>
      </span>,
      "Execute Workflow",
    );

    expect(markup).toContain('aria-label="Execute Workflow"');
  });
});
