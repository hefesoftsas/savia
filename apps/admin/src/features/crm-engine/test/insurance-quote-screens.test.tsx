// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PluginApi } from "@savia/crm-shared/plugin-api";
import { releaseCatalog } from "@savia/release-catalog";

afterEach(cleanup);

function quoteScreenApi(
  options: {
    connections?: unknown[];
    runs?: unknown[];
    vehicleLookup?: { enabled: boolean };
  } = {},
) {
  const actions = {
    execute: vi.fn(),
    list: vi.fn().mockResolvedValue(options.runs ?? []),
  };
  const settings = {
    get: vi.fn().mockResolvedValue({
      value: {
        quotePages: { direct: true, wizard: true },
        vehicleLookup: options.vehicleLookup ?? { enabled: true },
        products: [
          {
            id: "sbs-product-8",
            label: "Autos Producto 8",
            enabled: true,
            rank: 10,
          },
          {
            id: "sbs-product-10",
            label: "Autos Gold",
            enabled: true,
            rank: 20,
          },
        ],
      },
      version: 1,
      updatedAt: null,
    }),
    replace: vi.fn(async (value, version) => ({
      value,
      version: Number(version) + 1,
      updatedAt: "2026-09-16T00:00:00.000Z",
    })),
  };
  const connections = {
    list: vi.fn().mockResolvedValue(options.connections ?? []),
    replace: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  };
  const recordsStore: Record<string, Record<string, unknown>[]> = {};
  const mockCollectionHandles: Record<
    string,
    {
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      get: ReturnType<typeof vi.fn>;
      list: ReturnType<typeof vi.fn>;
      remove: ReturnType<typeof vi.fn>;
      describe: ReturnType<typeof vi.fn>;
    }
  > = {};

  const getCollectionHandle = (name: string) => {
    if (!mockCollectionHandles[name]) {
      recordsStore[name] = recordsStore[name] ?? [];
      mockCollectionHandles[name] = {
        create: vi.fn(async (data: Record<string, unknown>) => {
          const record = {
            id: `${name}-${recordsStore[name].length + 1}`,
            _version: 1,
            ...data,
          };
          recordsStore[name].push(record);
          return record;
        }),
        update: vi.fn(async (id: string, data: Record<string, unknown>) => {
          const idx = recordsStore[name].findIndex((r) => r.id === id);
          if (idx >= 0) {
            recordsStore[name][idx] = {
              ...recordsStore[name][idx],
              ...data,
              _version: Number(recordsStore[name][idx]._version ?? 0) + 1,
            };
            return recordsStore[name][idx];
          }
          const record = { id, _version: 1, ...data };
          recordsStore[name].push(record);
          return record;
        }),
        get: vi.fn(async (id: string) =>
          recordsStore[name].find((r) => r.id === id),
        ),
        list: vi.fn(async (options?: { page?: number; perPage?: number }) => {
          const page = options?.page ?? 1;
          const perPage = options?.perPage ?? 25;
          return {
            data: recordsStore[name].slice(
              (page - 1) * perPage,
              page * perPage,
            ),
            total: recordsStore[name].length,
            page,
            perPage,
          };
        }),
        remove: vi.fn(async () => {}),
        describe: vi.fn(),
      };
    }
    return mockCollectionHandles[name];
  };

  const collections = {
    list: vi.fn(),
    collection: vi.fn((name: string) => getCollectionHandle(name)),
  };
  const savia = {
    settings,
    connections,
    actions,
    collections,
    services: { get: vi.fn() },
  } as unknown as PluginApi;
  return {
    savia,
    actions,
    connections,
    settings,
    collections,
    recordsStore,
    getCollectionHandle,
  };
}

function quoteScreen(
  object: "cotizador" | "cotizador_por_pasos" | "administrar_seguros",
) {
  const contribution = releaseCatalog.extensionScreens.find(
    (screen) => screen.object === object && screen.view === "records",
  );
  if (!contribution) throw new Error(`No existe la pantalla ${object}.`);
  return contribution.Screen;
}

it("reuses the three-step wizard from direct and wizard entries", async () => {
  const { savia } = quoteScreenApi();
  const DirectScreen = quoteScreen("cotizador");
  const WizardScreen = quoteScreen("cotizador_por_pasos");
  const direct = render(<DirectScreen savia={savia} />);

  expect(
    await screen.findByRole("heading", { name: "Cotizador" }),
  ).toBeVisible();
  expect(
    screen.getByRole("heading", { name: "Paso 1 de 3: Vehículo" }),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "Siguiente paso" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Cotizaciones" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Historial" })).toBeVisible();
  expect(
    screen.queryByText("Se guardará al completar el último paso."),
  ).not.toBeInTheDocument();

  direct.unmount();
  render(<WizardScreen savia={savia} />);

  expect(
    await screen.findByRole("heading", { name: "Cotizador por pasos" }),
  ).toBeVisible();
  expect(
    screen.getByRole("heading", { name: "Paso 1 de 3: Vehículo" }),
  ).toBeVisible();
});

it("keeps the cotizador description in an accessible tooltip", async () => {
  const { savia } = quoteScreenApi();
  const WizardScreen = quoteScreen("cotizador_por_pasos");
  render(<WizardScreen savia={savia} />);

  const tooltip = await screen.findByRole("tooltip", {
    name: "Vehículo, tomador y comparador en un solo flujo en línea.",
  });
  expect(
    screen.getByRole("button", {
      name: "Información sobre el cotizador",
    }),
  ).toHaveAttribute("aria-describedby", tooltip.id);
});

