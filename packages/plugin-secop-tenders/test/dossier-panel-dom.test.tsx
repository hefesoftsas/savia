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
  secondPageDocuments: Stored<DossierDocument>[] = [],
  pagedTotal = 0,
) {
  const pagedDocs =
    pagedTotal > 0
      ? Array.from({ length: pagedTotal }, (_, index) => ({
          id: `paged-${index}`,
          revision: 1,
          updatedAt: 1,
          value: { name: `Paged ${index}`, state: "ready" },
        }))
      : [];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const execute = vi.fn(
    async (
      _action: string,
      {
        input,
      }: {
        input: { operation: string; arguments?: { offset?: number } };
      },
    ) => {
      const pageOffset = input.arguments?.offset ?? 0;
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
                  indexed: 2,
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
        nextOffset:
          secondPageDocuments.length > 0 && pageOffset === 0 ? 20 : null,
      };
      if (
        input.operation === "dossier" &&
        pageOffset > 0 &&
        secondPageDocuments.length > 0
      )
        state.documents = secondPageDocuments;
      if (input.operation === "dossier" && pagedTotal > 0) {
        state.documents = pagedDocs.slice(pageOffset, pageOffset + 20);
        state.documentTotal = pagedTotal;
        state.nextOffset =
          pageOffset + 20 < pagedTotal ? pageOffset + 20 : null;
      }
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
    (b) =>
      b.textContent?.trim() === label || b.getAttribute("aria-label") === label,
  );
  expect(button).toBeDefined();
  await act(async () => button!.click());
}
describe("tender dossier flow", () => {
  it("shows an honest empty inventory without claiming CAPTCHA blockage", async () => {
    await mount();
    await click("Documentos");
    expect(host.textContent).toContain("Sin documentos en el expediente");
    expect(host.textContent).not.toContain("Mostrando 0");
    expect(host.textContent).not.toContain("CAPTCHA");
    const publicDocuments = host.querySelector(
      'button[aria-label="Documentos públicos y análisis anteriores por PDF"]',
    );
    expect(publicDocuments?.textContent).toBe("");
    expect(
      host.querySelector('button[aria-label="Guardar y preparar expediente"]')
        ?.textContent,
    ).toBe("");
  });
  it("shows extraction assistance only for blocked documents", async () => {
    await mount(
      true,
      true,
      [],
      "es",
      [],
      [
        {
          id: "doc",
          revision: 1,
          updatedAt: 1,
          value: { name: "Annex", state: "blocked" } as DossierDocument,
        },
      ],
    );
    await click("Documentos");
    expect(host.textContent).toContain("Algunos archivos necesitan tu ayuda");
    expect(host.textContent).toContain("Annex");
    expect(host.textContent).not.toContain("Sin documentos en el expediente");
  });

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
  it("shows a foolproof guide with one next step before the dossier exists", async () => {
    await mount();
    expect(host.textContent).toContain("Siguiente paso");
    expect(host.textContent).toContain("Paso 1 de 4");
    const steps = [...host.querySelectorAll(".secop-guide ol li")];
    expect(steps).toHaveLength(4);
    expect(steps[0].getAttribute("aria-current")).toBe("step");
  });

  it("loads every inventory page up front so progress needs no load-more", async () => {
    const first = {
      id: "doc-a",
      revision: 1,
      updatedAt: 1,
      value: { name: "First", state: "ready" },
    } as Stored<DossierDocument>;
    const second = {
      id: "doc-b",
      revision: 1,
      updatedAt: 1,
      value: { name: "Second", state: "ready" },
    } as Stored<DossierDocument>;
    await mount(true, false, [], "es", [], [first], [second]);
    await click("Documentos");
    expect(host.textContent).toContain("First");
    expect(host.textContent).toContain("Second");
    expect(host.textContent).not.toContain("Cargar más documentos");
  });

  it("retains manually loaded pages beyond the eager-load cap on refresh", async () => {
    await mount(true, false, [], "es", [], [], [], 520);
    await click("Documentos");
    expect(host.textContent).toContain("Paged 499");
    await click("Cargar más documentos y requisitos");
    expect(host.textContent).toContain("Paged 519");
    await click("Actualizar");
    expect(host.textContent).toContain("Paged 519");
    expect(host.textContent).toContain("Paged 0");
  });

  it("names synthesis while every catalog document is ready", async () => {
    await mount(
      true,
      true,
      [{ id: "synth-1", state: "running", kind: "synthesize" }],
      "es",
      [],
      [
        {
          id: "doc-1",
          revision: 1,
          updatedAt: 1,
          value: { name: "Anexo", state: "ready" } as DossierDocument,
        },
        {
          id: "doc-2",
          revision: 1,
          updatedAt: 1,
          value: {
            name: "Pliego",
            state: "review_required",
          } as DossierDocument,
        },
      ],
    );
    expect(host.textContent).toContain("generando el informe conjunto");
    expect(host.textContent).not.toContain("Estamos leyendo los archivos");
  });

  it("opens the existing Savia chat with an opaque tender context and no duplicate composer", async () => {
    const { openAssistant } = await mount(true, true);
    await click("Asistente");
    expect(host.querySelector("textarea")).toBeNull();
    expect(
      host.querySelector('button[aria-label="Abrir chat de Savia"]')
        ?.textContent,
    ).toBe("");
    expect(
      host.querySelector('button[aria-label="Preparar lista completa"]')
        ?.textContent,
    ).toBe("");
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
    expect(
      host.querySelector('button[aria-label="Abrir chat de Savia"]'),
    ).not.toBeNull();
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

  it("groups multiple running jobs of the same kind into one cancel action", async () => {
    const { execute } = await mount(true, false, [
      { id: "extract-1", state: "running", kind: "extract" },
      { id: "extract-2", state: "running", kind: "extract" },
      { id: "extract-3", state: "queued", kind: "extract" },
    ]);
    const buttons = [...host.querySelectorAll("button")].filter((button) =>
      button.textContent?.includes("Cancelar"),
    );
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toContain("3");
    expect(buttons[0].textContent).toContain("extract");
    expect(buttons[0].getAttribute("aria-label")).toBe(
      "Cancelar trabajo 3 extract",
    );
    await act(async () => buttons[0].click());
    const cancelled = execute.mock.calls
      .filter(([, action]) => action.input.operation === "cancel")
      .map(
        ([, action]) =>
          (action.input as unknown as { arguments: { id: string } }).arguments
            .id,
      );
    expect(cancelled).toEqual(
      expect.arrayContaining(["extract-1", "extract-2", "extract-3"]),
    );
  });

  it.each([
    ["en", "Back to tenders", "View evidence 1 · p. 4", "Requirements"],
    ["pt", "Voltar às licitações", "Ver evidência 1 · pág. 4", "Requisitos"],
  ] as const)(
    "localizes panel controls and citations for %s",
    async (locale, back, citation, requirements) => {
      await mount(true, true, [], locale);
      expect(host.querySelector("main")?.getAttribute("lang")).toBe(locale);
      expect(
        host.querySelector(`button[aria-label="${back}"]`)?.textContent,
      ).toBe("");
      await click(requirements);
      expect(
        host.querySelector(`button[aria-label="${citation}"]`),
      ).not.toBeNull();
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
