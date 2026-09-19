import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppServices } from "@/app-services";
import { AppServicesProvider } from "./assistant-context";
import { AssistantBar } from "./assistant-bar";
import {
  saveActiveThreadId,
  saveStoredThread,
  type AssistantThreadRecord,
} from "./assistant-thread-storage";

function createMockServices(): AppServices {
  return {
    authSession: {
      getAccessToken: vi.fn().mockResolvedValue("test-token"),
    },
    authProvider: {
      getIdentity: vi.fn().mockResolvedValue({
        id: "user-1",
        fullName: "Test User",
      }),
    },
    assistantConfiguration: {
      activeAgency: vi.fn().mockResolvedValue({ agencies: [] }),
      models: vi.fn().mockResolvedValue([
        {
          id: "anthropic/claude-3.5-sonnet",
          name: "Claude 3.5 Sonnet",
          contextLength: 200000,
          inputPricePerMillion: 3,
          outputPricePerMillion: 15,
          modalities: { text: true, image: true, audio: false, file: true },
          supportsTools: true,
        },
        {
          id: "deepseek/deepseek-chat",
          name: "DeepSeek V3",
          contextLength: 64000,
          inputPricePerMillion: 0.14,
          outputPricePerMillion: 0.28,
          modalities: { text: true, image: false, audio: false, file: false },
          supportsTools: true,
        },
      ]),
      summary: vi.fn().mockResolvedValue({
        global: {
          keyState: "configured",
          model: "anthropic/claude-3.5-sonnet",
          customKeySet: true,
          configuredAt: "2026-01-01T00:00:00Z",
        },
        agencies: [],
        deployment: {
          model: "anthropic/claude-3.5-sonnet",
          configured: true,
        },
      }),
    },
    virtualEmployees: {
      list: vi.fn().mockResolvedValue([
        {
          id: "emp-ventas",
          agencyId: null,
          name: "Sofía",
          handle: "ventas",
          position: "Asesora de Ventas",
          avatar: "briefcase",
          greeting: "¡Hola! Soy Sofía.",
          systemPrompt: "Experta en ventas",
          allowedCollections: ["customers", "quotes"],
          model: null,
          status: "active",
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
          createdBy: null,
        },
        {
          id: "emp-soporte",
          agencyId: null,
          name: "Carlos",
          handle: "soporte",
          position: "Especialista en Soporte",
          avatar: "headset",
          greeting: "¡Hola! Soy Carlos.",
          systemPrompt: "Experto en soporte",
          allowedCollections: ["claims", "policies"],
          model: null,
          status: "active",
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
          createdBy: null,
        },
      ]),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      uploadFile: vi.fn(),
      deleteFile: vi.fn(),
    },
  } as unknown as AppServices;
}

