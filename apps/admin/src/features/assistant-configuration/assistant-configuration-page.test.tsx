import { AppLocaleProvider } from "@/i18n/app-locale-provider";
import {
  StoreContextProvider,
  memoryStore,
  useSetLocale,
  I18nContextProvider,
} from "ra-core";
import type { ReactElement, ReactNode } from "react";
import {
  cleanup,
  act,
  render as testingRender,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppServices } from "@/app-services";
import { ApiClientError } from "@/api/api-client";
import {
  AssistantConfigurationPage,
  AssistantConfigurationPanel,
} from "./assistant-configuration-page";

const realtimeRefreshes = vi.hoisted(
  () => new Map<string, () => void | Promise<unknown>>(),
);

vi.mock("@/realtime/use-realtime-refresh", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/realtime/use-realtime-refresh")>();
  return {
    ...actual,
    useRealtimeRefresh: (options: {
      topics: string[];
      tenantId?: number;
      refresh: () => void | Promise<unknown>;
    }) => {
      realtimeRefreshes.set(
        `${options.topics.join(",")}:${options.tenantId ?? "self"}`,
        options.refresh,
      );
      return { changed: false, reload: async () => undefined };
    },
  };
});

afterEach(cleanup);
beforeEach(() => realtimeRefreshes.clear());

function servicesWithSummary(
  overrides: Array<{ tenantId: number; model: string | null }> = [],
) {
  return {
    assistantConfiguration: {
      summary: vi.fn().mockResolvedValue({
        global: {
          scope: "global",
          keyState: "configured",
          model: "deepseek/deepseek-v4-flash",
          allowedModels: null,
          updatedAt: "2026-09-03T12:00:00.000Z",
          updatedBy: "platform-admin",
        },
        tenants: overrides.map((override) => ({
          scope: "tenant",
          keyState: "not_configured",
          allowedModels: null,
          updatedAt: "2026-09-03T12:00:00.000Z",
          updatedBy: "platform-admin",
          ...override,
        })),
      }),
      models: vi.fn().mockResolvedValue([
        {
          id: "deepseek/deepseek-v4-flash",
          name: "DeepSeek V4 Flash",
          contextLength: 64_000,
          inputPricePerMillion: 0.28,
          outputPricePerMillion: 0.42,
        },
      ]),
      activeTenant: vi.fn().mockResolvedValue({
        tenants: [{ id: 101, name: "Agencia Norte" }],
      }),
      saveGlobal: vi.fn(),
      saveTenantOverride: vi.fn(),
      clearTenantOverride: vi.fn(),
    },
  } as unknown as Pick<AppServices, "assistantConfiguration">;
}

