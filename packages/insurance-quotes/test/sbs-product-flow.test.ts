import { describe, expect, it, vi } from "vitest";
import { executeSbsProductFlow } from "../src/sbs-product-flow";

describe("SBS product flows", () => {
  it.each([
    ["sbs-product-10-quote", 9, "sbs_product_10_session_id"],
    ["sbs-product-11-quote", 9, "sbs_product_11_session_id"],
  ] as const)(
    "runs %s through its ordered session flow",
    async (startOperationId, stepCount, sessionKey) => {
      const executeStep = vi
        .fn()
        .mockResolvedValueOnce({
          status: 200,
          data: "<No_Sesion>S-1</No_Sesion>",
        })
        .mockResolvedValue({ status: 200, data: "<ok />" });

      await executeSbsProductFlow(startOperationId, executeStep);

      expect(executeStep).toHaveBeenCalledTimes(stepCount);
      expect(executeStep.mock.calls[1]?.[1]).toEqual({ [sessionKey]: "S-1" });
    },
  );
});
