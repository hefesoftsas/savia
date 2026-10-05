import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { render } from "@/features/studio-engine/test/locale-test-render";
import type { VirtualEmployee } from "@/api/virtual-employees-client";
import type { AppLocale } from "@/i18n/app-locale";
import { VirtualEmployeesManagement } from "./virtual-employees-management";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

afterEach(cleanup);

function makeEmployee(
  allowedCollections = ["customers", "quotes"],
): VirtualEmployee {
  return {
    id: "employee-1",
    agencyId: 4,
    name: "Sofía",
    handle: "ventas",
    position: "Sales specialist",
    avatar: "briefcase",
    greeting: null,
    systemPrompt: "Help with sales.",
    allowedCollections,
    model: null,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    createdBy: "owner-1",
    filesCount: 0,
    files: [],
  };
}

function setup({
  employees = [],
  locale = "es",
}: {
  employees?: VirtualEmployee[];
  locale?: AppLocale;
} = {}) {
  const client = {
    list: vi.fn().mockResolvedValue(employees),
    listCollections: vi.fn().mockResolvedValue([
      { name: "customers", label: "Customers" },
      { name: "quotes", label: "Quotes" },
    ]),
    get: vi.fn(async () => ({ ...makeEmployee(), files: [] })),
    create: vi.fn().mockResolvedValue(makeEmployee([])),
    update: vi.fn().mockResolvedValue(makeEmployee()),
    delete: vi.fn(),
    uploadFile: vi.fn(),
    deleteFile: vi.fn(),
  };
  render(
    <VirtualEmployeesManagement
      client={client as never}
      assistantConfigClient={{ models: vi.fn().mockResolvedValue([]) } as never}
    />,
    { locale },
  );
  return { client };
}

describe("virtual employee access modes", () => {
  it.each([
    [
      "es",
      "Solo texto",
      "Herramientas del espacio de trabajo",
      "Nuevo Empleado",
    ],
    ["en", "Text only", "Workspace tools", "New Employee"],
    [
      "pt",
      "Somente texto",
      "Ferramentas do espaço de trabalho",
      "Novo Funcionário",
    ],
  ] as const)(
    "localizes the mode choices in %s",
    async (locale, textOnly, workspace, createLabel) => {
      const user = userEvent.setup();
      setup({ locale });

      await user.click(
        await screen.findByRole("button", { name: createLabel }),
      );
      await user.click(
        await screen.findByRole("button", {
          name: new RegExp(textOnly, "i"),
        }),
      );

      expect(screen.getByRole("button", { name: workspace })).toBeVisible();
    },
  );

  it("saves text-only mode as an empty collection allowlist", async () => {
    const user = userEvent.setup();
    const { client } = setup();

    await user.click(
      await screen.findByRole("button", { name: "Nuevo Empleado" }),
    );
    await user.click(screen.getByRole("button", { name: "Solo texto" }));

    expect(
      screen.queryByRole("tab", { name: "Colecciones" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "Base RAG" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/solo se procesa el texto y las instrucciones/i),
    ).toBeVisible();

    await user.type(screen.getByLabelText("Nombre Visible"), "Proofreader");
    await user.type(
      screen.getByLabelText("Identificador para Mención (@handle)"),
      "proofreader",
    );
    await user.click(screen.getByRole("tab", { name: "Rol & Prompt" }));
    await user.type(
      screen.getByLabelText("Instrucciones de Rol (System Prompt)"),
      "Use only supplied text.",
    );
    await user.click(screen.getByRole("button", { name: "Crear Empleado" }));

    await waitFor(() => expect(client.create).toHaveBeenCalledOnce());
    expect(client.create.mock.calls[0][0]).toMatchObject({
      name: "Proofreader",
      handle: "proofreader",
      allowedCollections: [],
    });
  });

  it("preserves an existing workspace employee's selected collections", async () => {
    const user = userEvent.setup();
    const employee = makeEmployee();
    const { client } = setup({ employees: [employee], locale: "en" });

    await user.click(await screen.findByRole("button", { name: "Edit" }));
    await screen.findByRole("dialog");
    expect(
      screen.getByRole("button", { name: "Workspace tools" }),
    ).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("tab", { name: "Collections" }));
    expect(screen.getByText("2 selected")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(client.update).toHaveBeenCalledOnce());
    expect(client.update.mock.calls[0][1]).toMatchObject({
      allowedCollections: ["customers", "quotes"],
    });
  });

  it.each([null, "provider/admin-model"])(
    "does not resend an unchanged employee model (%s) when editing its prompt",
    async (model) => {
      const user = userEvent.setup();
      const employee = { ...makeEmployee([]), model };
      const { client } = setup({ employees: [employee], locale: "en" });
      await user.click(await screen.findByRole("button", { name: "Edit" }));
      await user.click(screen.getByRole("tab", { name: "Role & Prompt" }));
      await user.type(
        screen.getByLabelText("Role Instructions (System Prompt)"),
        " Be concise.",
      );
      await user.click(screen.getByRole("button", { name: "Save Changes" }));
      await waitFor(() => expect(client.update).toHaveBeenCalledOnce());
      expect(client.update.mock.calls[0][1]).not.toHaveProperty("model");
      expect(client.update.mock.calls[0][1].systemPrompt).toContain(
        "Be concise.",
      );
    },
  );

  it("opens an empty-allowlist employee in text-only mode without loading files", async () => {
    const user = userEvent.setup();
    const { client } = setup({ employees: [makeEmployee([])] });

    await user.click(await screen.findByRole("button", { name: "Editar" }));
    await screen.findByRole("dialog");

    expect(screen.getByRole("button", { name: "Solo texto" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.queryByRole("tab", { name: "Colecciones" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Base RAG" })).toBeNull();
    expect(client.get).not.toHaveBeenCalled();
  });

  it("does not expand scope when switching from text-only to workspace mode", async () => {
    const user = userEvent.setup();
    const { client } = setup();

    await user.click(
      await screen.findByRole("button", { name: "Nuevo Empleado" }),
    );
    await user.click(screen.getByRole("button", { name: "Solo texto" }));
    await user.click(
      screen.getByRole("button", {
        name: "Herramientas del espacio de trabajo",
      }),
    );
    await user.click(screen.getByRole("tab", { name: "Colecciones" }));
    expect(screen.getByRole("switch")).not.toBeChecked();

    await user.click(screen.getByRole("tab", { name: "Perfil" }));
    await user.type(screen.getByLabelText("Nombre Visible"), "Proofreader");
    await user.type(
      screen.getByLabelText("Identificador para Mención (@handle)"),
      "proofreader",
    );
    await user.click(screen.getByRole("tab", { name: "Rol & Prompt" }));
    await user.type(
      screen.getByLabelText("Instrucciones de Rol (System Prompt)"),
      "Use only supplied text.",
    );
    await user.click(screen.getByRole("button", { name: "Crear Empleado" }));

    expect(client.create).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("Elige al menos una colección"),
    );
  });

  it("fills a translator draft without creating or overwriting an employee", async () => {
    const user = userEvent.setup();
    const { client } = setup({ employees: [makeEmployee()] });

    await user.click(
      await screen.findByRole("button", {
        name: "Plantilla: Traductor español → inglés",
      }),
    );

    expect(screen.getByLabelText("Nombre Visible")).toHaveValue(
      "Traductor español → inglés",
    );
    expect(
      screen.getByLabelText("Identificador para Mención (@handle)"),
    ).toHaveValue("traductor");
    expect(screen.getByRole("button", { name: "Solo texto" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(client.create).not.toHaveBeenCalled();
    expect(client.update).not.toHaveBeenCalled();
  });
});