describe("AssistantConfigurationPage", () => {
  it("filters output models and saves explicit global model selections", async () => {
    const user = userEvent.setup();
    const services = servicesWithSummary();
    services.assistantConfiguration.models = vi.fn().mockResolvedValue([
      {
        id: "image/provider-cheap",
        name: "Image provider",
        modalities: { imageOutput: true },
        generationPricing: { image: { price: 0.02, unit: "image" } },
      },
      {
        id: "speech/provider",
        name: "Speech provider",
        modalities: { speechOutput: true },
        generationPricing: {
          speech: { prompt: { price: 0.00001, unit: "character" } },
        },
      },
      {
        id: "input/image-only",
        name: "Input only",
        modalities: { image: true },
      },
    ]);
    services.assistantConfiguration.saveGlobal = vi
      .fn()
      .mockResolvedValue(await services.assistantConfiguration.summary());
    render(<AssistantConfigurationPage services={services} />);

    const imageInput = await screen.findByRole("combobox", {
      name: "Modelo de generación de imágenes",
    });
    await user.click(imageInput);
    expect(
      await screen.findByRole("option", { name: /Image provider/ }),
    ).toBeVisible();
    expect(screen.queryByRole("option", { name: /Input only/ })).toBeNull();
    await user.keyboard("image/provider-cheap");
    await user.click(
      screen.getByRole("button", {
        name: /Aplicar el modelo sugerido image\/provider-cheap/,
      }),
    );
    await user.type(
      screen.getByRole("combobox", { name: "Modelo de generación de voz" }),
      "speech/provider",
    );
    await user.click(
      screen.getByRole("button", { name: "Guardar modelos de salida" }),
    );

    await waitFor(() =>
      expect(services.assistantConfiguration.saveGlobal).toHaveBeenCalledWith({
        imageGenerationModel: "image/provider-cheap",
        speechModel: "speech/provider",
      }),
    );
  });

  it("saves tenant output models and leaves blank fields inheriting global", async () => {
    const user = userEvent.setup();
    const services = servicesWithSummary([{ tenantId: 101, model: null }]);
    services.assistantConfiguration.models = vi.fn().mockResolvedValue([
      {
        id: "image/tenant-model",
        name: "Tenant image",
        modalities: { imageOutput: true },
      },
      {
        id: "speech/tenant-model",
        name: "Tenant speech",
        modalities: { speechOutput: true },
      },
    ]);
    services.assistantConfiguration.saveTenantOverride = vi
      .fn()
      .mockResolvedValue(await services.assistantConfiguration.summary());
    render(<AssistantConfigurationPage services={services} />);
    await user.click(
      await screen.findByRole("tab", { name: /Por organización/i }),
    );
    await user.type(
      await screen.findByRole("combobox", {
        name: "Modelo de generación de imágenes",
      }),
      "image/tenant-model",
    );
    await user.type(
      screen.getByRole("combobox", { name: "Modelo de generación de voz" }),
      "speech/tenant-model",
    );
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(
        services.assistantConfiguration.saveTenantOverride,
      ).toHaveBeenCalledWith(
        101,
        expect.objectContaining({
          imageGenerationModel: "image/tenant-model",
          speechModel: "speech/tenant-model",
        }),
      ),
    );
  });

  it("offers dedicated transcription models and saves their endpoint", async () => {
    const user = userEvent.setup();
    const services = servicesWithSummary();
    services.assistantConfiguration.models = vi.fn().mockResolvedValue([
      {
        id: "openai/whisper-large-v3",
        name: "Whisper",
        modalities: { audio: true, text: false },
        transcriptionEndpoint: "audio/transcriptions",
        supportsTools: false,
      },
    ]);
    services.assistantConfiguration.saveGlobal = vi
      .fn()
      .mockResolvedValue(await services.assistantConfiguration.summary());
    render(<AssistantConfigurationPage services={services} />);
    await user.click(await screen.findByLabelText("Modelo de transcripción"));
    await user.click(await screen.findByRole("option", { name: /Whisper/ }));
    await user.click(screen.getByRole("button", { name: "Guardar modelos" }));
    await waitFor(() =>
      expect(services.assistantConfiguration.saveGlobal).toHaveBeenCalledWith({
        transcriptionModel: "openai/whisper-large-v3",
        transcriptionEndpoint: "audio/transcriptions",
        summaryModel: null,
      }),
    );
    await user.click(screen.getByLabelText("Modelo de resumen"));
    expect(screen.queryByRole("option", { name: /Whisper/ })).toBeNull();
  });

  it("offers only audio models for transcription, including models without tools", async () => {
    const user = userEvent.setup();
    const services = servicesWithSummary();
    services.assistantConfiguration.models = vi.fn().mockResolvedValue([
      {
        id: "test/audio",
        name: "Audio model",
        modalities: { audio: true, text: true },
        supportsTools: false,
      },
      {
        id: "test/text",
        name: "Text model",
        modalities: { audio: false, text: true },
        supportsTools: true,
      },
    ]);
    render(<AssistantConfigurationPage services={services} />);
    const input = await screen.findByRole("combobox", {
      name: "Modelo de transcripción",
    });
    await user.click(input);
    expect(
      await screen.findByRole("option", { name: /Audio model/ }),
    ).toBeVisible();
    expect(screen.queryByRole("option", { name: /Text model/ })).toBeNull();
    await user.click(screen.getByRole("option", { name: /Audio model/ }));
    expect(input).toHaveValue("test/audio");
  });

  it("retains a saved dedicated route when the catalog cannot load", async () => {
    const user = userEvent.setup();
    const services = servicesWithSummary();
    const initial = await services.assistantConfiguration.summary();
    const saved = {
      ...initial,
      global: {
        ...initial.global,
        transcriptionModel: "test/native-stt",
        transcriptionEndpoint: "audio/transcriptions",
      },
    };
    services.assistantConfiguration.summary = vi.fn().mockResolvedValue(saved);
    services.assistantConfiguration.models = vi
      .fn()
      .mockRejectedValue(new Error("Offline"));
    services.assistantConfiguration.saveGlobal = vi
      .fn()
      .mockResolvedValue(saved);
    render(<AssistantConfigurationPage services={services} />);
    await user.type(
      await screen.findByLabelText("Modelo de resumen"),
      "test/summary",
    );
    await user.click(screen.getByRole("button", { name: "Guardar modelos" }));
    await waitFor(() =>
      expect(services.assistantConfiguration.saveGlobal).toHaveBeenCalledWith({
        transcriptionModel: "test/native-stt",
        transcriptionEndpoint: "audio/transcriptions",
        summaryModel: "test/summary",
      }),
    );
  });

  it("allows a tenant administrator to save their key and recording models without global controls", async () => {
    const user = userEvent.setup();
    const services = servicesWithSummary([
      { tenantId: 101, model: "test/chat" },
    ]);
    const summary = {
      ...(await services.assistantConfiguration.summary()),
      canManageGlobal: false,
      manageableTenantIds: [101],
    };
    services.assistantConfiguration.summary = vi
      .fn()
      .mockResolvedValue(summary);
    services.assistantConfiguration.saveTenantOverride = vi
      .fn()
      .mockResolvedValue(summary);
    services.assistantConfiguration.models = vi.fn().mockResolvedValue([
      {
        id: "test/audio",
        name: "Dedicated transcription",
        modalities: { audio: true, text: false },
        transcriptionEndpoint: "audio/transcriptions",
      },
    ]);
    render(<AssistantConfigurationPage services={services} />);
    await screen.findByLabelText("Clave de organización");
    expect(screen.queryByRole("tab", { name: "Global" })).toBeNull();
    await user.type(screen.getByLabelText("Clave de organización"), "test-key");
    await user.click(screen.getByLabelText("Modelo de transcripción"));
    await user.click(
      await screen.findByRole("option", { name: /Dedicated transcription/ }),
    );
    await user.type(screen.getByLabelText("Modelo de resumen"), "test/summary");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(
        services.assistantConfiguration.saveTenantOverride,
      ).toHaveBeenCalledWith(101, {
        apiKey: "test-key",
        model: "test/chat",
        allowedModels: null,
        transcriptionModel: "test/audio",
        transcriptionEndpoint: "audio/transcriptions",
        summaryModel: "test/summary",
        imageGenerationModel: null,
        speechModel: null,
      }),
    );
    expect(services.assistantConfiguration.saveGlobal).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Clave de organización")).toHaveValue("");
  });

  it("prevents tenant overrides from being saved when their configuration cannot load", async () => {
    const services = servicesWithSummary();
    services.assistantConfiguration.summary = vi
      .fn()
      .mockRejectedValue(new Error("Configuration unavailable"));
    render(
      <AssistantConfigurationPanel
        services={services}
        embedded
        tenantId={101}
      />,
    );
    await screen.findByText("Configuration unavailable");
    expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();
    expect(
      services.assistantConfiguration.saveTenantOverride,
    ).not.toHaveBeenCalled();
  });

  it("prevents blank meeting overrides from being saved when configuration loading fails", async () => {
    const services = servicesWithSummary();
    services.assistantConfiguration.summary = vi
      .fn()
      .mockRejectedValue(new Error("Configuration unavailable"));
    render(<AssistantConfigurationPage services={services} />);
    await screen.findByText("Configuration unavailable");
    expect(
      screen.getByRole("button", { name: "Guardar modelos" }),
    ).toBeDisabled();
    expect(services.assistantConfiguration.saveGlobal).not.toHaveBeenCalled();
  });

  it("saves independent meeting models without changing the assistant key or chat model", async () => {
    const user = userEvent.setup();
    const services = servicesWithSummary();
    const initial = await services.assistantConfiguration.summary();
    services.assistantConfiguration.saveGlobal = vi.fn().mockResolvedValue({
      ...initial,
      global: {
        ...initial.global,
        transcriptionModel: "openai/whisper-large-v3",
        summaryModel: "openai/gpt-5",
      },
    });
    render(<AssistantConfigurationPage services={services} />);
    await user.type(
      await screen.findByLabelText("Modelo de transcripción"),
      "openai/whisper-large-v3",
    );
    await user.type(screen.getByLabelText("Modelo de resumen"), "openai/gpt-5");
    await user.click(screen.getByRole("button", { name: "Guardar modelos" }));
    await waitFor(() =>
      expect(services.assistantConfiguration.saveGlobal).toHaveBeenCalledWith({
        transcriptionModel: "openai/whisper-large-v3",
        summaryModel: "openai/gpt-5",
      }),
    );
    expect(
      await screen.findByText("Modelos de reuniones guardados."),
    ).toBeVisible();
    expect(screen.getByLabelText("Modelo global")).toHaveValue(
      "deepseek/deepseek-v4-flash",
    );
    cleanup();
    services.assistantConfiguration.summary = vi
      .fn()
      .mockResolvedValue(await services.assistantConfiguration.saveGlobal({}));
    render(<AssistantConfigurationPage services={services} />);
    expect(await screen.findByLabelText("Modelo de transcripción")).toHaveValue(
      "openai/whisper-large-v3",
    );
    expect(screen.getByLabelText("Modelo de resumen")).toHaveValue(
      "openai/gpt-5",
    );
  });

  it("clears meeting overrides to use defaults without requiring a new key", async () => {
    const user = userEvent.setup();
    const services = servicesWithSummary();
    const initial = await services.assistantConfiguration.summary();
    services.assistantConfiguration.summary = vi.fn().mockResolvedValue({
      ...initial,
      global: {
        ...initial.global,
        transcriptionModel: "openai/whisper-large-v3",
        summaryModel: "openai/gpt-5",
      },
    });
    services.assistantConfiguration.saveGlobal = vi
      .fn()
      .mockResolvedValue(initial);
    render(<AssistantConfigurationPage services={services} />);
    await user.clear(await screen.findByLabelText("Modelo de transcripción"));
    await user.clear(screen.getByLabelText("Modelo de resumen"));
    await user.click(screen.getByRole("button", { name: "Guardar modelos" }));
    await waitFor(() =>
      expect(services.assistantConfiguration.saveGlobal).toHaveBeenCalledWith({
        transcriptionModel: null,
        summaryModel: null,
      }),
    );
  });

  it("keeps meeting drafts when saving the assistant model", async () => {
    const user = userEvent.setup();
    const services = servicesWithSummary();
    services.assistantConfiguration.saveGlobal = vi
      .fn()
      .mockResolvedValue(await services.assistantConfiguration.summary());
    render(<AssistantConfigurationPage services={services} />);
    await user.type(
      await screen.findByLabelText("Modelo de resumen"),
      "openai/gpt-5",
    );
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await screen.findByText("Configuración global guardada.");
    expect(screen.getByLabelText("Modelo de resumen")).toHaveValue(
      "openai/gpt-5",
    );
  });

  it("shows saved-key state without rendering the key", async () => {
    render(<AssistantConfigurationPage services={servicesWithSummary()} />);

    expect(await screen.findByText("Configurada")).toBeVisible();
    expect(
      screen.getByText(/Clave personalizada guardada y cifrada/i),
    ).toBeVisible();
    expect(screen.getAllByText(/Configurada el/i).length).toBeGreaterThan(0);
    expect(screen.queryByDisplayValue(/sk-/i)).toBeNull();
    expect(screen.getByLabelText("Clave OpenRouter")).toHaveValue("");
    expect(
      screen.getByPlaceholderText(/dejar en blanco para conservar/i),
    ).toBeVisible();
  });

  it("labels an unconfigured key clearly with a warning banner", async () => {
    const services = servicesWithSummary();
    services.assistantConfiguration.summary = vi.fn().mockResolvedValue({
      global: null,
      tenants: [],
      deployment: {
        keyState: "not_configured",
        model: "deepseek/deepseek-v4-flash",
      },
    });
    render(<AssistantConfigurationPage services={services} />);

    expect(await screen.findByText("Sin clave")).toBeVisible();
    expect(screen.getByText(/Clave obligatoria requerida/i)).toBeVisible();
  });

  it("shows an error when attempting to save without a key if not configured", async () => {
    const user = userEvent.setup();
    const services = servicesWithSummary();
    services.assistantConfiguration.summary = vi.fn().mockResolvedValue({
      global: null,
      tenants: [],
      deployment: {
        keyState: "not_configured",
        model: "deepseek/deepseek-v4-flash",
      },
    });
    render(<AssistantConfigurationPage services={services} />);

    await screen.findByText("Sin clave");
    const saveButton = screen.getByRole("button", { name: "Guardar" });
    await user.click(saveButton);

    expect(
      screen.getByText(
        "Debes ingresar una clave de OpenRouter antes de guardar.",
      ),
    ).toBeVisible();
    expect(services.assistantConfiguration.saveGlobal).not.toHaveBeenCalled();
  });

  it("toggles key visibility between password and text", async () => {
    const user = userEvent.setup();
    render(<AssistantConfigurationPage services={servicesWithSummary()} />);

    const input = (await screen.findByLabelText(
      "Clave OpenRouter",
    )) as HTMLInputElement;
    expect(input.type).toBe("password");

    const toggleButton = screen.getByRole("button", { name: /Mostrar clave/i });
    await user.click(toggleButton);
    expect(input.type).toBe("text");

    await user.click(screen.getByRole("button", { name: /Ocultar clave/i }));
    expect(input.type).toBe("password");
  });

  it("requires confirmation before deleting an tenant override", async () => {
    const user = userEvent.setup();
    render(
      <AssistantConfigurationPage
        services={servicesWithSummary([
          { tenantId: 101, model: "openai/gpt-5" },
        ])}
      />,
    );

    await user.click(
      await screen.findByRole("tab", { name: /Por organización/i }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Volver a heredar" }),
    );
    expect(
      screen.getByRole("dialog", { name: /Volver a heredar/i }),
    ).toBeVisible();
  });

  it("clears the in-memory key after saving it", async () => {
    const user = userEvent.setup();
    const services = servicesWithSummary();
    services.assistantConfiguration.saveGlobal = vi.fn().mockResolvedValue({
      global: {
        scope: "global",
        keyState: "configured",
        model: "openai/gpt-5",
        updatedAt: "2026-09-03T12:05:00.000Z",
        updatedBy: "platform-admin",
      },
      tenants: [],
    });
    render(<AssistantConfigurationPage services={services} />);

    await screen.findByText("Configurada");
    const key = screen.getByLabelText("Clave OpenRouter");
    const globalForm = key.closest("form");
    expect(globalForm).not.toBeNull();
    await user.type(key, "not-a-real-key");
    const model = within(globalForm!).getByLabelText("Modelo global");
    await user.clear(model);
    await user.type(model, "openai/gpt-5");
    await user.click(
      within(globalForm!).getByRole("button", { name: "Guardar" }),
    );

    await waitFor(() =>
      expect(services.assistantConfiguration.saveGlobal).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: "not-a-real-key",
          model: "openai/gpt-5",
        }),
      ),
    );
    expect(key).toHaveValue("");
  });

  it("requires confirmation before deleting the global key", async () => {
    const user = userEvent.setup();
    const services = servicesWithSummary();
    services.assistantConfiguration.saveGlobal = vi.fn().mockResolvedValue({
      global: {
        scope: "global",
        keyState: "not_configured",
        model: "deepseek/deepseek-v4-flash",
        updatedAt: "2026-09-03T12:05:00.000Z",
        updatedBy: "platform-admin",
      },
      tenants: [],
    });
    render(<AssistantConfigurationPage services={services} />);

    await user.click(
      await screen.findByRole("button", {
        name: "Eliminar clave",
      }),
    );
    expect(
      screen.getByRole("dialog", { name: "Eliminar clave global" }),
    ).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Confirmar eliminación" }),
    );

    await waitFor(() =>
      expect(services.assistantConfiguration.saveGlobal).toHaveBeenCalledWith({
        clearApiKey: true,
        model: "deepseek/deepseek-v4-flash",
      }),
    );
  });

  it("can release only an tenant key while retaining its local model", async () => {
    const user = userEvent.setup();
    const services = servicesWithSummary([
      { tenantId: 101, model: "openai/gpt-5" },
    ]);
    services.assistantConfiguration.summary = vi.fn().mockResolvedValue({
      global: null,
      tenants: [
        {
          scope: "tenant",
          tenantId: 101,
          keyState: "configured",
          model: "openai/gpt-5",
          updatedAt: "2026-09-03T12:00:00.000Z",
          updatedBy: "platform-admin",
        },
      ],
    });
    render(<AssistantConfigurationPage services={services} />);

    await user.click(
      await screen.findByRole("tab", { name: /Por organización/i }),
    );
    await screen.findByRole("button", { name: "Volver a heredar" });
    await user.click(screen.getByLabelText("Heredar clave global"));
    await user.click(
      screen.getAllByRole("button", { name: "Guardar" }).at(-1)!,
    );

    await waitFor(() =>
      expect(
        services.assistantConfiguration.saveTenantOverride,
      ).toHaveBeenCalledWith(101, {
        clearApiKey: true,
        model: "openai/gpt-5",
        allowedModels: null,
        transcriptionModel: null,
        summaryModel: null,
        imageGenerationModel: null,
        speechModel: null,
      }),
    );
  });

  it("searches compatible models and shows their input and output prices", async () => {
    const user = userEvent.setup();
    const services = servicesWithSummary();
    services.assistantConfiguration.models = vi.fn().mockResolvedValue([
      {
        id: "openai/gpt-5",
        name: "GPT-5",
        contextLength: 400_000,
        inputPricePerMillion: 2.5,
        outputPricePerMillion: 10,
      },
    ]);
    render(<AssistantConfigurationPage services={services} />);

    const model = await screen.findByRole("combobox", {
      name: "Modelo global",
    });
    await user.clear(model);
    await user.type(model, "gpt");

    const option = await screen.findByRole("option", { name: /GPT-5/i });
    expect(option).toHaveTextContent("Entrada US$ 2,50 / 1M");
    expect(option).toHaveTextContent("Salida US$ 10 / 1M");

    await user.click(option);
    expect(model).toHaveValue("openai/gpt-5");
  });

  it("saves searchable, supported text models as extra Ask AI choices", async () => {
    const user = userEvent.setup();
    const services = servicesWithSummary();
    services.assistantConfiguration.models = vi.fn().mockResolvedValue([
      {
        id: "openai/gpt-5-mini",
        name: "GPT-5 mini",
        contextLength: 128_000,
        inputPricePerMillion: 0.25,
        outputPricePerMillion: 2,
        modalities: { text: true, image: true, audio: false, file: false },
        supportsTools: true,
      },
      {
        id: "openai/gpt-5",
        name: "GPT-5",
        contextLength: 128_000,
        inputPricePerMillion: 1,
        outputPricePerMillion: 2,
        modalities: { text: true, image: true, audio: false, file: false },
        supportsTools: true,
      },
      {
        id: "openai/audio-only",
        name: "Audio only",
        contextLength: 32_000,
        inputPricePerMillion: 1,
        outputPricePerMillion: 1,
        modalities: { text: false, image: false, audio: true, file: false },
        supportsTools: true,
      },
      {
        id: "openai/no-tools",
        name: "No tools",
        contextLength: 32_000,
        inputPricePerMillion: 1,
        outputPricePerMillion: 1,
        modalities: { text: true, image: false, audio: false, file: false },
        supportsTools: false,
      },
    ]);
    services.assistantConfiguration.saveGlobal = vi
      .fn()
      .mockResolvedValue(await services.assistantConfiguration.summary());
    render(<AssistantConfigurationPage services={services} />);

    const search = await screen.findByRole("searchbox", {
      name: "Buscar modelos de texto para Ask AI",
    });
    await user.type(search, "tools");
    expect(
      await screen.findByRole("checkbox", { name: /No tools/ }),
    ).toBeVisible();
    await user.clear(search);
    await user.type(search, "mini");
    const textModel = await screen.findByRole("checkbox", {
      name: /GPT-5 mini/,
    });
    expect(textModel).not.toBeChecked();
    expect(screen.queryByRole("checkbox", { name: "GPT-5" })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: /Audio only/ })).toBeNull();
    expect(
      screen.getByText(
        /modelo predeterminado configurado.*permanece disponible/i,
      ),
    ).toBeVisible();
    await user.click(textModel);
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(services.assistantConfiguration.saveGlobal).toHaveBeenCalledWith(
        expect.objectContaining({ allowedModels: ["openai/gpt-5-mini"] }),
      ),
    );
  });

  it("keeps tenant model choices inherited and disables the list until inheritance is turned off", async () => {
    const user = userEvent.setup();
    const services = servicesWithSummary([
      { tenantId: 101, model: "test/chat" },
    ]);
    const summary = {
      ...(await services.assistantConfiguration.summary()),
      canManageGlobal: false,
      manageableTenantIds: [101],
      global: {
        ...(await services.assistantConfiguration.summary()).global!,
        allowedModels: ["openai/gpt-5-mini"],
      },
    };
    services.assistantConfiguration.summary = vi
      .fn()
      .mockResolvedValue(summary);
    services.assistantConfiguration.models = vi.fn().mockResolvedValue([
      {
        id: "openai/gpt-5-mini",
        name: "GPT-5 mini",
        contextLength: 128_000,
        inputPricePerMillion: 0.25,
        outputPricePerMillion: 2,
        modalities: { text: true, image: true, audio: false, file: false },
        supportsTools: true,
      },
    ]);
    services.assistantConfiguration.saveTenantOverride = vi
      .fn()
      .mockResolvedValue(summary);
    render(
      <AssistantConfigurationPanel
        services={services}
        embedded
        tenantId={101}
      />,
    );

    const inherit = await screen.findByRole("checkbox", {
      name: "Heredar modelos habilitados de global",
    });
    expect(inherit).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /GPT-5 mini/ })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /GPT-5 mini/ })).toBeChecked();
    await user.click(inherit);
    expect(inherit).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /GPT-5 mini/ })).toBeEnabled();
    await user.click(inherit);
    expect(inherit).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /GPT-5 mini/ })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(
        services.assistantConfiguration.saveTenantOverride,
      ).toHaveBeenCalledWith(
        101,
        expect.objectContaining({ allowedModels: null }),
      ),
    );
  });

  it("saves Ask AI model choices without requiring a custom global key", async () => {
    const user = userEvent.setup();
    const services = servicesWithSummary();
    const initial = await services.assistantConfiguration.summary();
    const fallbackSummary = {
      ...initial,
      global: {
        ...initial.global!,
        keyState: "deployment_fallback" as const,
        allowedModels: null,
      },
    };
    services.assistantConfiguration.summary = vi
      .fn()
      .mockResolvedValue(fallbackSummary);
    services.assistantConfiguration.models = vi.fn().mockResolvedValue([
      {
        id: "openai/text-without-tools",
        name: "Text without tools",
        contextLength: 64_000,
        inputPricePerMillion: 1,
        outputPricePerMillion: 2,
        modalities: { text: true, image: false, audio: false, file: false },
        supportsTools: false,
      },
    ]);
    services.assistantConfiguration.saveGlobal = vi
      .fn()
      .mockResolvedValue(fallbackSummary);
    render(
      <AssistantConfigurationPanel services={services} embedded globalOnly />,
    );

    await user.click(
      await screen.findByRole("checkbox", { name: /Text without tools/ }),
    );
    await user.click(
      screen.getByRole("button", { name: "Guardar modelos habilitados" }),
    );

    await waitFor(() =>
      expect(services.assistantConfiguration.saveGlobal).toHaveBeenCalledWith({
        allowedModels: ["openai/text-without-tools"],
      }),
    );
  });
});

