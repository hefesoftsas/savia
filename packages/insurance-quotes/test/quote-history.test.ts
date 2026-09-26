import { describe, expect, it, vi } from "vitest";

function detailColl(records: Array<Record<string, unknown>>) {
  return {
    list: vi.fn(
      async (
        options: {
          filters?: { logic?: "and" | "or"; conditions: Array<{ field: string; value?: unknown }> };
        } = {},
      ) => {
        const logic = options.filters?.logic ?? "and";
        const conditions = options.filters?.conditions ?? [];
        const matches = (r: Record<string, unknown>) =>
          logic === "or"
            ? conditions.some((c) => String(r[c.field]) === String(c.value))
            : conditions.every((c) => String(r[c.field]) === String(c.value));
        const filtered = records.filter(matches);
        // Simulate server-side filtering: only matching records are returned.
        const data = conditions.length ? filtered : records;
        return { data, total: data.length, page: 1, perPage: 200 };
      },
    ),
    remove: vi.fn(async (..._args: unknown[]) => {}),
  };
}

describe("filtered history reads", () => {
  it("treats pending details without a usable timestamp as stale", async () => {
    const { mapDetailToBatchItem } = await import("../src/quote-history");
    const item = mapDetailToBatchItem(
      { id: "d-pending", producto: "SBS · Gold", estado: "Solicitada" },
      "La ejecución no se completó.",
      Date.parse("2026-09-25T12:00:00.000Z"),
    );

    expect(item.status).toBe("failed");
    expect(item.error).toBe("La ejecución no se completó.");
  });

  it("fetches only details for the selected master", async () => {
    const coll = detailColl([
      { id: "d1", cotizacion: "m1", producto: "SBS · Gold", flow_id: "sbs-producto-10", aseguradora: "SBS", estado: "Recibida", prima: 100, numero_cotizacion: "Q1" },
      { id: "d2", cotizacion: "m2", producto: "Liberty · Full", flow_id: "liberty-full-quote", aseguradora: "Liberty", estado: "Recibida", prima: 200, numero_cotizacion: "Q2" },
      { id: "d3", cotizacion: "m1", producto: "SBS · Plata", flow_id: "sbs-producto-11", aseguradora: "SBS", estado: "Error", error_mensaje: "boom" },
    ]);
    const { fetchDetailsForQuote } = await import("../src/quote-history");
    const details = await fetchDetailsForQuote(coll as never, "m1", "COT-1");
    expect(details.map((d) => d.id).sort()).toEqual(["d1", "d3"]);
    expect(coll.list).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: expect.objectContaining({ conditions: expect.any(Array) }),
      }),
    );
    // No full-collection scan: server filters, total reflects the selection.
    const firstCall = coll.list.mock.calls[0]?.[0] as
      | { filters?: { conditions?: Array<Record<string, unknown>> } }
      | undefined;
    expect(firstCall?.filters?.conditions?.[0]).toMatchObject({
      field: "cotizacion",
      op: "eq",
      value: "m1",
    });
  });

  it("maps persisted snapshots and durations without needing runs", async () => {
    const { mapDetailToBatchItem } = await import("../src/quote-history");
    const { serializeSnapshot, buildResultSnapshot } = await import("../src/quote-snapshot");
    const snapshot = buildResultSnapshot({
      provider: "SBS Seguros",
      productName: "Plan Gold Premium",
      premium: 1250000,
      quoteNumber: "SIM-1",
      badges: ["Todo Riesgo"],
      coverages: {
        rce: "$4.000.000.000 COP",
        partialLossDeductible: "10% mín. 1 SMMLV",
        totalLossDeductible: "0% (Sin Deducible)",
        replacementCar: "15 días continuos",
        craneAssistance: "Ilimitada Nacional",
        designatedDriver: "12 servicios / año",
        medicalExpenses: "Hasta $60M COP",
        legalAssistance: "Abogado presencial / Ilimitada",
        workshop: "Taller concesionario oficial Chevrolet",
      },
      highlights: ["RCE $4.000M"],
    })!;
    const item = mapDetailToBatchItem(
      {
        id: "d1",
        producto: "SBS Seguros · Plan Gold Premium",
        flow_id: "sbs-producto-10",
        aseguradora: "SBS Seguros",
        estado: "Recibida",
        prima: 1250000,
        numero_cotizacion: "SIM-1",
        resultado_snapshot: serializeSnapshot(snapshot),
        duracion_ms: 1234,
      },
      "La ejecución no se completó.",
    );
    expect(item.snapshot).toEqual(snapshot);
    expect(item.durationMs).toBe(1234);
    expect(item.status).toBe("succeeded");
  });
});

