import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { StandardResult } from "./standard-result";
import type { RequestResult } from "../../../../api/src/request-results/contracts";
const value = {
  schemaVersion: "1.0",
  type: "quote",
  status: "success",
  data: {
    offers: [
      {
        provider: "SBS",
        reference: "001",
        product: { id: null, name: "Gold" },
        premium: { total: 119, net: 100, tax: 19, currency: "COP" },
        coverages: null,
        deductibles: null,
        documents: [],
        metadata: { providerFields: {} },
      },
    ],
  },
  errors: [],
  warnings: [],
  metadata: {
    provider: "SBS",
    flowId: "sbs-producto-10",
    runId: "run-1",
    versionId: null,
    createdAt: null,
    simulated: false,
    adapter: "sbs.quote.v1",
    providerFields: {},
  },
} satisfies RequestResult;
afterEach(() => {
  cleanup();
});
it("delegates a saved run to a renderer supplied by an extension", async () => {
  const read = vi.fn().mockResolvedValue(value);
  render(
    <StandardResult
      extensionId="inventory.sync"
      flowId="sbs-producto-10"
      read={read}
      renderer={(result) => (
        <p>Registros importados: {(result.data as any).offers.length}</p>
      )}
      runId="run-1"
    />,
  );
  expect(
    await screen.findByText("Registros importados: 1"),
  ).toBeInTheDocument();
  expect(read).toHaveBeenCalledExactlyOnceWith("sbs-producto-10", "run-1");
  expect(screen.getByText("Ver JSON estándar y metadata")).toBeInTheDocument();
});
it("does not show a previous run when responses arrive out of order", async () => {
  let resolveOld!: (value: RequestResult) => void;
  const read = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<RequestResult>((resolve) => {
          resolveOld = resolve;
        }),
    )
    .mockResolvedValueOnce({
      ...value,
      status: "no_result",
      data: { offers: [] },
    });
  const ui = render(
    <StandardResult flowId="sbs-producto-10" read={read} runId="old" />,
  );
  ui.rerender(
    <StandardResult flowId="sbs-producto-10" read={read} runId="new" />,
  );
  expect(await screen.findByText("Sin resultados")).toBeInTheDocument();
  resolveOld(value);
  await waitFor(() =>
    expect(screen.queryByText("SBS · Gold")).not.toBeInTheDocument(),
  );
});
it("keeps the original response available when normalization cannot load", async () => {
  render(
    <StandardResult
      flowId="flow"
      read={vi.fn().mockRejectedValue(new Error("offline"))}
      runId="run"
    />,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "La respuesta original sigue disponible",
  );
});
