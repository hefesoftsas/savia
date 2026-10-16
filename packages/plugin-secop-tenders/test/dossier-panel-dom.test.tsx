/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginApi } from "@savia/plugin-sdk";
import type { DossierDocument, Job, Stored } from "../dossier";
import { DossierPanel } from "../dossier-panel";
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
let root: Root;
let host: HTMLDivElement;
afterEach(() => {
  if (root) act(() => root.unmount());
  host?.remove();
  vi.clearAllMocks();
});
async function mount(
  configured = true,
  report = false,
  jobs: Job[] = [],
  locale: "es" | "en" | "pt" = "es",
  detailJobs: Job[] = [],
  documents: Stored<DossierDocument>[] = [],
) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const execute = vi.fn(
    async (_action: string, { input }: { input: { operation: string } }) => {
      if (!configured) throw new Error("La conexión no está configurada.");
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
        documents,
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
        requirements: report
          ? [
              {
                id: "req-1",
                revision: 1,
                updatedAt: 1,
                value: {
                  wording: "Experience requirement",
                  category: "experience",
                  mandatory: true,
                  citations: [
                    {
                      documentVersionId: "doc-v1",
                      page: 4,
                      excerpt: "Source excerpt",
                    },
                  ],
                },
              },
            ]
          : [],
        jobs,
        nextOffset: null,
      };
      return {
        output: {
          status: 200,
          data: {
            data:
              input.operation === "companies"
                ? {
                    companies: [
                      {
                        id: "company-1",
                        revision: 1,
                        updatedAt: 1,
                        value: {
                          name: "Example Co.",
                          legalId: "",
                          activities: "",
                          facts: [],
                        },
                      },
                    ],
                  }
                : input.operation === "dossier"
                  ? state
                  : input.operation === "company-detail"
                    ? {
                        company: {
                          id: "company-1",
                          revision: 1,
                          updatedAt: 1,
                          value: {
                            name: "Example Co.",
                            legalId: "",
                            activities: "",
                            facts: [],
                          },
                        },
                        documents: [],
                        expiredDocumentIds: [],
                        jobs: detailJobs,
                      }
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
      list: vi.fn().mockRejectedValue(new Error("Manager access required")),
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
        locale={locale}
        onBack={() => {}}
      />,
    );
  });
  return { execute, create, openAssistant, api };
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
    const { execute, create, api } = await mount();
    expect(host.textContent).toContain("Prepara el expediente completo");
    expect(host.querySelector('[role="alert"]')).toBeNull();
    await click("Guardar y preparar expediente");
    expect(create).toHaveBeenCalledTimes(1);
    expect(
      execute.mock.calls.some(([, a]) => a.input.operation === "prepare"),
    ).toBe(true);
    expect(api.connections.list).not.toHaveBeenCalled();
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
        connectionId: "secop-dossier",
        taskCollection: "secop_application_tasks",
        context: { dossierId: "CO1.REQ.1" },
        initialMessage: expect.stringContaining("todos los requisitos"),
      }),
    );
  });
  it("shows setup only after the configured connection is reported missing", async () => {
    const { execute } = await mount(false);
    expect(host.textContent).toContain("Conectar el asistente de expedientes");
    expect(host.querySelector('input[type="password"]')).not.toBeNull();
    expect(
      execute.mock.calls.some(([, a]) =>
        ["prepare", "company", "assess"].includes(a.input.operation),
      ),
    ).toBe(false);
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

  it("shows cancellation for a restored active job in the dossier snapshot", async () => {
    const { execute } = await mount(true, false, [
      { id: "restored-job", state: "running" },
    ]);
    await click("Cancelar trabajo");
    expect(
      execute.mock.calls.some(
        ([, action]) =>
          action.input.operation === "cancel" &&
          (action.input as unknown as { arguments: { id: string } }).arguments
            .id === "restored-job",
      ),
    ).toBe(true);
  });

  it("shows cancellation for a restored active job in the selected company detail", async () => {
    const { execute } = await mount(true, false, [], "es", [
      { id: "company-job", state: "queued" },
    ]);
    await click("Mi empresa");
    const select = host.querySelector("select");
    expect(select).not.toBeNull();
    await act(async () => {
      select!.value = "company-1";
      select!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(host.textContent).toContain("Cancelar trabajo");
    await click("Cancelar trabajo");
    expect(
      execute.mock.calls.some(
        ([, action]) =>
          action.input.operation === "cancel" &&
          (action.input as unknown as { arguments: { id: string } }).arguments
            .id === "company-job",
      ),
    ).toBe(true);
  });

  it.each([
    ["en", "Back to tenders", "View evidence 1 · p. 4", "Requirements"],
    ["pt", "Voltar às licitações", "Ver evidência 1 · pág. 4", "Requisitos"],
  ] as const)(
    "localizes panel controls and citations for %s",
    async (locale, back, citation, requirements) => {
      await mount(true, true, [], locale);
      expect(host.querySelector("main")?.getAttribute("lang")).toBe(locale);
      expect(host.textContent).toContain(back);
      await click(requirements);
      expect(host.textContent).toContain(citation);
    },
  );

  it.each([
    ["en", "Documents", "Processed"],
    ["pt", "Documentos", "Processado"],
  ] as const)(
    "localizes dossier processing states for %s",
    async (locale, documentsTab, processedState) => {
      await mount(
        true,
        false,
        [],
        locale,
        [],
        [
          {
            id: "document-1",
            revision: 1,
            updatedAt: 1,
            value: { name: "Specification", state: "ready" },
          },
        ],
      );
      await click(documentsTab);
      expect(host.textContent).toContain(processedState);
    },
  );
});