describe("ordered deletion", () => {
  it("deletes children first, then the master", async () => {
    const order: string[] = [];
    const details = detailColl([
      { id: "d1", cotizacion: "m1", _version: 2 },
      { id: "d2", cotizacion: "m1", _version: 3 },
    ]);
    details.remove = vi.fn(async (...args: unknown[]) => {
      order.push(`detail:${String(args[0])}`);
    });
    const master = { remove: vi.fn(async () => { order.push("master:m1"); }) };
    const { deleteQuoteHistory } = await import("../src/quote-history");
    const result = await deleteQuoteHistory(details as never, master as never, "m1", 7, "COT-1");
    expect(result).toEqual({ ok: true, deletedDetails: 2 });
    expect(order).toEqual(["detail:d1", "detail:d2", "master:m1"]);
  });

  it("retains the master when a child deletion fails", async () => {
    const details = detailColl([{ id: "d1", cotizacion: "m1", _version: 1 }]);
    details.remove = vi.fn(async () => {
      throw new Error("conflicto de versión");
    });
    const master = { remove: vi.fn(async () => {}) };
    const { deleteQuoteHistory } = await import("../src/quote-history");
    const result = await deleteQuoteHistory(details as never, master as never, "m1", 4);
    expect(result.ok).toBe(false);
    expect(master.remove).not.toHaveBeenCalled();
    if (!result.ok) expect(result.failedDetailId).toBe("d1");
  });
});

describe("fallback history reads", () => {
  it("falls back to a tolerant scan when the filtered read fails", async () => {
    const records = [
      { id: "d1", cotizacion: "m1", producto: "SBS · Gold" },
      { id: "d2", cotizacion: "m2", producto: "Otro" },
    ];
    const coll = {
      list: vi.fn(async (options: { filters?: unknown } = {}) => {
        if (options.filters) throw new Error("Campo de filtro desconocido.");
        return { data: records, total: records.length, page: 1, perPage: 200 };
      }),
      remove: vi.fn(async () => {}),
    };
    const { fetchDetailsForQuote } = await import("../src/quote-history");
    const details = await fetchDetailsForQuote(coll as never, "m1", "COT-1");
    expect(details.map((d) => d.id)).toEqual(["d1"]);
  });

  it("recovers details by reference name when the relation was lost", async () => {
    const records = [
      { id: "d1", name: "COT-9-producto-8", cotizacion: null, producto: "SBS · Gold" },
      { id: "d2", name: "OTHER-1", cotizacion: "other", producto: "Otro" },
    ];
    const coll = {
      list: vi.fn(async (options: { filters?: unknown } = {}) => {
        if (options.filters) return { data: [], total: 0, page: 1, perPage: 200 };
        return { data: records, total: records.length, page: 1, perPage: 200 };
      }),
      remove: vi.fn(async () => {}),
    };
    const { fetchDetailsForQuote } = await import("../src/quote-history");
    const details = await fetchDetailsForQuote(coll as never, "missing-id", "COT-9");
    expect(details.map((d) => d.id)).toEqual(["d1"]);
  });

  it("retries the master after clearing remaining relations", async () => {
    const details = detailColl([{ id: "d1", cotizacion: "m1", _version: 1 }]);
    let masterAttempts = 0;
    const master = {
      remove: vi.fn(async () => {
        masterAttempts += 1;
        if (masterAttempts === 1) throw new Error("Hay relaciones desde Detalles.");
      }),
    };
    const { deleteQuoteHistory } = await import("../src/quote-history");
    const result = await deleteQuoteHistory(details as never, master as never, "m1", 4, "COT-1");
    expect(result.ok).toBe(true);
    expect(master.remove).toHaveBeenCalledTimes(2);
  });
});