it("sends every enabled insurance flow in one quote batch without connections", async () => {
  const user = userEvent.setup();
  const { actions, savia } = quoteScreenApi();
  actions.execute.mockResolvedValue({
    run: { runId: "quote-batch", status: "succeeded" },
    output: {
      type: "quote",
      provider: "SBS",
      status: "success",
      data: {
        quoteNumber: "SIM-BATCH",
        premiumTotal: 1200000,
        simulated: true,
      },
    },
  });
  const DirectScreen = quoteScreen("cotizador");
  render(<DirectScreen savia={savia} />);

  await screen.findByRole("heading", { name: "Paso 1 de 3: Vehículo" });
  await user.type(screen.getByLabelText("Placa"), "TESTCAR");
  await user.type(screen.getByLabelText("Código Fasecolda"), "123456");
  await user.type(screen.getByLabelText("Año del vehículo"), "2024");
  await user.type(
    screen.getByLabelText("Código de ciudad de circulación"),
    "11001",
  );
  await user.type(screen.getByLabelText("Valor asegurado"), "50000000");
  await user.click(screen.getByRole("button", { name: "Siguiente paso" }));
  await user.type(screen.getByLabelText("Número de documento"), "12345678");
  await user.type(screen.getByLabelText("Nombres"), "Ana");
  await user.type(screen.getByLabelText("Primer apellido"), "Pérez");
  await user.type(screen.getByLabelText("Fecha de nacimiento"), "1990-01-01");
  await user.click(screen.getByRole("button", { name: "Siguiente paso" }));
  await user.type(
    screen.getByLabelText("Código de ciudad de residencia"),
    "11001",
  );
  await user.type(screen.getByLabelText("Dirección"), "Calle 1 # 2-3");
  await user.type(screen.getByLabelText("Teléfono"), "3001234567");
  await user.type(
    screen.getByLabelText("Correo electrónico"),
    "ana@example.test",
  );
  expect(screen.queryByTitle("Modo de ejecución")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Cotizar" }));

  expect(actions.execute).toHaveBeenCalledTimes(20);
  expect(actions.execute).toHaveBeenCalledWith(
    "quote",
    expect.objectContaining({
      input: expect.objectContaining({
        mode: "live",
        flowId: "sbs-producto-8",
        quoteInput: expect.objectContaining({
          vehicle: expect.objectContaining({ plate: "TESTCAR" }),
        }),
      }),
    }),
  );
});

it("locks quote fields while the insurer batch is running", async () => {
  const user = userEvent.setup();
  const { actions, savia } = quoteScreenApi({
    vehicleLookup: { enabled: false },
  });
  actions.execute.mockImplementation(() => new Promise(() => {}));
  const DirectScreen = quoteScreen("cotizador_por_pasos");
  render(<DirectScreen savia={savia} />);

  await screen.findByRole("heading", { name: "Paso 1 de 3: Vehículo" });
  await user.type(screen.getByLabelText("Placa"), "TESTCAR");
  await user.type(screen.getByLabelText("Código Fasecolda"), "123456");
  await user.type(screen.getByLabelText("Año del vehículo"), "2024");
  await user.type(
    screen.getByLabelText("Código de ciudad de circulación"),
    "11001",
  );
  await user.type(screen.getByLabelText("Valor asegurado"), "50000000");
  await user.click(screen.getByRole("button", { name: "Siguiente paso" }));
  await user.type(screen.getByLabelText("Número de documento"), "12345678");
  await user.type(screen.getByLabelText("Nombres"), "Ana");
  await user.type(screen.getByLabelText("Primer apellido"), "Pérez");
  await user.type(screen.getByLabelText("Fecha de nacimiento"), "1990-01-01");
  await user.click(screen.getByRole("button", { name: "Siguiente paso" }));
  await user.type(
    screen.getByLabelText("Código de ciudad de residencia"),
    "11001",
  );
  await user.type(screen.getByLabelText("Dirección"), "Calle 1 # 2-3");
  await user.type(screen.getByLabelText("Teléfono"), "3001234567");
  await user.type(
    screen.getByLabelText("Correo electrónico"),
    "ana@example.test",
  );
  await user.click(screen.getByRole("button", { name: "Cotizar" }));

  await screen.findByText(/Cotizando con .*aseguradoras en vivo/);
  await user.click(screen.getByRole("button", { name: "Preparar cotización" }));
  expect(
    screen.getByLabelText("Código de ciudad de residencia"),
  ).toBeDisabled();
  expect(screen.getByLabelText("Dirección")).toBeDisabled();
  expect(screen.getByLabelText("Teléfono")).toBeDisabled();
  expect(screen.getByLabelText("Correo electrónico")).toBeDisabled();
});

it("keeps provider credentials out of package administration", async () => {
  const user = userEvent.setup();
  const { savia, settings } = quoteScreenApi();
  const AdminScreen = quoteScreen("administrar_seguros");
  render(<AdminScreen savia={savia} />);

  const lookup = await screen.findByLabelText("Flow de consulta de placa");
  await user.selectOptions(lookup, "equidad-vehicle-by-plate");
  await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

  expect(settings.replace).toHaveBeenCalledWith(
    expect.objectContaining({
      vehicleLookup: {
        enabled: true,
        flowId: "equidad-vehicle-by-plate",
      },
    }),
    1,
  );
  expect(screen.queryByText(/Credenciales de Sura/)).not.toBeInTheDocument();
  expect(
    screen.queryByText("Conexiones de proveedores"),
  ).not.toBeInTheDocument();
});

it("marks an unavailable provider as failed instead of rendering an empty result", async () => {
  const user = userEvent.setup();
  const { savia } = quoteScreenApi({
    runs: [
      {
        runId: "provider-unavailable",
        actionId: "quote",
        connectionId: "simulation",
        status: "succeeded",
        output: {
          type: "quote",
          provider: "SBS",
          status: "error",
          data: { errorCode: "FLOW_EXECUTION_FAILED" },
        },
        errorCode: null,
        createdAt: "2026-09-16T00:00:00.000Z",
        updatedAt: "2026-09-16T00:00:00.000Z",
      },
    ],
  });
  const DirectScreen = quoteScreen("cotizador");
  render(<DirectScreen savia={savia} />);

  await user.click(
    await screen.findByRole("button", { name: /^Cotizaciones/ }),
  );

  expect(
    await screen.findByRole("heading", { name: "Solicitudes de cotización" }),
  ).toBeVisible();
  await user.click(screen.getByText("Solicitudes de cotización"));

  expect(screen.getByText("✕ Falló")).toBeVisible();
  expect(
    screen.getByText("No se completó: FLOW_EXECUTION_FAILED."),
  ).toBeVisible();
});

it("separates history from cotizaciones and keeps request status collapsed", async () => {
  const user = userEvent.setup();
  const { savia, getCollectionHandle } = quoteScreenApi({
    runs: [
      {
        runId: "provider-unavailable",
        actionId: "quote",
        connectionId: "savia-request",
        status: "succeeded",
        output: {
          type: "quote",
          provider: "SBS",
          status: "error",
          data: { errorCode: "FLOW_EXECUTION_FAILED" },
        },
        errorCode: null,
        createdAt: "2026-09-16T00:00:00.000Z",
        updatedAt: "2026-09-16T00:00:00.000Z",
      },
    ],
  });
  await getCollectionHandle("cotizaciones").create({
    id: "cotizaciones-prev-1",
    name: "COT-20260910-REDACTD",
    placa: "REDACTD",
    estado: "Recibida",
  });
  const DirectScreen = quoteScreen("cotizador");
  render(<DirectScreen savia={savia} />);

  expect(
    screen.queryByText("Cotiza auto liviano en tres pasos."),
  ).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Ejecuciones reales")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Actualizar resultados" }),
  ).not.toBeInTheDocument();

  await user.click(
    await screen.findByRole("button", { name: /^Cotizaciones/ }),
  );
  expect(
    screen.queryByLabelText("Seleccionar cotización anterior"),
  ).not.toBeInTheDocument();
  expect(screen.queryByText("Cotizaciones guardadas:")).not.toBeInTheDocument();

  const statusSummary = screen.getByText("Solicitudes de cotización");
  expect(statusSummary.closest("details")).not.toHaveAttribute("open");
  await user.click(statusSummary);
  expect(statusSummary.closest("details")).toHaveAttribute("open");
  expect(await screen.findByRole("table")).toBeVisible();

  await user.click(screen.getByRole("button", { name: "Historial" }));
  expect(
    await screen.findByLabelText("Seleccionar cotización anterior"),
  ).toBeVisible();
  expect(screen.queryByText("Cotizaciones guardadas:")).not.toBeInTheDocument();
});