function render(ui: ReactElement) {
  return testingRender(ui, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <I18nContextProvider
        value={{
          translate: (key: string) => key,
          changeLocale: async () => {},
          getLocale: () => "es",
        }}
      >
        {children}
      </I18nContextProvider>
    ),
  });
}

function LocaleSwitcher() {
  const setLocale = useSetLocale();
  return (
    <>
      <button onClick={() => setLocale("es")}>ES</button>
      <button onClick={() => setLocale("pt")}>PT</button>
    </>
  );
}
it("switches assistant settings without losing an unsaved key or model identifier", async () => {
  const user = userEvent.setup();
  const services = servicesWithSummary();
  testingRender(
    <StoreContextProvider value={memoryStore({ locale: "en" })}>
      <AppLocaleProvider>
        <LocaleSwitcher />
        <AssistantConfigurationPage services={services} />
      </AppLocaleProvider>
    </StoreContextProvider>,
  );
  const input = await screen.findByLabelText("OpenRouter key");
  await user.type(input, "sk-unsaved-example");
  await user.click(screen.getByText("ES"));
  expect(await screen.findByLabelText("Clave OpenRouter")).toHaveValue(
    "sk-unsaved-example",
  );
  await user.click(screen.getByText("PT"));
  expect(await screen.findByLabelText("Chave OpenRouter")).toHaveValue(
    "sk-unsaved-example",
  );
  expect(services.assistantConfiguration.summary).toHaveBeenCalledTimes(1);
  expect(services.assistantConfiguration.saveGlobal).not.toHaveBeenCalled();
});

