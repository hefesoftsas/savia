import {
  cleanup,
  render,
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
  overrides: Array<{ agencyId: number; model: string | null }> = [],
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
        agencies: overrides.map((override) => ({
          scope: "agency",
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
      activeAgency: vi.fn().mockResolvedValue({
        agencies: [{ id: 101, name: "Agencia Norte" }],
      }),
      saveGlobal: vi.fn(),
      saveAgencyOverride: vi.fn(),
      clearAgencyOverride: vi.fn(),
    },
  } as unknown as Pick<AppServices, "assistantConfiguration">;
}

describe("AssistantConfigurationPage", () => {
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
      agencies: [],
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
      agencies: [],
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

  it("requires confirmation before deleting an agency override", async () => {
    const user = userEvent.setup();
    render(
      <AssistantConfigurationPage
        services={servicesWithSummary([
          { agencyId: 101, model: "openai/gpt-5" },
        ])}
      />,
    );

    await user.click(await screen.findByRole("tab", { name: /Por agencia/i }));
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
      agencies: [],
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
      agencies: [],
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

  it("can release only an agency key while retaining its local model", async () => {
    const user = userEvent.setup();
    const services = servicesWithSummary([
      { agencyId: 101, model: "openai/gpt-5" },
    ]);
    services.assistantConfiguration.summary = vi.fn().mockResolvedValue({
      global: null,
      agencies: [
        {
          scope: "agency",
          agencyId: 101,
          keyState: "configured",
          model: "openai/gpt-5",
          updatedAt: "2026-09-03T12:00:00.000Z",
          updatedBy: "platform-admin",
        },
      ],
    });
    render(<AssistantConfigurationPage services={services} />);

    await user.click(await screen.findByRole("tab", { name: /Por agencia/i }));
    await screen.findByRole("button", { name: "Volver a heredar" });
    await user.click(screen.getByLabelText("Heredar clave global"));
    await user.click(
      screen.getAllByRole("button", { name: "Guardar" }).at(-1)!,
    );

    await waitFor(() =>
      expect(
        services.assistantConfiguration.saveAgencyOverride,
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
    expect(option).toHaveTextContent("Entrada US$2.50 / 1M");
    expect(option).toHaveTextContent("Salida US$10 / 1M");

    await user.click(option);
    expect(model).toHaveValue("openai/gpt-5");
  });
});