it("supports selecting previous quotes from history without loading them into the form", async () => {
  const user = userEvent.setup();
  const { savia, getCollectionHandle } = quoteScreenApi();
  const cotizaciones = getCollectionHandle("cotizaciones");
  const cotizacionesDetalle = getCollectionHandle("cotizaciones_detalle");

  // Seed previous quote in cotizaciones
  await cotizaciones.create({
    id: "cotizaciones-prev-1",
    name: "COT-20260910-REDACTD",
    placa: "REDACTD",
    ramo: "Automóviles",
    valor_asegurado: 35000000,
    prima: 1200000,
    estado: "Recibida",
  });
  await cotizacionesDetalle.create({
    id: "detalle-prev-1",
    cotizacion: "cotizaciones-prev-1",
    aseguradora: "SBS",
    producto: "Autos Gold",
    estado: "Recibida",
    numero_cotizacion: "COT-HIST-01",
    prima: 1200000,
  });

  const DirectScreen = quoteScreen("cotizador");
  render(<DirectScreen savia={savia} />);

  // Previous quotes are accessed only through the dedicated history tab.
  await screen.findByRole("heading", { name: "Cotizador" });
  await user.click(screen.getByRole("button", { name: "Historial" }));
  await screen.findByLabelText("Seleccionar cotización anterior");
  await user.click(screen.getByRole("button", { name: "Preparar cotización" }));
  expect(
    screen.queryByText(/cotizaciones anteriores registradas/),
  ).not.toBeInTheDocument();

  // Switch to history tab
  await user.click(screen.getByRole("button", { name: "Historial" }));

  // History selector is visible with the saved quote: single autocomplete combobox
  const historyInput = await screen.findByLabelText(
    "Seleccionar cotización anterior",
  );
  expect(historyInput).toBeVisible();
  await user.click(historyInput);
  expect(
    await screen.findByRole("option", { name: /COT-20260910-REDACTD/ }),
  ).toBeVisible();

  // Filter and select the previous quote
  await user.clear(historyInput);
  await user.type(historyInput, "REDACTD");
  await user.click(
    await screen.findByRole("option", { name: /COT-20260910-REDACTD/ }),
  );

  // Master quote details and comparison are rendered for that quote
  expect((await screen.findAllByText("COT-20260910-REDACTD"))[0]).toBeVisible();
  expect(screen.getByText("REDACTD")).toBeVisible();
  expect(screen.getAllByText(/35\.000\.000/).length).toBeGreaterThanOrEqual(1);

  expect(
    screen.queryByRole("button", { name: /Cargar en formulario/ }),
  ).not.toBeInTheDocument();
});

