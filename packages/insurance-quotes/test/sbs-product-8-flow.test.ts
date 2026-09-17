import { describe, expect, it } from "vitest";
import { executeSbsProduct8Flow } from "../src/sbs-product-8-flow";

describe("SBS Product 8 flow", () => {
  it("creates one session and passes it to each remaining step", async () => {
    const calls: Array<{
      operationId: string;
      transientValues?: Record<string, string>;
    }> = [];

    const result = await executeSbsProduct8Flow(
      async (operationId, transientValues) => {
        calls.push({ operationId, transientValues });
        return operationId === "sbs-product-8-quote"
          ? { status: 200, data: "<No_Sesion>session-42</No_Sesion>" }
          : { status: 200, data: "<completed />" };
      },
    );

    expect(result).toEqual({ status: 200, data: "<completed />" });
    expect(calls).toEqual([
      { operationId: "sbs-product-8-quote", transientValues: undefined },
      {
        operationId: "sbs-product-8-add-coverage-1",
        transientValues: { sbs_product_8_session_id: "session-42" },
      },
      {
        operationId: "sbs-product-8-add-coverage-2",
        transientValues: { sbs_product_8_session_id: "session-42" },
      },
      {
        operationId: "sbs-product-8-quote-and-close",
        transientValues: { sbs_product_8_session_id: "session-42" },
      },
    ]);
  });

  it("stops before coverage calls when SBS does not return a session", async () => {
    const calls: string[] = [];

    await expect(
      executeSbsProduct8Flow(async (operationId) => {
        calls.push(operationId);
        return { status: 200, data: "<respuesta />" };
      }),
    ).rejects.toMatchObject({ reason: "response" });

    expect(calls).toEqual(["sbs-product-8-quote"]);
  });
});
