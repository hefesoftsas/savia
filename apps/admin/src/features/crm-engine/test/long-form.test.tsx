// @vitest-environment jsdom
import React from "react";
import { it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import DynamicForm from "../dynamic-form";
import { makeConfig } from "@savia/crm-shared/metadata";
beforeEach(() =>
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  ),
);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("submits all expanded fields within a dialog without dismissing it", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  const close = vi.fn();
  const fields = Object.fromEntries(
    Array.from({ length: 30 }, (_, index) => [
      `field_${index}`,
      {
        type: index > 25 ? "Toggle" : "Textbox",
        label: `Campo ${index}`,
        required: true,
      },
    ]),
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Dialog open onOpenChange={close}>
        <DialogContent>
          <DialogTitle>Crear agencia</DialogTitle>
          <DialogDescription>Campos obligatorios</DialogDescription>
          <DynamicForm
            object={{
              name: "agency_long_test",
              label: "Agencias",
              description: "",
              config: makeConfig(fields),
            }}
            onSave={save}
          />
        </DialogContent>
      </Dialog>
    </QueryClientProvider>,
  );
  await screen.findByRole("textbox", { name: "Campo 0" });
  fireEvent.click(screen.getByRole("button", { name: "Expand" }));
  for (let index = 0; index <= 25; index++)
    fireEvent.input(
      await screen.findByRole("textbox", { name: `Campo ${index}` }),
      { target: { value: `Valor ${index}` } },
    );
  fireEvent.click(screen.getByRole("button", { name: "Guardar registro" }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(close).not.toHaveBeenCalled();
  expect(save.mock.calls[0][0]).toMatchObject({
    field_0: "Valor 0",
    field_25: "Valor 25",
    field_26: false,
  });
});

it.each(["managed-customer", "managed-agency"] as const)(
  "saves a custom-only %s edit without demanding missing legacy core values",
  async (business) => {
    const save = vi.fn().mockResolvedValue(undefined);
    const config = makeConfig({
      name: { type: "Textbox", label: "Nombre", required: true },
      email: { type: "Textbox", label: "Correo", required: true },
      segmento: { type: "Textbox", label: "Segmento" },
    });
    config.studio = { ...config.studio, business };
    render(
      <QueryClientProvider client={new QueryClient()}>
        <DynamicForm
          object={{
            name: "clientes",
            label: "Clientes",
            description: "",
            config,
          }}
          values={{ id: "12", name: null, email: null, segmento: "Anterior" }}
          onSave={save}
        />
      </QueryClientProvider>,
    );
    fireEvent.input(await screen.findByRole("textbox", { name: "Segmento" }), {
      target: { value: "Preferente" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar registro" }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({ segmento: "Preferente" }),
    );
  },
);
it("still rejects clearing a required managed field that previously had a value", async () => {
  const save = vi.fn();
  const config = makeConfig({
    name: { type: "Textbox", label: "Nombre", required: true },
  });
  config.studio = { ...config.studio, business: "managed-customer" };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <DynamicForm
        object={{
          name: "clientes",
          label: "Clientes",
          description: "",
          config,
        }}
        values={{ id: "12", name: "Original" }}
        onSave={save}
      />
    </QueryClientProvider>,
  );
  fireEvent.input(await screen.findByRole("textbox", { name: "Nombre" }), {
    target: { value: "" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Guardar registro" }));
  await screen.findByText("Revisa los campos señalados antes de guardar.");
  expect(save).not.toHaveBeenCalled();
});
