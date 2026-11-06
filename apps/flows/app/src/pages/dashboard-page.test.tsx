import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardPage } from "./dashboard-page";

const state = vi.hoisted(() => ({ role: "admin", billingUnavailable: true }));
vi.mock("@/components/auth-context", () => ({
  useAuth: () => ({
    organization: { id: "tenant:101", name: "Local tenant", role: state.role },
    user: { platformAdmin: false },
  }),
}));
vi.mock("@/services/billing-service", () => ({
  useBilling: () => ({
    billing: null,
    billingError: state.billingUnavailable
      ? new Error("Resource not found")
      : null,
    isBillingLoading: false,
  }),
}));
vi.mock("@/services/dashboard-service", () => ({
  useDashboard: () => ({
    dashboardStats: { workflows: 12, executions: { total: 7 } },
    dashboardStatsError: null,
    isDashboardStatsLoading: false,
  }),
}));
vi.mock("@/services/workflow-service", () => ({
  createWorkflow: vi.fn(),
  useWorkflows: () => ({ mutateWorkflows: vi.fn() }),
}));
vi.mock("@/services/type-service", () => ({
  useNodeTypes: () => ({ nodeTypes: [] }),
}));
vi.mock("@/hooks/use-org-url", () => ({
  useOrgUrl: () => ({ getOrgUrl: (path: string) => `/org/tenant:101/${path}` }),
}));
vi.mock("@/hooks/use-page", () => ({
  usePageBreadcrumbs: () => ({ setBreadcrumbs: vi.fn() }),
}));
vi.mock("@/components/tour", () => ({ useTour: () => ({ start: vi.fn() }) }));
vi.mock("@/components/layouts/inset-layout", () => ({
  InsetLayout: ({ children }: { children: ReactNode }) => (
    <main>{children}</main>
  ),
}));
vi.mock("@/components/inset-error", () => ({
  InsetError: ({ errorMessage }: { errorMessage: string }) => (
    <p>{errorMessage}</p>
  ),
}));
vi.mock("@/components/workflow/create-workflow-dialog", () => ({
  CreateWorkflowDialog: () => null,
}));

afterEach(() => {
  state.role = "admin";
  state.billingUnavailable = true;
});

function render() {
  return renderToStaticMarkup(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  );
}

describe("local Savia Flows dashboard", () => {
  it("shows local statistics and workflow actions without a cloud billing service", () => {
    const html = render();
    expect(html).toContain("View Workflows");
    expect(html).toContain("View Executions");
    expect(html).toContain("Create Workflow");
    expect(html).not.toContain("Resource not found");
    expect(html).not.toContain("Manage Billing");
    expect(html).not.toContain("Describe what you want");
  });

  it("does not offer workflow creation to a read-only member", () => {
    state.role = "member";
    state.billingUnavailable = false;
    const html = render();
    expect(html).toContain("View Workflows");
    expect(html).not.toContain("Create Workflow");
  });
});