it("loads historical detail rows linked by the quote reference", async () => {
  const user = userEvent.setup();
  const { savia, getCollectionHandle } = quoteScreenApi();
  const cotizaciones = getCollectionHandle("cotizaciones");
  const cotizacionesDetalle = getCollectionHandle("cotizaciones_detalle");

  await cotizaciones.create({
    id: "quote-history-uuid",
    name: "COT-20260917-NLEV",
    placa: "MOTORID",
    ramo: "Automóviles",
    valor_asegurado: 16000000,
    estado: "Solicitada",
  });
  await cotizacionesDetalle.create({
    id: "detail-history-reference",
    cotizacion: "COT-20260917-NLEV",
    aseguradora: "Previsora",
    producto: "Previsora · Premium",
    flow_id: "previsora-premium-quote",
    estado: "Solicitada",
    prima: "980000",
    numero_cotizacion: "PRE-2026-01",
  });

  const WizardScreen = quoteScreen("cotizador_por_pasos");
  render(<WizardScreen savia={savia} />);

  await user.click(await screen.findByRole("button", { name: "Historial" }));
  const historyInput = await screen.findByLabelText(
    "Seleccionar cotización anterior",
  );
  await user.click(historyInput);
  await user.clear(historyInput);
  await user.type(historyInput, "NLEV");
  await user.click(
    await screen.findByRole("option", { name: /COT-20260917-NLEV/ }),
  );

  expect(
    await screen.findByRole("heading", { name: "Previsora" }),
  ).toBeVisible();
  expect(screen.getByText("PRE-2026-01")).toBeVisible();
});

it("filters history options through the single autocomplete search", async () => {
  const user = userEvent.setup();
  const { savia, getCollectionHandle } = quoteScreenApi();
  const cotizaciones = getCollectionHandle("cotizaciones");

  await cotizaciones.create({
    id: "quote-filter-1",
    name: "COT-20260917-AAAA",
    placa: "TESTONE",
    estado: "Recibida",
  });
  await cotizaciones.create({
    id: "quote-filter-2",
    name: "COT-20260917-BBBB",
    placa: "TESTTWO",
    estado: "Solicitada",
  });

  const WizardScreen = quoteScreen("cotizador_por_pasos");
  render(<WizardScreen savia={savia} />);

  await user.click(await screen.findByRole("button", { name: "Historial" }));
  const historyInput = await screen.findByLabelText(
    "Seleccionar cotización anterior",
  );
  await user.click(historyInput);
  expect(
    await screen.findByRole("option", { name: /COT-20260917-AAAA/ }),
  ).toBeVisible();
  expect(
    screen.getByRole("option", { name: /COT-20260917-BBBB/ }),
  ).toBeVisible();

  await user.clear(historyInput);
  await user.type(historyInput, "TESTTWO");
  expect(
    await screen.findByRole("option", { name: /COT-20260917-BBBB/ }),
  ).toBeVisible();
  expect(
    screen.queryByRole("option", { name: /COT-20260917-AAAA/ }),
  ).not.toBeInTheDocument();
});

it("loads historical detail rows beyond the default collection page", async () => {
  const user = userEvent.setup();
  const { savia, getCollectionHandle } = quoteScreenApi();
  const cotizaciones = getCollectionHandle("cotizaciones");
  const cotizacionesDetalle = getCollectionHandle("cotizaciones_detalle");

  await cotizaciones.create({
    id: "quote-history-page-2",
    name: "COT-20260917-PAGE2",
    placa: "HISTORY",
    ramo: "Automóviles",
    valor_asegurado: 20000000,
    estado: "Solicitada",
  });
  for (let index = 0; index < 25; index += 1) {
    await cotizacionesDetalle.create({
      id: `other-detail-${index}`,
      cotizacion: "other-quote",
      aseguradora: "Otra",
      producto: `Otro producto ${index}`,
      estado: "Recibida",
    });
  }
  await cotizacionesDetalle.create({
    id: "detail-history-page-2",
    cotizacion: "quote-history-page-2",
    aseguradora: "Mapfre",
    producto: "Mapfre · Clásica",
    flow_id: "mapfre-clasica-quote",
    estado: "Recibida",
    prima: 870000,
    numero_cotizacion: "MAP-2026-02",
  });

  const WizardScreen = quoteScreen("cotizador_por_pasos");
  render(<WizardScreen savia={savia} />);

  await user.click(await screen.findByRole("button", { name: "Historial" }));
  const historyInput = await screen.findByLabelText(
    "Seleccionar cotización anterior",
  );
  await user.click(historyInput);
  await user.clear(historyInput);
  await user.type(historyInput, "HISTORY");
  await user.click(
    await screen.findByRole("option", { name: /COT-20260917-PAGE2/ }),
  );

  expect(await screen.findByRole("heading", { name: "Mapfre" })).toBeVisible();
  expect(screen.getByText("MAP-2026-02")).toBeVisible();
});

