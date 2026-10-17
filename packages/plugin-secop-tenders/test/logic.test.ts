import { describe, expect, it } from "vitest";
import { createMockPluginApi } from "@savia/plugin-sdk/testing";
import {
  COLLECTION,
  isTrackingConflict,
  interestValues,
  normalizeSearchOutput,
  normalizeSecopRow,
  RequestSequence,
  getSecopDetail,
  saveInterest,
  searchSecop,
  updateInterest,
  type Interest,
} from "../logic";
import type { PluginApi, PluginCollectionDefinition } from "@savia/plugin-sdk";

const definition = {
  name: COLLECTION,
  label: "SECOP opportunities",
  description: "",
  config: {
    version: 2,
    fields: {
      source_id: {
        type: "Textbox",
        label: "SECOP source ID",
        config: { unique: true },
      },
    },
    fieldOrder: ["source_id"],
  },
} satisfies PluginCollectionDefinition;
const row = normalizeSecopRow({
  ":id": "co-123",
  nombre_del_procedimiento: "Road maintenance",
  entidad: "City Office",
  precio_base: "1200000",
  urlproceso: {
    url: "https://www.contratos.gov.co/consulta/123",
    label: "View process",
  },
});

describe("SECOP normalization", () => {
  it("ignores responses from an older query or a disposed screen", () => {
    const requests = new RequestSequence();
    const first = requests.begin();
    const second = requests.begin();
    expect(requests.isCurrent(first)).toBe(false);
    expect(requests.isCurrent(second)).toBe(true);
    requests.invalidate();
    expect(requests.isCurrent(second)).toBe(false);
  });

  it("maps known source aliases and preserves the raw row", () => {
    expect(row).toMatchObject({
      id: "co-123",
      name: "Road maintenance",
      entity: "City Office",
      amount: "1200000",
      source_url: "https://www.contratos.gov.co/consulta/123",
    });
    expect(
      normalizeSecopRow({ nombre_del_procedimiento: "Missing ID" }),
    ).toBeNull();
  });

  it("normalizes paged action responses without inventing a next page", () => {
    expect(
      normalizeSearchOutput(
        { data: [{ id: "1" }], page: 99, hasNext: false },
        { page: 2, perPage: 20 },
      ),
    ).toEqual({
      data: [{ id: "1" }],
      page: 2,
      perPage: 20,
      hasNext: false,
    });
  });

  it("bounds and parses snapshots while accepting only safe web links", () => {
    const values = interestValues({
      ...row!,
      amount: "1.200.000",
      source_url: "javascript:alert(1)",
    });
    expect(values.amount).toBe(1_200_000);
    expect(values.source_url).toBe("");
    expect(JSON.parse(values.snapshot)).toMatchObject({ id: "co-123" });
    expect(values.monitoring_enabled).toBe(true);
  });

  it("looks up a single tender through the fixed detail action", async () => {
    let capturedId: unknown;
    const api = {
      actions: {
        execute: async (
          id: string,
          request: { input: Record<string, unknown> },
        ) => {
          expect(id).toBe("detail");
          capturedId = request.input.id_del_proceso;
          return {
            output: {
              data: [
                { ":id": "co-123", estado_del_procedimiento: "Publicado" },
              ],
            },
          };
        },
      },
    } as unknown as PluginApi;
    await expect(getSecopDetail(api, "co-123")).resolves.toMatchObject({
      id: "co-123",
      source_status: "Publicado",
    });
    expect(capturedId).toBe("co-123");
  });

  it("passes only non-empty search filters and pagination to the declared action", async () => {
    let captured: Record<string, unknown> = {};
    const api = {
      actions: {
        execute: async (
          _id: string,
          request: { input: Record<string, unknown> },
        ) => {
          captured = request.input;
          return { output: { data: [{ id: "1" }], hasNext: false } };
        },
      },
    } as unknown as PluginApi;
    await searchSecop(api, {
      q: " roads ",
      estado: "",
      departamento: "Cundinamarca",
      page: 3,
      perPage: 20,
    });
    expect(captured).toEqual({
      vigentes: true,
      q: "roads",
      departamento: "Cundinamarca",
      page: 3,
      perPage: 20,
    });
  });
  it("explicitly allows historical searches without losing the scope on later pages", async () => {
    const inputs: unknown[] = [];
    const api = {
      actions: {
        execute: async (_id: string, request: { input: unknown }) => {
          inputs.push(request.input);
          return { output: { data: [] } };
        },
      },
    } as unknown as PluginApi;
    await searchSecop(api, { vigentes: false, page: 2 });
    expect(inputs).toEqual([{ vigentes: false, page: 2, perPage: 20 }]);
  });
});

describe("interest persistence", () => {
  it("creates once, then returns the saved record without overwriting its tracking data", async () => {
    const api = createMockPluginApi({
      collections: [{ definition, records: [] }],
    });
    const first = await saveInterest(api, row!);
    await api.collections
      .collection<Interest>(COLLECTION)
      .update(first.record.id, { notes: "Keep these notes" });
    const duplicate = await saveInterest(api, row!);
    expect(first.created).toBe(true);
    expect(duplicate.created).toBe(false);
    expect(duplicate.record.notes).toBe("Keep these notes");
  });

  it("uses record versions for tracking edits and leaves conflict resolution to reload", async () => {
    const api = createMockPluginApi({
      collections: [
        {
          definition,
          records: [
            {
              id: "saved-1",
              source_id: "co-123",
              name: "Road maintenance",
              status: "interested",
              _version: 2,
            },
          ],
        },
      ],
    });
    const collection = api.collections.collection<Interest>(COLLECTION);
    const record = await collection.get("saved-1");
    const updated = await updateInterest(api, record, { status: "evaluating" });
    expect(updated.status).toBe("evaluating");
    expect(updated._version).toBe(3);
  });

  it("surfaces version conflicts from the host", async () => {
    const api = createMockPluginApi({
      collections: [
        {
          definition,
          records: [
            {
              id: "saved-1",
              source_id: "co-123",
              name: "Road maintenance",
              status: "interested",
            },
          ],
        },
      ],
      conflict: true,
    });
    const record = await api.collections
      .collection<Interest>(COLLECTION)
      .get("saved-1");
    await expect(
      updateInterest(api, record, { notes: "new notes" }),
    ).rejects.toMatchObject({ code: "version_conflict" });
  });

  it("surfaces server failures rather than reporting a saved opportunity", async () => {
    const api = createMockPluginApi({
      collections: [{ definition, records: [] }],
      offline: true,
    });
    await expect(saveInterest(api, row!)).rejects.toThrow("offline");
  });
});

it("recognizes structured conflict metadata from the sandbox without a localization service", () => {
  expect(
    isTrackingConflict(
      Object.assign(new Error("Record changed"), { status: 409 }),
    ),
  ).toBe(true);
  expect(isTrackingConflict({ code: "VERSION_CONFLICT" })).toBe(true);
  expect(isTrackingConflict({ code: "write_conflict" })).toBe(true);
  expect(
    isTrackingConflict(
      Object.assign(new Error("Conflict in provider"), { status: 503 }),
    ),
  ).toBe(false);
  expect(isTrackingConflict(undefined)).toBe(false);
});
