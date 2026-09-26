import { describe, expect, it, vi } from "vitest";
import { storeJsonSchema } from "@savia/studio-shared/plugin-store";
import store from "../../../store-ports/quotes/store.json";
import solution from "../../../solutions/insurance-quoter/manifest.json";
import { persistQuoteDetail } from "../src/quote-persistence";

const patch = {
  estado: "Recibida",
  run_id: "run-1",
  numero_cotizacion: "Q-123",
  prima: 750000,
  resultado_snapshot: '{"version":1}',
  duracion_ms: 1200,
};

function collection(fields: string[]) {
  return {
    describe: vi.fn(async () => ({
      config: { fields: Object.fromEntries(fields.map((key) => [key, {}])) },
    })),
    update: vi.fn(
      async (
        _id: string,
        data: Record<string, unknown>,
        _options?: { version?: number },
      ) => ({ id: "detail-1", ...data, _version: 2 }),
    ),
  };
}

describe("persistQuoteDetail", () => {
  it("preserves core results with a legacy schema that rejects new fields", async () => {
    const legacyFields = ["estado", "run_id", "numero_cotizacion", "prima"];
    const handle = collection(legacyFields);
    handle.update.mockImplementation(async (_id, data) => {
      for (const field of Object.keys(data)) {
        if (!legacyFields.includes(field))
          throw new Error(`Unknown field: ${field}`);
      }
      return { id: "detail-1", ...data, _version: 2 };
    });
    const result = await persistQuoteDetail(handle, "detail-1", patch, {
      version: 1,
    });
    expect(handle.update).toHaveBeenCalledWith(
      "detail-1",
      {
        estado: "Recibida",
        run_id: "run-1",
        numero_cotizacion: "Q-123",
        prima: 750000,
      },
      { version: 1 },
    );
    expect(result.omittedFields).toEqual(["resultado_snapshot", "duracion_ms"]);
    expect(result.record._version).toBe(2);
    expect(patch.resultado_snapshot).toBe('{"version":1}');
  });

  it("shares schema reads across simultaneous product writes", async () => {
    const handle = collection(Object.keys(patch));
    await Promise.all(
      Array.from({ length: 19 }, (_, index) =>
        persistQuoteDetail(handle, `detail-${index}`, patch, { version: 1 }),
      ),
    );
    expect(handle.describe).toHaveBeenCalledTimes(1);
    expect(handle.update).toHaveBeenCalledTimes(19);
  });

  it("retries schema discovery after a transient read failure", async () => {
    const handle = collection(Object.keys(patch));
    handle.describe.mockRejectedValueOnce(new Error("Offline"));
    await expect(persistQuoteDetail(handle, "detail-1", patch)).rejects.toThrow(
      "Offline",
    );
    await persistQuoteDetail(handle, "detail-1", patch);
    expect(handle.describe).toHaveBeenCalledTimes(2);
    expect(handle.update).toHaveBeenCalledTimes(1);
  });

  it("stores full results when the schema supports them", async () => {
    const handle = collection(Object.keys(patch));
    const result = await persistQuoteDetail(handle, "detail-1", patch, {
      version: 1,
    });
    expect(result.omittedFields).toEqual([]);
    expect(handle.update).toHaveBeenCalledWith("detail-1", patch, {
      version: 1,
    });
  });

  it("does not discard unknown core fields or swallow write failures", async () => {
    const handle = collection([]);
    handle.update.mockRejectedValue(new Error("Access denied"));
    await expect(
      persistQuoteDetail(handle, "detail-1", patch, { version: 1 }),
    ).rejects.toThrow("Access denied");
    expect(handle.update.mock.calls[0]?.[1]).toHaveProperty(
      "estado",
      "Recibida",
    );
    expect(handle.update).toHaveBeenCalledTimes(1);
  });

  it("surfaces unavailable schema without silently dropping snapshot data", async () => {
    const handle = collection([]);
    handle.describe.mockRejectedValue(new Error("Offline"));
    await expect(
      persistQuoteDetail(handle, "detail-1", patch, { version: 1 }),
    ).rejects.toThrow("Offline");
    expect(handle.update).not.toHaveBeenCalled();
  });
});

it("ships the solution quote schemas in the standalone plugin without requiring legacy schema replacement", () => {
  const parsed = storeJsonSchema.parse(store);
  expect(parsed.collections.map((entry) => entry.object)).toEqual(
    solution.objects.filter((object) =>
      ["cotizaciones", "cotizaciones_detalle"].includes(object.name),
    ),
  );
  expect(
    parsed.collections.every(
      (entry) => Object.keys(entry.requiredFields).length === 0,
    ),
  ).toBe(true);
});