describe("assistant configuration background reads", () => {
  it.each([401, 403])(
    "clears loaded configuration and drafts when a refresh is denied with %i",
    async (status) => {
      const user = userEvent.setup();
      const services = servicesWithSummary();
      const initial = await services.assistantConfiguration.summary();
      services.assistantConfiguration.summary = vi
        .fn()
        .mockResolvedValueOnce(initial)
        .mockRejectedValueOnce(
          new ApiClientError(status, "denied", "Permission revoked"),
        );
      render(<AssistantConfigurationPage services={services} />);
      const keyInput = await screen.findByLabelText("Clave OpenRouter");
      await user.type(keyInput, "unsaved-secret");

      await act(async () => {
        await realtimeRefreshes.get("settings:0")?.();
      });

      expect(screen.getByRole("alert")).toBeVisible();
      expect(screen.queryByLabelText("Clave OpenRouter")).toBeNull();
      expect(screen.queryByText("deepseek/deepseek-v4-flash")).toBeNull();
    },
  );

  it("keeps loaded settings mounted while a clean background read is pending", async () => {
    const services = servicesWithSummary();
    const initial = await services.assistantConfiguration.summary();
    let resolveRefresh: ((value: typeof initial) => void) | undefined;
    services.assistantConfiguration.summary = vi
      .fn()
      .mockResolvedValueOnce(initial)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRefresh = resolve;
          }),
      );
    render(<AssistantConfigurationPage services={services} />);
    await screen.findByLabelText("Clave OpenRouter");
    const tabList = screen.getByRole("tablist");

    let refresh: Promise<unknown> | undefined;
    act(() => {
      refresh = Promise.resolve(realtimeRefreshes.get("settings:0")?.());
    });
    await waitFor(() =>
      expect(services.assistantConfiguration.summary).toHaveBeenCalledTimes(2),
    );

    expect(screen.getByRole("tablist")).toBe(tabList);
    expect(screen.getByRole("status")).toHaveTextContent(
      /actualizando|updating/i,
    );
    await act(async () => resolveRefresh?.(initial));
    await refresh;
    expect(screen.getByRole("tablist")).toBe(tabList);
  });

  it("keeps a dirty key and loaded settings after a refresh fails", async () => {
    const user = userEvent.setup();
    const services = servicesWithSummary();
    const initial = await services.assistantConfiguration.summary();
    services.assistantConfiguration.summary = vi
      .fn()
      .mockResolvedValueOnce(initial)
      .mockRejectedValueOnce(new Error("Network unavailable"));
    render(<AssistantConfigurationPage services={services} />);
    const keyInput = await screen.findByLabelText("Clave OpenRouter");
    await user.type(keyInput, "unsaved-secret");
    const tabList = screen.getByRole("tablist");

    await act(async () => {
      await realtimeRefreshes.get("settings:0")?.();
    });

    expect(screen.getByRole("tablist")).toBe(tabList);
    expect(screen.getByLabelText("Clave OpenRouter")).toHaveValue(
      "unsaved-secret",
    );
    expect(screen.getByRole("status")).toHaveTextContent("Network unavailable");
  });

  it("ignores an older read that settles after the newer settings read", async () => {
    const services = servicesWithSummary();
    const initial = await services.assistantConfiguration.summary();
    let resolveOlder: ((value: typeof initial) => void) | undefined;
    let resolveNewer: ((value: typeof initial) => void) | undefined;
    services.assistantConfiguration.summary = vi
      .fn()
      .mockResolvedValueOnce(initial)
      .mockImplementationOnce(
        () => new Promise((resolve) => (resolveOlder = resolve)),
      )
      .mockImplementationOnce(
        () => new Promise((resolve) => (resolveNewer = resolve)),
      );
    render(<AssistantConfigurationPage services={services} />);
    await screen.findByLabelText("Clave OpenRouter");
    const refresh = realtimeRefreshes.get("settings:0");
    let older: Promise<unknown> | undefined;
    let newer: Promise<unknown> | undefined;
    act(() => {
      older = Promise.resolve(refresh?.());
      newer = Promise.resolve(refresh?.());
    });
    await waitFor(() =>
      expect(services.assistantConfiguration.summary).toHaveBeenCalledTimes(3),
    );

    const updated = {
      ...initial,
      global: { ...initial.global!, model: "newer/model" },
    };
    await act(async () => resolveNewer?.(updated));
    await newer;
    await act(async () => resolveOlder?.(initial));
    await older;

    expect(screen.getByLabelText("Modelo global")).toHaveValue("newer/model");
  });
});
