/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginApi } from "@savia/plugin-sdk";
import { DossierPanel } from "../dossier-panel";
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
let root: Root;
let host: HTMLDivElement;
afterEach(() => {
  if (root) act(() => root.unmount());
  host?.remove();
  vi.clearAllMocks();
});
async function mount(configured = true, report = false) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const execute = vi.fn(
    async (_action: string, { input }: { input: { operation: string } }) => {
      const state = {
        dossier: report
          ? {
              id: "CO1.REQ.1",
              revision: 1,
              value: {
                processId: "CO1.REQ.1",
                corpusRevision: 1,
                state: "partial",
              },
            }
          : null,
        documents: [],
        documentTotal: 2,
        report: report
          ? {
              id: "report",
              revision: 1,
              value: {
                corpusRevision: 1,
                summary: "Se requiere experiencia acreditada.",
                requirementIds: [],
                conflicts: [],
                coverage: {
                  total: 2,
                  indexed: 1,
                  pending: [{ id: "blocked" }],
                  reviewRequired: [],
                },
              },
            }
          : null,
        requirements: [],
        jobs: [],
        nextOffset: null,
      };
      return {
        output: {
          status: 200,
          data: {
            data:
              input.operation === "companies"
                ? { companies: [] }
                : input.operation === "dossier"
                  ? state
                  : input.operation === "conversation"
                    ? null
                    : { job: { id: "job", state: "queued" } },
          },
        },
      };
    },
  );
  const create = vi.fn(async (input) => ({ id: "interest", ...input }));
  const openAssistant = vi.fn().mockResolvedValue(undefined);
  const api = {
    assistant: { open: openAssistant },
    connections: {
      list: vi
        .fn()
        .mockResolvedValue(
          configured
            ? [{ connectionId: "private", connectorId: "secop-dossier" }]
            : [],
        ),
    },
    actions: { execute },
    collections: {
      collection: () => ({
        list: vi.fn().mockResolvedValue({ data: [] }),
        create,
      }),
    },
  } as unknown as PluginApi;
  await act(async () => {
    root.render(
      <DossierPanel
        savia={api}
        row={{ id: "source", process_id: "CO1.REQ.1", name: "Software" }}
        locale="es"
        onBack={() => {}}
      />,
    );
  });
  return { execute, create, openAssistant };
}
async function click(label: string) {
  const button = [...host.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === label,
  );
  expect(button).toBeDefined();
  await act(async () => button!.click());
}
describe("tender dossier flow", () => {
  it("starts with a clear preparation state without mistaking an absent dossier for an error", async () => {
    const { execute, create } = await mount();
    expect(host.textContent).toContain("Prepara el expediente completo");
    expect(host.querySelector('[role="alert"]')).toBeNull();
    await click("Guardar y preparar expediente");
    expect(create).toHaveBeenCalledTimes(1);
    expect(
      execute.mock.calls.some(([, a]) => a.input.operation === "prepare"),
    ).toBe(true);
    expect(host.textContent).toContain("segundo plano");
  });
  it("opens the existing Savia chat with an opaque tender context and no duplicate composer", async () => {
    const { openAssistant } = await mount(true, true);
    await click("Asistente");
    expect(host.querySelector("textarea")).toBeNull();
    await click("Preparar lista completa");
    expect(openAssistant).toHaveBeenCalledWith(
      expect.objectContaining({
        actionId: "assistant-chat",
        connectionId: "private",
        context: { dossierId: "CO1.REQ.1" },
        initialMessage: expect.stringContaining("todos los requisitos"),
      }),
    );
  });
  it("does not send company data before a private connection is configured", async () => {
    const { execute } = await mount(false);
    expect(host.textContent).toContain("Conectar el asistente de expedientes");
    expect(host.querySelector('input[type="password"]')).not.toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });
  it("marks partial coverage and keeps chat unavailable without a report", async () => {
    const { execute } = await mount(true, true);
    expect(
      execute.mock.calls.some(([, a]) => a.input.operation === "conversation"),
    ).toBe(false);
    expect(host.textContent).toContain("Revisión de fuentes pendiente");
    await click("Asistente");
    expect(host.textContent).toContain("Abrir chat de Savia");
  });
});
