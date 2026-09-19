import { render, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import {
  ThesvgLookupIcon,
  thesvgIconLoaderCount,
} from "@/features/crm-engine/thesvg-lookup-icon";

it("loads a brand icon from the @thesvg catalog", async () => {
  expect(thesvgIconLoaderCount).toBeGreaterThan(1000);
  const { container } = render(
    <ThesvgLookupIcon name="hubspot" className="brand-icon" />,
  );
  await waitFor(() => {
    expect(container.querySelector("svg.brand-icon")).toBeTruthy();
  });
});
