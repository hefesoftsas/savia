import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FlowCostUsageCard } from "./flow-cost-usage";
const state = vi.hoisted(() => ({
  data: null as any,
  error: null as Error | null,
  isLoading: false,
}));
vi.mock("swr", () => ({ default: () => ({ ...state, mutate: vi.fn() }) }));
vi.mock("./auth-context", () => ({
  useAuth: () => ({ organization: { id: "one" } }),
}));
describe("execution budget", () => {
  it("shows operational alerts without calling them invoice costs", () => {
    state.data = {
      executionsEnabled: true,
      quotasEnabled: true,
      organization: { monthlyRuns: 42, monthlySteps: 84 },
      shared: { dailyRuns: 80, monthlyRuns: 800, activeRuns: 1 },
      limits: { dailyRuns: 100, monthlyRuns: 1000, concurrentRuns: 2 },
      alerts: [{ period: "month", level: "warning", percentage: 80 }],
    };
    const html = renderToStaticMarkup(<FlowCostUsageCard />);
    expect(html).toContain("Monthly quota nearly exhausted: 80%");
    expect(html).toContain("not a Cloudflare invoice");
    expect(html).toContain("42");
  });
  it("offers recovery when the metrics cannot be loaded", () => {
    state.data = null;
    state.error = new Error("unavailable");
    const html = renderToStaticMarkup(<FlowCostUsageCard />);
    expect(html).toContain("Execution usage is unavailable");
    expect(html).toContain("Retry");
    expect(html).not.toContain("Executions enabled");
    state.error = null;
  });
});
