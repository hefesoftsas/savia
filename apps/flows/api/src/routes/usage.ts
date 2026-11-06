import { UsageResponse } from "@savia/flows-types";
import { Hono } from "hono";

import { jwtMiddleware } from "../auth";
import { ApiContext } from "../context";
import { createDatabase, getOrganizationComputeCredits } from "../db";
import { getFlowCostUsage } from "../services/cost-usage";
import { getOrganizationComputeUsage } from "../utils/credits";

const usage = new Hono<ApiContext>();

usage.use("*", jwtMiddleware);

// Managers can inspect shared headroom without seeing other tenant identities.
usage.get("/limits", async (c) => {
  const payload = c.get("jwtPayload");
  const role = payload?.organization?.role ?? payload?.role;
  if (
    payload?.organization?.id !== c.get("organizationId") ||
    !["admin", "owner"].includes(role ?? "")
  )
    return c.json({ error: "Manager access required" }, 403);
  return c.json(await getFlowCostUsage(c.env, c.get("organizationId")!));
});

// Get usage for an organization
usage.get("/", async (c) => {
  const organizationId = c.get("organizationId")!;

  try {
    const computeCredits = await getOrganizationComputeCredits(
      createDatabase(c.env.DB),
      organizationId,
    );
    if (computeCredits === undefined) {
      return c.json(
        {
          error: "Organization not found",
        },
        404,
      );
    }

    const computeUsage = await getOrganizationComputeUsage(
      c.env.KV,
      organizationId,
    );

    return c.json<UsageResponse>({
      computeCredits,
      computeUsage,
      remainingCredits: Math.max(0, computeCredits - computeUsage),
      usagePercentage: Math.min(100, (computeUsage / computeCredits) * 100),
    });
  } catch (error) {
    console.error("Failed to get compute usage:", error);
    return c.json(
      {
        error: "Failed to get compute usage",
      },
      500,
    );
  }
});

export default usage;
