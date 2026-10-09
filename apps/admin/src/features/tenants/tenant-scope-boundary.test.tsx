import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TenantScopeBoundary } from "./tenant-scope-boundary";
afterEach(cleanup);
it("keeps the same child instance across resolved same-scope renders", () => {
  const view = render(
    <TenantScopeBoundary status="resolved">
      <input aria-label="Draft" defaultValue="local" />
    </TenantScopeBoundary>,
  );
  const field = screen.getByLabelText("Draft");
  view.rerender(
    <TenantScopeBoundary status="resolved">
      <input aria-label="Draft" defaultValue="local" />
    </TenantScopeBoundary>,
  );
  expect(screen.getByLabelText("Draft")).toBe(field);
});
it("blocks unresolved children and offers retry after a scope lookup failure", () => {
  const retry = vi.fn();
  const view = render(
    <TenantScopeBoundary status="loading">
      <input aria-label="Protected draft" />
    </TenantScopeBoundary>,
  );
  expect(screen.queryByLabelText("Protected draft")).not.toBeInTheDocument();
  view.rerender(
    <TenantScopeBoundary status="error" retry={retry}>
      <input aria-label="Protected draft" />
    </TenantScopeBoundary>,
  );
  expect(screen.queryByLabelText("Protected draft")).not.toBeInTheDocument();
  expect(screen.getByRole("alert")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button"));
  expect(retry).toHaveBeenCalledTimes(1);
});