describe("AssistantBar History & Thread Switching", () => {
  beforeEach(() => {
    window.localStorage.clear();
    Element.prototype.scrollTo = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("toggles to history view and lists saved conversations", async () => {
    const user = userEvent.setup();
    const services = createMockServices();

    const sampleThread: AssistantThreadRecord = {
      id: "thread-abc",
      userId: "user-1",
      title: "Clientes en Bogotá",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [
        {
          id: "msg-1",
          role: "user",
          parts: [{ type: "text", text: "Clientes en Bogotá" }],
        },
      ],
    };
    saveStoredThread(sampleThread, "user-1");
    saveActiveThreadId("thread-abc", "user-1");

    render(
      <AppServicesProvider services={services}>
        <AssistantBar />
      </AppServicesProvider>,
    );

    // Open assistant sheet
    await user.click(screen.getByRole("button", { name: "Abrir asistente" }));

    // Verify chat view is visible with thread title pill
    const matches = await screen.findAllByText("Clientes en Bogotá");
    expect(matches[0]).toBeVisible();
    expect(screen.getByRole("button", { name: "Ver historial" })).toBeVisible();

    // Toggle history view
    await user.click(screen.getByRole("button", { name: "Ver historial" }));

    // Verify history header and conversation item
    expect(
      await screen.findByRole("heading", { name: "Historial" }),
    ).toBeVisible();
    expect(screen.getByTestId("thread-card-thread-abc")).toBeVisible();

    // Return to chat
    await user.click(screen.getByRole("button", { name: "Volver al chat" }));
    expect(
      await screen.findByRole("heading", { name: "Asistente Savia" }),
    ).toBeVisible();
  });

  it("starts a new conversation when clicking the new thread button", async () => {
    const user = userEvent.setup();
    const services = createMockServices();

    const thread1: AssistantThreadRecord = {
      id: "thread-1",
      userId: "user-1",
      title: "Conversación anterior",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [
        {
          id: "msg-1",
          role: "user",
          parts: [{ type: "text", text: "Conversación anterior" }],
        },
      ],
    };
    saveStoredThread(thread1, "user-1");
    saveActiveThreadId("thread-1", "user-1");

    render(
      <AppServicesProvider services={services}>
        <AssistantBar />
      </AppServicesProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Abrir asistente" }));

    // Click new conversation button
    await user.click(
      screen.getByRole("button", { name: "Nueva conversación" }),
    );

    // Should display the welcome screen for fresh thread
    expect(
      await screen.findByText("¿En qué puedo ayudarte hoy?"),
    ).toBeVisible();
  });

  it("switches to a selected thread from history", async () => {
    const user = userEvent.setup();
    const services = createMockServices();

    const thread1: AssistantThreadRecord = {
      id: "thread-1",
      userId: "user-1",
      title: "Análisis de ventas",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [
        {
          id: "m-1",
          role: "user",
          parts: [{ type: "text", text: "Análisis de ventas" }],
        },
      ],
    };
    const thread2: AssistantThreadRecord = {
      id: "thread-2",
      userId: "user-1",
      title: "Cotizaciones pendientes",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [
        {
          id: "m-2",
          role: "user",
          parts: [{ type: "text", text: "Cotizaciones pendientes" }],
        },
      ],
    };
    saveStoredThread(thread1, "user-1");
    saveStoredThread(thread2, "user-1");
    saveActiveThreadId("thread-1", "user-1");

    render(
      <AppServicesProvider services={services}>
        <AssistantBar />
      </AppServicesProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Abrir asistente" }));

    // Go to history
    await user.click(screen.getByRole("button", { name: "Ver historial" }));

    // Click on thread 2
    await user.click(screen.getByTestId("thread-card-thread-2"));

    // Verify it switched and returned to chat view
    expect(
      await screen.findByRole("heading", { name: "Asistente Savia" }),
    ).toBeVisible();
    const switchedMatches = screen.getAllByText("Cotizaciones pendientes");
    expect(switchedMatches[0]).toBeVisible();
  });

  it("shows one loading status with a working stop control", async () => {
    const user = userEvent.setup();
    const services = createMockServices();

    // Stub fetch to keep the response pending
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));

    render(
      <AppServicesProvider services={services}>
        <AssistantBar />
      </AppServicesProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Abrir asistente" }));

    // Verify initial idle state
    expect(screen.queryByText("En línea")).toBeNull();
    expect(
      screen.getByText("Enter para enviar • Shift + Enter para salto de línea"),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Enviar mensaje" }),
    ).toBeVisible();

    // Type a question and submit
    const input = screen.getByLabelText("Mensaje para el asistente");
    await user.type(input, "¿Cuáles son los clientes recientes?");
    await user.click(screen.getByRole("button", { name: "Enviar mensaje" }));

    expect(
      await screen.findByTestId("assistant-thinking-indicator"),
    ).toBeVisible();
    expect(screen.queryByTestId("assistant-header-busy-badge")).toBeNull();
    expect(
      screen.queryByText("El sistema está ocupado procesando tu consulta…"),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Detener respuesta" }),
    ).toBeVisible();
  });

  it("hides thinking indicator when the user stops the response", async () => {
    const user = userEvent.setup();
    const services = createMockServices();

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url, options) => {
        return new Promise((_, reject) => {
          options?.signal?.addEventListener("abort", () => {
            const err = new Error("The user aborted a request.");
            err.name = "AbortError";
            reject(err);
          });
        });
      }),
    );

    render(
      <AppServicesProvider services={services}>
        <AssistantBar />
      </AppServicesProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Abrir asistente" }));

    const input = screen.getByLabelText("Mensaje para el asistente");
    await user.type(input, "¿Cuáles son los clientes?");
    await user.click(screen.getByRole("button", { name: "Enviar mensaje" }));

    const stopButton = await screen.findByRole("button", {
      name: "Detener respuesta",
    });
    expect(stopButton).toBeVisible();

    await user.click(stopButton);

    await vi.waitFor(() => {
      expect(screen.queryByTestId("assistant-thinking-indicator")).toBeNull();
      expect(
        screen.queryByText(/Consultando datos y preparando respuesta/),
      ).toBeNull();
    });
  });

  it("does not display thinking indicator alongside error banner when query fails", async () => {
    const user = userEvent.setup();
    const services = createMockServices();

    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Network error")),
    );

    render(
      <AppServicesProvider services={services}>
        <AssistantBar />
      </AppServicesProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Abrir asistente" }));

    const input = screen.getByLabelText("Mensaje para el asistente");
    await user.type(input, "¿Cuáles son los clientes?");
    await user.click(screen.getByRole("button", { name: "Enviar mensaje" }));

    expect(
      await screen.findByText("La respuesta se interrumpió. Intenta de nuevo."),
    ).toBeVisible();
    expect(screen.queryByTestId("assistant-thinking-indicator")).toBeNull();
    expect(
      screen.queryByText(/Consultando datos y preparando respuesta/),
    ).toBeNull();
  });

  it("displays virtual employee chips in empty thread view", async () => {
    const user = userEvent.setup();
    const services = createMockServices();

    render(
      <AppServicesProvider services={services}>
        <AssistantBar />
      </AppServicesProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Abrir asistente" }));

    expect(
      await screen.findByText("Empleados Virtuales (@mención)"),
    ).toBeVisible();
    expect(screen.getByText("Sofía")).toBeVisible();
    expect(screen.getByText("@ventas")).toBeVisible();
    expect(screen.getByText("Carlos")).toBeVisible();
    expect(screen.getByText("@soporte")).toBeVisible();
  });

  it("shows mention autocomplete popover when typing @ and selects employee", async () => {
    const user = userEvent.setup();
    const services = createMockServices();

    render(
      <AppServicesProvider services={services}>
        <AssistantBar />
      </AppServicesProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Abrir asistente" }));

    const input = screen.getByLabelText("Mensaje para el asistente");
    await user.type(input, "@");

    const popover = await screen.findByTestId("assistant-mention-popover");
    expect(popover).toBeVisible();
    expect(screen.getByText("Empleados Virtuales")).toBeVisible();

    // Click on Sofia employee option in the popover
    const sofiaBtn = within(popover).getByRole("button", { name: /Sofía/ });
    await user.click(sofiaBtn);

    // Popover should close and input should contain @ventas
    expect(screen.queryByTestId("assistant-mention-popover")).toBeNull();
    expect(input).toHaveValue("@ventas ");
  });

  it("renders virtual employee name and badge in assistant message when thread was addressed to employee", async () => {
    const user = userEvent.setup();
    const services = createMockServices();

    const sampleThread: AssistantThreadRecord = {
      id: "thread-with-employee",
      userId: "user-1",
      title: "Consulta a ventas",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [
        {
          id: "msg-user",
          role: "user",
          parts: [
            {
              type: "text",
              text: "@ventas ¿Cuáles son las oportunidades abiertas?",
            },
          ],
        },
        {
          id: "msg-asst",
          role: "assistant",
          parts: [
            {
              type: "text",
              text: "Hola, soy Sofía. Tenemos 15 oportunidades abiertas este mes.",
            },
          ],
        },
      ],
    };
    saveStoredThread(sampleThread, "user-1");
    saveActiveThreadId("thread-with-employee", "user-1");

    render(
      <AppServicesProvider services={services}>
        <AssistantBar />
      </AppServicesProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Abrir asistente" }));

    // Verify Sofía employee header is rendered for the assistant response
    const sofiaMatches = await screen.findAllByText("Sofía");
    expect(sofiaMatches[0]).toBeVisible();
    expect(screen.getAllByText("@ventas").length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByText(
        "Hola, soy Sofía. Tenemos 15 oportunidades abiertas este mes.",
      ),
    ).toBeVisible();
  });

  it("renders composer action buttons including voice dictation and attachment button with model capability badges", async () => {
    const user = userEvent.setup();
    const services = createMockServices();

    render(
      <AppServicesProvider services={services}>
        <AssistantBar />
      </AppServicesProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Abrir asistente" }));

    // Verify attachment button is present and enabled for multimodal model (claude-3.5-sonnet)
    const attachmentBtn = await screen.findByTestId(
      "composer-attachment-button",
    );
    expect(attachmentBtn).toBeVisible();
    expect(attachmentBtn).not.toBeDisabled();

    // Verify voice dictation button is rendered
    const voiceBtn = screen.getByTestId("composer-voice-dictation");
    expect(voiceBtn).toBeVisible();

    // Verify capability badges container is rendered in composer
    const badges = screen.getByTestId("composer-active-context");
    expect(badges).not.toBeVisible();
    await user.click(screen.getByText("Opciones del asistente"));
    expect(badges).toBeVisible();
  });

  it("disables attachment button when model does not support vision or files", async () => {
    const user = userEvent.setup();
    const services = createMockServices();
    // Configure text-only model as global model
    (services.assistantConfiguration.summary as any).mockResolvedValue({
      global: {
        keyState: "configured",
        model: "deepseek/deepseek-chat",
        customKeySet: true,
        configuredAt: "2026-01-01T00:00:00Z",
      },
      agencies: [],
      deployment: {
        model: "deepseek/deepseek-chat",
        configured: true,
      },
    });

    render(
      <AppServicesProvider services={services}>
        <AssistantBar />
      </AppServicesProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Abrir asistente" }));

    // Attachment button should be disabled with tooltip explaining text-only model
    const attachmentBtn = await screen.findByTestId(
      "composer-attachment-button",
    );
    expect(attachmentBtn).toBeVisible();
    expect(attachmentBtn).toBeDisabled();
  });
});

it("keeps the answer visible and earlier narration and tool activity collapsed", async () => {
  window.localStorage.clear();
  const user = userEvent.setup();
  const thread: AssistantThreadRecord = {
    id: "compact-answer",
    userId: "user-1",
    title: "Comparar",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: [
      {
        id: "u",
        role: "user",
        parts: [{ type: "text", text: "@ventas Compara las cotizaciones" }],
      },
      {
        id: "a",
        role: "assistant",
        parts: [
          { type: "text", text: "Voy a consultar las cotizaciones guardadas." },
          {
            type: "tool-savia_get_quote_summary",
            toolCallId: "t1",
            state: "output-available",
            input: {},
            output: { totalQuotes: 1 },
          },
          {
            type: "text",
            text: "Las primas empatan. Falta comparar las coberturas.",
          },
        ],
      },
    ],
  };
  saveStoredThread(thread, "user-1");
  saveActiveThreadId(thread.id, "user-1");
  render(
    <AppServicesProvider services={createMockServices()}>
      <AssistantBar />
    </AppServicesProvider>,
  );
  await user.click(screen.getByRole("button", { name: "Abrir asistente" }));
  expect(
    (
      await screen.findAllByText(
        "Las primas empatan. Falta comparar las coberturas.",
      )
    ).some((el) => el.closest("details") === null),
  ).toBe(true);
  expect(
    screen.getByText("Voy a consultar las cotizaciones guardadas."),
  ).not.toBeVisible();
  await user.click(screen.getByText("Ver consultas (1)"));
  expect(
    screen.getByText("Voy a consultar las cotizaciones guardadas."),
  ).toBeVisible();
});