it("renders failed requests table and allows retrying without re-entering form data", async () => {
  const user = userEvent.setup();
  const { actions, savia } = quoteScreenApi();
  let sbsFailed = true;
  actions.execute.mockImplementation(async (_actionId, options: any) => {
    if (options?.input?.flowId === "sbs-producto-8" && sbsFailed) {
      sbsFailed = false;
      throw new Error("El conector no pudo completar la acción.");
    }
    return {
      run: { runId: "quote-retry", status: "succeeded" },
      output: {
        type: "quote",
        provider: "SBS",
        status: "success",
        data: {
          quoteNumber: "SIM-RETRY",
          premiumTotal: 1300000,
          simulated: true,
        },
      },
    };
  });

  const DirectScreen = quoteScreen("cotizador");
  render(<DirectScreen savia={savia} />);

  await screen.findByRole("heading", { name: "Paso 1 de 3: Vehículo" });
  await user.type(screen.getByLabelText("Placa"), "TESTCAR");
  await user.type(screen.getByLabelText("Código Fasecolda"), "123456");
  await user.type(screen.getByLabelText("Año del vehículo"), "2024");
  await user.type(
    screen.getByLabelText("Código de ciudad de circulación"),
    "11001",
  );
  await user.type(screen.getByLabelText("Valor asegurado"), "50000000");
  await user.click(screen.getByRole("button", { name: "Siguiente paso" }));
  await user.type(screen.getByLabelText("Número de documento"), "12345678");
  await user.type(screen.getByLabelText("Nombres"), "Ana");
  await user.type(screen.getByLabelText("Primer apellido"), "Pérez");
  await user.type(screen.getByLabelText("Fecha de nacimiento"), "1990-01-01");
  await user.click(screen.getByRole("button", { name: "Siguiente paso" }));
  await user.type(
    screen.getByLabelText("Código de ciudad de residencia"),
    "11001",
  );
  await user.type(screen.getByLabelText("Dirección"), "Calle 1 # 2-3");
  await user.type(screen.getByLabelText("Teléfono"), "3001234567");
  await user.type(
    screen.getByLabelText("Correo electrónico"),
    "ana@example.test",
  );
  await user.click(screen.getByRole("button", { name: "Cotizar" }));

  await user.click(await screen.findByText("Solicitudes de cotización"));
  expect(screen.getByText("Reintentar fallidos (1)")).toBeVisible();
  const retryButtons = screen.getAllByRole("button", { name: "Reintentar" });
  expect(retryButtons.length).toBe(1);

  await user.click(retryButtons[0]);
  expect(actions.execute).toHaveBeenCalledWith(
    "quote",
    expect.objectContaining({
      input: expect.objectContaining({
        quoteInput: expect.objectContaining({
          vehicle: expect.objectContaining({ plate: "TESTCAR" }),
        }),
      }),
    }),
  );
});

