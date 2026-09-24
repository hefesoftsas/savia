import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { render } from "./locale-test-render";
import type { PluginApi } from "@savia/studio-shared/plugin-api";
import { storePortScreens } from "@savia/release-catalog/test-fixtures";
afterEach(cleanup);
const account = {
  id: "a",
  _version: 4,
  name: "AC-01",
  customer: "Example Client",
  due_date: "2026-09-01",
  amount: 100,
  paid: 20,
  stage: "pending",
};
function setup(
  extension: string,
  records: Record<string, unknown>[] = [account],
) {
  const collection = {
    describe: vi.fn().mockResolvedValue({ name: "test" }),
    list: vi.fn().mockImplementation(async () => ({
      data: records,
      total: records.length,
    })),
    update: vi.fn().mockResolvedValue({}),
    create: vi.fn().mockResolvedValue({}),
  };
  const api = {
    collections: { collection: () => collection },
  } as unknown as PluginApi;
  const Screen = storePortScreens.find(
    (item) => item.extensionId === extension,
  )!.Screen;
  render(<Screen savia={api} />);
  return collection;
}
describe("insurance operations screens", () => {
  it("saves a partial payment with the record version and refreshes", async () => {
    const collection = setup("insurance.collections");
    fireEvent.click(
      await screen.findByRole("button", { name: "Gestionar AC-01" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Guardar cambios" }),
      ).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Registrar abono" }));
    fireEvent.change(screen.getByLabelText("Valor del abono (COP)"), {
      target: { value: "30.25" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar abono" }));
    await waitFor(() =>
      expect(collection.update).toHaveBeenCalledWith(
        "a",
        {
          paid: 50.25,
          last_payment_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        },
        { version: 4 },
      ),
    );
    expect(await screen.findByText("Cambios guardados.")).toBeInTheDocument();
  });
  it("retains entered data on conflict and never reports a failed save as success", async () => {
    const collection = setup("insurance.collections");
    collection.update.mockRejectedValue(new Error("Conflicto de versión"));
    fireEvent.click(
      await screen.findByRole("button", { name: "Gestionar AC-01" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Guardar cambios" }),
      ).toBeEnabled(),
    );
    fireEvent.change(screen.getByLabelText("Notas de gestión"), {
      target: { value: "Call tomorrow" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Conflicto de versión",
    );
    expect(screen.getByLabelText("Notas de gestión")).toHaveValue(
      "Call tomorrow",
    );
    expect(screen.queryByText("Cambios guardados.")).not.toBeInTheDocument();
  });
  it("blocks renewal closure without an outcome then persists the completed case", async () => {
    const collection = setup("insurance.renewals", [
      {
        id: "r",
        _version: 2,
        name: "RN-01",
        customer: "Client",
        policy_reference: "POL-1",
        expiry_date: "2026-10-01",
        premium: 100,
        stage: "pending",
      },
    ]);
    fireEvent.click(
      await screen.findByRole("button", { name: "Gestionar RN-01" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Guardar cambios" }),
      ).toBeEnabled(),
    );
    fireEvent.change(screen.getByLabelText(/^Etapa/), {
      target: { value: "renewed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Indica la nueva póliza",
    );
    expect(collection.update).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Nueva póliza o motivo de cierre"), {
      target: { value: "POL-2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() =>
      expect(collection.update).toHaveBeenCalledWith(
        "r",
        expect.objectContaining({ stage: "renewed", outcome: "POL-2" }),
        { version: 2 },
      ),
    );
  });
  it("searches and clears empty filters without hiding the recovery action", async () => {
    setup("insurance.collections");
    await screen.findByText("Example Client");
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "missing" },
    });
    expect(screen.getByText("No hay coincidencias")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Limpiar filtros" }));
    expect(screen.getByText("Example Client")).toBeInTheDocument();
  });
});
it("creates a new account through the host and sends numeric amounts", async () => {
  const collection = setup("insurance.collections", []);
  await screen.findByText("Tu gestión de cartera empieza aquí");
  fireEvent.click(screen.getByRole("button", { name: "Nueva cuenta" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Guardar cambios" }),
    ).toBeEnabled(),
  );
  fireEvent.change(screen.getByLabelText(/^Referencia/), {
    target: { value: "AC-02" },
  });
  fireEvent.change(screen.getByLabelText(/^Cliente/), {
    target: { value: "New client" },
  });
  fireEvent.change(screen.getByLabelText(/^Vencimiento/), {
    target: { value: "2026-10-01" },
  });
  fireEvent.change(screen.getByLabelText(/^Valor de la cuenta/), {
    target: { value: "100.25" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
  await waitFor(() =>
    expect(collection.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "AC-02",
        customer: "New client",
        due_date: "2026-10-01",
        amount: 100.25,
        paid: 0,
      }),
    ),
  );
});
it("shows a recoverable error when collection discovery fails", async () => {
  const collection = setup("insurance.collections");
  await screen.findByText("Example Client");
  collection.describe.mockResolvedValue(undefined);
  fireEvent.click(screen.getByRole("button", { name: "Actualizar lista" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Repara la instalación",
  );
  expect(screen.getByRole("button", { name: "Nueva cuenta" })).toBeDisabled();
  collection.describe.mockResolvedValue({ name: "test" });
  fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
  expect(await screen.findByText("Example Client")).toBeInTheDocument();
});
it("refuses a write without an optimistic version", async () => {
  const collection = setup("insurance.collections", [
    { ...account, _version: undefined },
  ]);
  fireEvent.click(
    await screen.findByRole("button", { name: "Gestionar AC-01" }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Guardar cambios" }),
    ).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Falta la versión",
  );
  expect(collection.update).not.toHaveBeenCalled();
});

it.each([
  [
    "claims",
    {
      name: "CL-1",
      customer: "Example",
      policy_reference: "P-1",
      incident_date: "2026-09-01",
      amount: 100,
      paid: 0,
      stage: "reported",
    },
  ],
  [
    "commissions",
    {
      name: "CM-1",
      customer: "Example",
      policy_reference: "P-1",
      amount: 100,
      paid: 0,
      seller_share: 20,
      due_date: "2026-09-19",
      stage: "pending",
    },
  ],
  [
    "endorsements",
    {
      name: "EN-1",
      customer: "Example",
      policy_reference: "P-1",
      kind: "coverage",
      requested_date: "2026-09-01",
      effective_date: "2026-09-19",
      additional_premium: 0,
      refund: 0,
      stage: "requested",
    },
  ],
  [
    "opportunities",
    {
      name: "OP-1",
      customer: "Example",
      owner: "Adviser",
      target_date: "2026-09-19",
      premium: 100,
      probability: 25,
      stage: "lead",
    },
  ],
  [
    "activities",
    {
      name: "Call",
      owner: "Adviser",
      due_date: "2026-09-19",
      kind: "call",
      importance: "normal",
      stage: "scheduled",
    },
  ],
  [
    "issuance",
    {
      name: "ISS-1",
      customer: "Example",
      owner: "Adviser",
      requested_date: "2026-09-01",
      due_date: "2026-09-10",
      effective_date: "2026-09-05",
      end_date: "2027-09-05",
      premium: 100,
      stage: "requested",
    },
  ],
  [
    "documents",
    {
      name: "Signed application",
      customer: "Example",
      policy_reference: "ISS-1",
      owner: "Adviser",
      requested_date: "2026-09-01",
      due_date: "2026-09-10",
      kind: "application",
      stage: "requested",
    },
  ],
  [
    "service",
    {
      name: "SR-1",
      customer: "Example",
      owner: "Adviser",
      kind: "query",
      channel: "email",
      received_date: "2026-09-01",
      due_date: "2026-09-10",
      stage: "received",
    },
  ],
] as const)(
  "edits the %s worklist through its owning collection",
  async (name, input) => {
    const collection = setup(`insurance.${name}`, [
      { ...input, id: "case", _version: 2 },
    ]);
    fireEvent.click(
      await screen.findByRole("button", { name: `Gestionar ${input.name}` }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Guardar cambios" }),
      ).toBeEnabled(),
    );
    fireEvent.change(screen.getByLabelText("Notas de gestión"), {
      target: { value: "Next action recorded" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() =>
      expect(collection.update).toHaveBeenCalledWith(
        "case",
        expect.objectContaining({ notes: "Next action recorded" }),
        { version: 2 },
      ),
    );
  },
);

it("keeps an issuance editor open until delivery evidence is provided", async () => {
  const collection = setup("insurance.issuance", [
    {
      id: "issue",
      _version: 3,
      name: "ISS-2",
      customer: "Client",
      owner: "Adviser",
      requested_date: "2026-09-01",
      due_date: "2026-09-10",
      effective_date: "2026-09-05",
      end_date: "2027-09-05",
      premium: 100,
      stage: "issued",
      issued_date: "2026-09-03",
      policy_reference: "POL-1",
    },
  ]);
  fireEvent.click(
    await screen.findByRole("button", { name: "Gestionar ISS-2" }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Guardar cambios" }),
    ).toBeEnabled(),
  );
  fireEvent.change(screen.getByLabelText(/^Etapa/), {
    target: { value: "delivered" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
  expect(screen.getByLabelText(/^Fecha de entrega/)).toBeInvalid();
  expect(collection.update).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText(/^Fecha de entrega/), {
    target: { value: "2026-09-04" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
  await waitFor(() =>
    expect(collection.update).toHaveBeenCalledWith(
      "issue",
      expect.objectContaining({
        stage: "delivered",
        delivered_date: "2026-09-04",
      }),
      { version: 3 },
    ),
  );
});
it("requires document evidence before recording receipt", async () => {
  const collection = setup("insurance.documents", [
    {
      id: "document",
      _version: 1,
      name: "Signed form",
      customer: "Client",
      owner: "Adviser",
      requested_date: "2026-09-01",
      due_date: "2026-09-10",
      kind: "application",
      stage: "requested",
    },
  ]);
  fireEvent.click(
    await screen.findByRole("button", { name: "Gestionar Signed form" }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Guardar cambios" }),
    ).toBeEnabled(),
  );
  fireEvent.change(screen.getByLabelText(/^Etapa/), {
    target: { value: "received" },
  });
  fireEvent.change(screen.getByLabelText(/^Fecha de recepción/), {
    target: { value: "2026-09-03" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
  expect(screen.getByLabelText(/^Referencia del archivo/)).toBeInvalid();
  expect(collection.update).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText(/^Referencia del archivo/), {
    target: { value: "FILE-4" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
  await waitFor(() =>
    expect(collection.update).toHaveBeenCalledWith(
      "document",
      expect.objectContaining({
        stage: "received",
        evidence_reference: "FILE-4",
      }),
      { version: 1 },
    ),
  );
});
it("creates a service request with explicit channel and response commitment", async () => {
  const collection = setup("insurance.service", []);
  fireEvent.click(
    await screen.findByRole("button", { name: "Nueva solicitud" }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Guardar cambios" }),
    ).toBeEnabled(),
  );
  for (const [label, value] of [
    [/^Referencia/, "SR-2"],
    [/^Cliente/, "Client"],
    [/^Responsable(?: \*)?$/, "Adviser"],
    [/^Fecha de recepción/, "2026-09-01"],
    [/^Compromiso de respuesta/, "2026-09-10"],
  ] as const)
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
  await waitFor(() =>
    expect(collection.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "SR-2",
        channel: "email",
        kind: "query",
        stage: "received",
        due_date: "2026-09-10",
      }),
    ),
  );
});

it("selects actual related records and persists their IDs without replacing historical text", async () => {
  const current = { ...account, customer_id: "client-1" };
  const own = {
    describe: vi.fn().mockResolvedValue({
      name: "insurance_receivables",
      config: {
        fields: {
          customer_id: {
            type: "Dropdown",
            label: "Cliente vinculado",
            config: { relation: "clientes" },
          },
        },
      },
    }),
    list: vi.fn().mockResolvedValue({ data: [current], total: 1 }),
    update: vi.fn().mockResolvedValue({}),
  };
  const clients = {
    describe: vi.fn().mockResolvedValue({ name: "clientes" }),
    list: vi.fn().mockResolvedValue({
      data: [
        { id: "client-1", name: "Client One" },
        { id: "client-2", name: "Client Two" },
      ],
      total: 2,
    }),
  };
  const savia = {
    collections: {
      collection: (name: string) => (name === "clientes" ? clients : own),
    },
  } as unknown as PluginApi;
  const Screen = storePortScreens.find(
    (s) => s.extensionId === "insurance.collections",
  )!.Screen;
  render(<Screen savia={savia} />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Gestionar AC-01" }),
  );
  fireEvent.change(await screen.findByLabelText("Cliente vinculado"), {
    target: { value: "client-2" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
  await waitFor(() =>
    expect(own.update).toHaveBeenCalledWith(
      "a",
      expect.objectContaining({
        customer_id: "client-2",
        customer: "Example Client",
      }),
      { version: 4 },
    ),
  );
});
