import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { render } from "../crm-engine/test/locale-test-render";
import userEvent from "@testing-library/user-event";
import RequestPage from "@/features/crm-engine/request-page";
import { setCrmRuntime } from "@/features/crm-engine/runtime";
import { requestPageSchema } from "@savia/crm-shared/request-page";
import type { CrmObject } from "@savia/crm-shared/metadata";
const object: CrmObject = {
  name: "quote",
  label: "Cotizador generado",
  description: "",
  config: {
    version: 2,
    fields: { plate: { type: "Textbox", label: "Placa", required: true } },
    fieldOrder: ["plate"],
    studio: {
      requestPage: requestPageSchema.parse({
        version: 1,
        source: "savia-request",
        resultColumns: [
          { label: "Referencia", pointer: "/reference", format: "text" },
        ],
        actions: [
          {
            id: "quote",
            label: "Aseguradora",
            operationId: "execute_quote",
            kind: "submit",
            input: { plate: "plate" },
          },
        ],
      }),
    },
  },
};
afterEach(() => {
  cleanup();
  setCrmRuntime({ embedded: false });
});
describe("generated request page runtime", () => {
  it("executes the selected request with the form values and restores results without repeating it", async () => {
    const user = userEvent.setup();
    let runs: any[] = [];
    const transport = vi.fn(async (_path: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        const saved = {
          ...body,
          label: "Aseguradora",
          status: "complete",
          result: {
            type: "quote",
            status: "success",
            errors: [],
            warnings: [],
            metadata: { simulated: true },
            data: {
              offers: [
                {
                  provider: "Demo",
                  product: { name: "Plan" },
                  premium: { total: 1200000, currency: "COP" },
                  reference: "QA-1",
                  coverages: [],
                  deductibles: [],
                },
              ],
            },
          },
          error: null,
          createdAt: new Date().toISOString(),
        };
        runs = [saved];
        return Response.json(saved);
      }
      return Response.json({ data: runs });
    });
    setCrmRuntime({
      embedded: true,
      domainId: "platform",
      requestTransport: transport,
    });
    const mounted = render(<RequestPage object={object} />);
    await screen.findByText(
      "Al ejecutar una operación, sus resultados aparecerán aquí.",
    );
    expect(
      transport.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(0);
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Modo de ejecución" }),
      "mock",
    );
    await user.type(screen.getByRole("textbox", { name: /Placa/ }), "TESTCAR");
    await user.click(screen.getByRole("button", { name: "Ejecutar" }));
    await screen.findByText("QA-1");
    expect(runs[0].values.plate).toBe("TESTCAR");
    expect(runs[0].mode).toBe("mock");
    mounted.unmount();
    render(<RequestPage object={object} />);
    await screen.findByText("QA-1");
    expect(
      transport.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Cargar datos" }));
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: /Placa/ })).toHaveValue(
        "TESTCAR",
      ),
    );
  });
  it("runs a field lookup without submitting the quote and rejects stale responses", async () => {
    const user = userEvent.setup();
    const page = structuredClone(object);
    page.config.fields.year = { type: "Number", label: "Año" };
    page.config.fieldOrder!.push("year");
    page.config.studio!.requestPage!.actions.push({
      id: "lookup",
      operationId: "execute_lookup",
      label: "Consultar placa",
      kind: "lookup",
      input: { plate: "plate" },
      output: { year: "/data/vehicle/year" },
    });
    let resolveRun: (response: Response) => void = () => {};
    const transport = vi.fn(async (_path: string, init?: RequestInit) => {
      if (init?.method !== "POST") return Response.json({ data: [] });
      return new Promise<Response>((resolve) => {
        resolveRun = resolve;
      });
    });
    setCrmRuntime({
      embedded: true,
      domainId: "platform",
      requestTransport: transport,
    });
    render(<RequestPage object={page} />);
    await screen.findByText(
      "Al ejecutar una operación, sus resultados aparecerán aquí.",
    );
    await user.type(screen.getByRole("textbox", { name: /Placa/ }), "TESTCAR");
    await user.click(screen.getByRole("button", { name: "Consultar placa" }));
    await user.clear(screen.getByRole("textbox", { name: /Placa/ }));
    await user.type(screen.getByRole("textbox", { name: /Placa/ }), "TESTALT");
    resolveRun(
      Response.json({
        id: "lookup-run",
        actionId: "lookup",
        label: "Consulta",
        mode: "mock",
        status: "complete",
        createdAt: new Date().toISOString(),
        values: { plate: "TESTCAR" },
        result: {
          type: "vehicle_lookup",
          status: "success",
          data: { vehicle: { plate: "TESTCAR", year: 2024 } },
          errors: [],
          warnings: [],
          metadata: { simulated: true },
        },
      }),
    );
    await screen.findByText(
      "Cambió la entrada; consulta de nuevo para completar los campos.",
    );
    expect(screen.getByRole("spinbutton", { name: "Año" })).not.toHaveValue(
      2024,
    );
    expect(
      transport.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Cargar datos" }));
    expect(screen.getByRole("checkbox", { name: "Aseguradora" })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Ejecutar" }));
    await waitFor(() =>
      expect(
        transport.mock.calls.filter(([, init]) => init?.method === "POST"),
      ).toHaveLength(2),
    );
    const posts = transport.mock.calls.filter(
      ([, init]) => init?.method === "POST",
    );
    expect(JSON.parse(String(posts[1][1]?.body)).actionId).toBe("quote");
    resolveRun(
      Response.json({
        id: "quote-run",
        actionId: "quote",
        label: "Aseguradora",
        mode: "mock",
        status: "failed",
        createdAt: new Date().toISOString(),
        values: { plate: "TESTCAR" },
        result: null,
        error: "Test",
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Ejecutar" })).toBeEnabled(),
    );
  });

  it.each(["steps", "conversation"] as const)(
    "keeps lookup results while navigating a %s wizard without quoting early",
    async (presentation) => {
      const user = userEvent.setup();
      const page = structuredClone(object);
      page.config.fields.plate.config = { step: "vehicle" };
      page.config.fields.year = {
        type: "Number",
        label: "Año",
        required: true,
        config: { step: "details" },
      };
      page.config.fieldOrder!.push("year");
      page.config.studio!.wizard = {
        enabled: true,
        presentation,
        steps: [
          { id: "vehicle", title: "Vehículo" },
          { id: "details", title: "Detalles" },
        ],
      };
      page.config.studio!.requestPage!.actions.push({
        id: "lookup",
        operationId: "lookup",
        label: "Consultar placa",
        kind: "lookup",
        input: { plate: "plate" },
        output: { year: "/data/vehicle/year" },
      });
      const transport = vi.fn(async (_path: string, init?: RequestInit) => {
        if (init?.method !== "POST") return Response.json({ data: [] });
        const body = JSON.parse(String(init.body));
        return Response.json({
          ...body,
          label: "Consulta",
          status: "complete",
          createdAt: new Date().toISOString(),
          result: {
            type: "vehicle_lookup",
            status: "success",
            data: { vehicle: { plate: "REDACTD", year: 2024 } },
            errors: [],
            warnings: [],
            metadata: { simulated: true },
          },
        });
      });
      setCrmRuntime({
        embedded: true,
        domainId: "platform",
        requestTransport: transport,
      });
      render(<RequestPage object={page} />);
      await user.type(
        screen.getByRole("textbox", { name: /Placa/ }),
        "REDACTD",
      );
      expect(
        screen.queryByRole("region", { name: "Resultados de la página" }),
      ).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Resultados" }));
      expect(
        screen.getByRole("region", { name: "Resultados de la página" }),
      ).toBeVisible();
      await user.click(
        screen.getByRole("button", { name: "Preparar cotización" }),
      );
      expect(screen.getByRole("textbox", { name: /Placa/ })).toHaveValue(
        "REDACTD",
      );

      await user.click(screen.getByRole("button", { name: "Consultar placa" }));
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "Consultar placa" }),
        ).toBeEnabled(),
      );
      await user.click(
        screen.getByRole("button", {
          name: presentation === "steps" ? "Siguiente paso" : /Continuar/,
        }),
      );
      await waitFor(() =>
        expect(screen.getByRole("spinbutton", { name: "Año" })).toHaveValue(
          2024,
        ),
      );
      expect(
        transport.mock.calls.filter(([, init]) => init?.method === "POST"),
      ).toHaveLength(1);
    },
  );
});