it("persists quotes in cotizaciones master and cotizaciones_detalle child collections and tracks retries", async () => {
  const user = userEvent.setup();
  const { actions, savia, getCollectionHandle } = quoteScreenApi();
  const cotizaciones = getCollectionHandle("cotizaciones");
  const cotizacionesDetalle = getCollectionHandle("cotizaciones_detalle");

  let callCount = 0;
  let sbsFailed = true;
  actions.execute.mockImplementation(async (_actionId, options: any) => {
    callCount++;
    if (options?.input?.flowId === "sbs-producto-8" && sbsFailed) {
      sbsFailed = false;
      throw new Error("El conector no pudo completar la acción.");
    }
    return {
      run: { runId: `run-${callCount}`, status: "succeeded" },
      output: {
        type: "quote",
        provider: "SBS",
        status: "success",
        data: {
          quoteNumber: `SIM-${callCount}`,
          premiumTotal: 1000000 + callCount * 50000,
          simulated: true,
        },
      },
    };
  });

  const DirectScreen = quoteScreen("cotizador");
  render(<DirectScreen savia={savia} />);

  await screen.findByRole("heading", { name: "Paso 1 de 3: Vehículo" });
  await user.type(screen.getByLabelText("Placa"), "TESTALT");
  await user.type(screen.getByLabelText("Código Fasecolda"), "654321");
  await user.type(screen.getByLabelText("Año del vehículo"), "2023");
  await user.type(
    screen.getByLabelText("Código de ciudad de circulación"),
    "11001",
  );
  await user.type(screen.getByLabelText("Valor asegurado"), "60000000");
  await user.click(screen.getByRole("button", { name: "Siguiente paso" }));
  await user.type(screen.getByLabelText("Número de documento"), "98765432");
  await user.type(screen.getByLabelText("Nombres"), "Carlos");
  await user.type(screen.getByLabelText("Primer apellido"), "Gómez");
  await user.type(screen.getByLabelText("Fecha de nacimiento"), "1985-05-15");
  await user.click(screen.getByRole("button", { name: "Siguiente paso" }));
  await user.type(
    screen.getByLabelText("Código de ciudad de residencia"),
    "11001",
  );
  await user.type(screen.getByLabelText("Dirección"), "Carrera 7 # 45-10");
  await user.type(screen.getByLabelText("Teléfono"), "3109876543");
  await user.type(
    screen.getByLabelText("Correo electrónico"),
    "carlos@example.test",
  );
  await user.click(screen.getByRole("button", { name: "Cotizar" }));

  await user.click(await screen.findByText("Solicitudes de cotización"));

  // Verify master record was created in cotizaciones
  expect(cotizaciones.create).toHaveBeenCalledTimes(1);
  expect(cotizaciones.create).toHaveBeenCalledWith(
    expect.objectContaining({
      name: expect.stringMatching(/^COT-\d{8}-[A-Z0-9]+$/),
      ramo: "Automóviles",
      placa: "TESTALT",
      valor_asegurado: 60000000,
      estado: "Solicitada",
    }),
  );

  // Verify the applicant was mapped into the Clientes collection and linked
  const clientes = getCollectionHandle("clientes");
  expect(clientes.create).toHaveBeenCalledWith(
    expect.objectContaining({
      name: "Carlos Gómez",
      documento: "98765432",
      email: "carlos@example.test",
      telefono: "3109876543",
    }),
  );
  expect(cotizaciones.create).toHaveBeenCalledWith(
    expect.objectContaining({ cliente: "clientes-1" }),
  );

  // Verify detail records were created in cotizaciones_detalle for each product (19 enabled by default)
  expect(cotizacionesDetalle.create).toHaveBeenCalledTimes(19);
  expect(cotizacionesDetalle.create).toHaveBeenCalledWith(
    expect.objectContaining({
      cotizacion: "cotizaciones-1",
      estado: "Solicitada",
    }),
  );

  // Verify detail records were updated with their responses (one failed, others succeeded)
  expect(cotizacionesDetalle.update).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({
      estado: "Error",
      error_mensaje: "El conector no pudo completar la acción.",
    }),
    { version: 1 },
  );
  expect(cotizacionesDetalle.update).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({
      estado: "Recibida",
      numero_cotizacion: expect.stringMatching(/^SIM-\d+$/),
    }),
    { version: 1 },
  );

  // Retry the failed item
  const retryBtn = screen.getByRole("button", { name: "Reintentar" });
  await user.click(retryBtn);

  // Verify detail was reset to Solicitada before retry and then updated to Recibida
  expect(cotizacionesDetalle.update).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({
      estado: "Solicitada",
    }),
    { version: 2 },
  );
  expect(cotizacionesDetalle.update).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({
      estado: "Recibida",
      numero_cotizacion: expect.stringMatching(/^SIM-\d+$/),
    }),
    { version: 3 },
  );
});

