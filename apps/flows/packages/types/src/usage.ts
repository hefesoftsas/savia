/**
 * Response from the GET /usage endpoint
 */
export interface UsageResponse {
  computeCredits: number;
  computeUsage: number;
  remainingCredits: number;
  usagePercentage: number;
}

/** Operational quotas, not Cloudflare invoice metrics. All periods are UTC. */
export interface FlowCostUsage {
  executionsEnabled: boolean;
  quotasEnabled: boolean;
  period: { day: string; month: string };
  organization: {
    dailyRuns: number;
    monthlyRuns: number;
    monthlySteps: number;
  };
  shared: { dailyRuns: number; monthlyRuns: number; activeRuns: number };
  limits: {
    dailyRuns: number | null;
    monthlyRuns: number | null;
    concurrentRuns: number | null;
  };
  alerts: Array<{
    period: "day" | "month";
    level: "warning" | "exhausted";
    percentage: number;
  }>;
}
