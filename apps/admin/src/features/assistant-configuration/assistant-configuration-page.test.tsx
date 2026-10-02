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
  render as testingRender,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppServices } from "@/app-services";
import { AssistantConfigurationPage } from "./assistant-configuration-page";

afterEach(cleanup);

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
          updatedAt: "2026-09-03T12:00:00.000Z",
          updatedBy: "platform-admin",
        },
        tenants: overrides.map((override) => ({
          scope: "tenant",
          keyState: "not_configured",
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