it("renders actual quote cards without an unsupported coverage comparison", async () => {
  const user = userEvent.setup();
  const { actions, savia } = quoteScreenApi();
  actions.execute.mockResolvedValue({
    run: { runId: "quote-comparator-run", status: "succeeded" },
    output: {
      type: "quote",
      provider: "SBS",
      status: "success",
      data: {
        quoteNumber: "COT-SBS-GOLD",
        premiumTotal: 1250000,
        simulated: true,
      },
    },
  });

  const DirectScreen = quoteScreen("cotizador");
  render(<DirectScreen savia={savia} />);

  await screen.findByRole("heading", { name: "Paso 1 de 3: Vehículo" });
  await user.type(screen.getByLabelText("Placa"), "REDACTD");
  await user.type(screen.getByLabelText("Código Fasecolda"), "08001136");
  await user.type(screen.getByLabelText("Año del vehículo"), "2020");
  await user.type(
    screen.getByLabelText("Código de ciudad de circulación"),
    "11001",
  );
  await user.type(screen.getByLabelText("Valor asegurado"), "32100000");
  await user.click(screen.getByRole("button", { name: "Siguiente paso" }));
  await user.type(screen.getByLabelText("Número de documento"), "10203040");
  await user.type(screen.getByLabelText("Nombres"), "Fiduciario");
  await user.type(screen.getByLabelText("Primer apellido"), "Savia");
  await user.type(screen.getByLabelText("Fecha de nacimiento"), "1992-03-20");
  await user.click(screen.getByRole("button", { name: "Siguiente paso" }));
  await user.type(
    screen.getByLabelText("Código de ciudad de residencia"),
    "11001",
  );
  await user.type(screen.getByLabelText("Dirección"), "Calle 100 # 15-20");
  await user.type(screen.getByLabelText("Teléfono"), "3100000000");
  await user.type(
    screen.getByLabelText("Correo electrónico"),
    "cliente@fiduciaria.test",
  );
  await user.click(screen.getByRole("button", { name: "Cotizar" }));

  // Master quote header displays vehicle info and reference
  expect(await screen.findByText("Cotización Maestra")).toBeVisible();
  expect(screen.getByText("Placa:")).toBeVisible();
  expect(screen.getByText("REDACTD")).toBeVisible();

  // Comparator cards render with scores, prices and actions
  expect(
    screen.queryByText("★ Mejor relación cobertura/precio"),
  ).not.toBeInTheDocument();
  const sbsLogo = screen.getAllByRole("img", { name: "Logo de SBS" })[0];
  expect(sbsLogo.tagName).toBe("IMG");
  expect(sbsLogo).toHaveAttribute("src", expect.stringContaining("sbs"));
  expect(
    screen.queryByRole("heading", {
      name: "Matriz Detallada de Coberturas Frente a Frente",
    }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText("✓ No informado por la aseguradora"),
  ).not.toBeInTheDocument();

  // Copy quote action
  const copyButtons = screen.getAllByRole("button", {
    name: /Copiar datos de cotización/,
  });
  expect(copyButtons.length).toBeGreaterThanOrEqual(1);
  expect(copyButtons[0]).not.toHaveTextContent("Copiar datos de cotización");
  await user.click(copyButtons[0]);
  expect(
    await screen.findByRole("button", { name: /Datos de cotización copiados/ }),
  ).toBeVisible();

  const comparisonButtons = screen.getAllByRole("button", {
    name: /del comparador$/,
  });
  expect(comparisonButtons).toHaveLength(4);
  await user.click(comparisonButtons[0]);
  expect(
    screen.getAllByRole("button", { name: /del comparador$/ }),
  ).toHaveLength(3);
  const replacement = screen.getAllByRole("button", {
    name: /al comparador$/,
  })[0];
  await user.click(replacement);
  expect(
    screen.getAllByRole("button", { name: /del comparador$/ }),
  ).toHaveLength(4);
  expect(screen.getByRole("button", { name: "Descargar PDF" })).toBeEnabled();
});

it("supports plate auto-lookup on blur, currency formatting, age chips, and email validation", async () => {
  const user = userEvent.setup();
  const { actions, savia } = quoteScreenApi();
  actions.execute.mockResolvedValue({
    run: { runId: "lookup-run", status: "succeeded" },
    output: {
      type: "vehicle_lookup",
      provider: "sura",
      status: "success",
      data: {
        vehicle: {
          plate: "LOOKUPID",
          fasecoldaCode: "08001136",
          productionYear: 2022,
          declaredValue: 48000000,
          accessoriesValue: 3000000,
        },
      },
    },
  });

  const DirectScreen = quoteScreen("cotizador");
  render(<DirectScreen savia={savia} />);

  await screen.findByRole("heading", { name: "Paso 1 de 3: Vehículo" });

  // Type plate and tab/blur -> triggers auto lookup
  const plateInput = screen.getByLabelText("Placa");
  await user.type(plateInput, "LOOKUPID");
  await user.tab();

  // Fields are autocompleted from lookup response
  expect(await screen.findByDisplayValue("08001136")).toBeVisible();
  expect(screen.getByDisplayValue("2022")).toBeVisible();
  // Declared value is formatted as COP currency
  expect(screen.getByDisplayValue("48.000.000")).toBeVisible();
  expect(screen.getByDisplayValue("3.000.000")).toBeVisible();
  expect(screen.getAllByText("✓ Autocompletado").length).toBeGreaterThanOrEqual(
    3,
  );

  // Advance to Step 2: Solicitante y conductor
  await user.type(
    screen.getByLabelText("Código de ciudad de circulación"),
    "11001",
  );
  await user.click(screen.getByRole("button", { name: "Siguiente paso" }));
  await screen.findByRole("heading", {
    name: "Paso 2 de 3: Solicitante y conductor",
  });

  // Quick age selector chip updates birth date
  const age30Chip = screen.getByRole("button", { name: "30" });
  await user.click(age30Chip);
  expect(screen.getByText("30 años")).toBeVisible();
  const birthInput = screen.getByLabelText(
    "Fecha de nacimiento",
  ) as HTMLInputElement;
  expect(birthInput.value).toMatch(/^\d{4}-06-15$/);

  // Advance to Step 3: Contacto y cotización
  await user.type(screen.getByLabelText("Número de documento"), "11223344");
  await user.type(screen.getByLabelText("Nombres"), "Laura");
  await user.type(screen.getByLabelText("Primer apellido"), "García");
  await user.click(screen.getByRole("button", { name: "Siguiente paso" }));
  await screen.findByRole("heading", {
    name: "Paso 3 de 3: Contacto y cotización",
  });

  // Email validation shows error on invalid email on blur
  const emailInput = screen.getByLabelText("Correo electrónico");
  await user.type(emailInput, "correo-invalido");
  await user.tab();
  expect(
    await screen.findByText("Ingresa un correo válido (ej. nombre@correo.com)"),
  ).toBeVisible();

  // Fixing email clears error
  await user.clear(emailInput);
  await user.type(emailInput, "laura@example.com");
  expect(
    screen.queryByText("Ingresa un correo válido (ej. nombre@correo.com)"),
  ).not.toBeInTheDocument();
});

it("does not show 50 on Cotizaciones tab and renders empty state without dummy templates when no quote is selected", async () => {
  const user = userEvent.setup();
  // 50 runs in tenant
  const dummyRuns = Array.from({ length: 50 }, (_, i) => ({
    runId: `run-${i}`,
    actionId: "quote",
    connectionId: "simulation",
    status: "succeeded" as const,
    output: {
      type: "quote",
      provider: "Liberty",
      status: "success",
      data: { quoteNumber: `SIM-${i}` },
    },
    errorCode: null,
    createdAt: "2026-09-16T00:00:00.000Z",
    updatedAt: "2026-09-16T00:00:00.000Z",
  }));

  const { savia } = quoteScreenApi({ runs: dummyRuns });
  const DirectScreen = quoteScreen("cotizador");
  render(<DirectScreen savia={savia} />);

  // The tab does NOT show 50
  const quotesTab = await screen.findByRole("button", { name: "Cotizaciones" });
  expect(quotesTab).toBeVisible();
  expect(screen.queryByText(/Cotizaciones \(50\)/)).not.toBeInTheDocument();

  // Switch to cotizaciones tab
  await user.click(quotesTab);

  // Shows empty state
  expect(
    await screen.findByRole("region", { name: "Sin cotización seleccionada" }),
  ).toBeVisible();
  expect(screen.getByText("Ninguna cotización seleccionada")).toBeVisible();

  // Does NOT render any dummy template cards or 1.300.000
  expect(screen.queryByText("$ 1.300.000")).not.toBeInTheDocument();
  expect(screen.queryByText(/Financiación directa/)).not.toBeInTheDocument();
  expect(
    screen.queryByRole("heading", {
      name: "Matriz Detallada de Coberturas Frente a Frente",
    }),
  ).not.toBeInTheDocument();
});

it("shows completed offers when saving the master quote fails", async () => {
  const user = userEvent.setup();
  const { actions, savia, getCollectionHandle } = quoteScreenApi();
  getCollectionHandle("cotizaciones").create.mockRejectedValue(
    new Error("Collection unavailable"),
  );
  actions.execute.mockResolvedValue({
    run: { runId: "quote-batch", status: "succeeded" },
    output: {
      type: "quote",
      provider: "SBS",
      status: "success",
      data: {
        quoteNumber: "SIM-BATCH",
        premiumTotal: 1200000,
        simulated: true,
      },
    },
  });
  const DirectScreen = quoteScreen("cotizador");
  render(<DirectScreen savia={savia} />);

  await screen.findByRole("heading", { name: "Paso 1 de 3: Vehículo" });
  await user.type(screen.getByLabelText("Placa"), "TESTCAR");
  await user.type(screen.getByLabelText("Código Fasecolda"), "123456");
  await user.type(screen.getByLabelText("Año del vehículo"), "2024");
  await user.type(
    screen.getByLabelText("Código de ciudad de circulación"),
    "11001",
  );
  await user.type(screen.getByLabelText("Valor asegurado"), "50000000");
  await user.click(screen.getByRole("button", { name: "Siguiente paso" }));
  await user.type(screen.getByLabelText("Número de documento"), "12345678");
  await user.type(screen.getByLabelText("Nombres"), "Ana");
  await user.type(screen.getByLabelText("Primer apellido"), "Pérez");
  await user.type(screen.getByLabelText("Fecha de nacimiento"), "1990-01-01");
  await user.click(screen.getByRole("button", { name: "Siguiente paso" }));
  await user.type(
    screen.getByLabelText("Código de ciudad de residencia"),
    "11001",
  );
  await user.type(screen.getByLabelText("Dirección"), "Calle 1 # 2-3");
  await user.type(screen.getByLabelText("Teléfono"), "3001234567");
  await user.type(
    screen.getByLabelText("Correo electrónico"),
    "ana@example.test",
  );
  expect(screen.queryByTitle("Modo de ejecución")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Cotizar" }));

  expect(
    screen.queryByText("Ninguna cotización seleccionada"),
  ).not.toBeInTheDocument();
  expect(
    await screen.findByText(/No se pudo guardar la cotización/),
  ).toBeVisible();
  expect(screen.getAllByText("SIM-BATCH").length).toBeGreaterThan(0);
});

it("opens the quote linked by Alice without locking later history selection", async () => {
  const { savia, getCollectionHandle } = quoteScreenApi();
  await getCollectionHandle("cotizaciones").create({
    id: "alice-quote",
    name: "COT-ALICE",
    estado: "Recibida",
  });
  await getCollectionHandle("cotizaciones_detalle").create({
    id: "alice-detail",
    cotizacion: "alice-quote",
    aseguradora: "Liberty",
    producto: "Full",
    estado: "Recibida",
    prima: 1000,
    numero_cotizacion: "ALICE-123",
  });
  window.location.hash =
    "#/crm?domain=platform&object=cotizador_por_pasos&quote=alice-quote";
  const WizardScreen = quoteScreen("cotizador_por_pasos");
  render(<WizardScreen savia={savia} />);
  expect(await screen.findByText("ALICE-123")).toBeVisible();
  window.location.hash = "";
});

it("autocompletes DANE city names and loads the 5-digit code in the quote form", async () => {
  const user = userEvent.setup();
  const { savia } = quoteScreenApi();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/lookups/dane")) {
      return new Response(
        JSON.stringify({
          status: "matched",
          matches: [
            {
              code: "05001",
              city: "MEDELLÍN",
              department: "ANTIOQUIA",
            },
          ],
          totalMatches: 1,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return originalFetch(input);
  });

  try {
    const DirectScreen = quoteScreen("cotizador");
    render(<DirectScreen savia={savia} />);

    await screen.findByRole("heading", { name: "Paso 1 de 3: Vehículo" });
    const cityInput = screen.getByLabelText("Código de ciudad de circulación");
    await user.type(cityInput, "Medell");

    const option = await screen.findByRole("button", { name: /MEDELLÍN/i });
    expect(option).toBeVisible();
    expect(screen.getByText("ANTIOQUIA")).toBeVisible();
    expect(screen.getByText("05001")).toBeVisible();

    await user.click(option);

    expect(cityInput).toHaveValue("MEDELLÍN (ANTIOQUIA)");
    expect(screen.getByText(/✓ DANE: 05001/)).toBeVisible();

    const clearBtn = screen.getByRole("button", {
      name: /limpiar ciudad seleccionada/i,
    });
    expect(clearBtn).toBeVisible();
    await user.click(clearBtn);
    expect(cityInput).toHaveValue("");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
