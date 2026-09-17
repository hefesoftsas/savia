// @vitest-environment jsdom
import React from "react";
import { afterEach, it, expect, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import DynamicForm from "../dynamic-form";
import { makeConfig } from "@savia/crm-shared/metadata";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("keeps email and calendar date after another field changes and submits them", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <DynamicForm
        object={{
          name: "test",
          label: "Test",
          description: "",
          config: makeConfig({
            name: { type: "Textbox", label: "Nombre", required: true },
            email: {
              type: "Textbox",
              label: "Correo",
              config: { format: "email" },
            },
            date: { type: "DateControl", label: "Fecha" },
            amount: { type: "Number", label: "Valor" },
          }),
        }}
        onSave={save}
      />
    </QueryClientProvider>,
  );
  fireEvent.input(await screen.findByRole("textbox", { name: "Nombre" }), {
    target: { value: "Demo" },
  });
  fireEvent.input(screen.getByRole("textbox", { name: "Correo" }), {
    target: { value: "test@example.com" },
  });
  fireEvent.input(screen.getByLabelText("Fecha"), {
    target: { value: "2026-10-15" },
  });
  fireEvent.change(screen.getByRole("spinbutton", { name: "Valor" }), {
    target: { value: "25" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Guardar registro" }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Demo",
        email: "test@example.com",
        date: "2026-10-15",
        amount: 25,
      }),
    ),
  );
});

it("keeps R2 files out of record data and queues them after the record is saved", async () => {
  const file = new File(["contract"], "contract.pdf", {
    type: "application/pdf",
  });
  const save = vi.fn().mockResolvedValue({
    id: "contract-1",
    created_at: "2026-09-09T00:00:00.000Z",
    updated_at: "2026-09-09T00:00:00.000Z",
  });
  const persistAttachments = vi.fn().mockResolvedValue(undefined);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <DynamicForm
        object={{
          name: "contracts",
          label: "Contratos",
          description: "",
          config: makeConfig({
            name: { type: "Textbox", label: "Nombre", required: true },
            contract: {
              type: "R2Attachment",
              label: "Contrato",
              config: { accept: ["application/pdf"], maxFiles: 1 },
            },
          }),
        }}
        onPersistAttachments={persistAttachments}
        onSave={save}
      />
    </QueryClientProvider>,
  );

  fireEvent.input(await screen.findByRole("textbox", { name: "Nombre" }), {
    target: { value: "Contrato marco" },
  });
  fireEvent.change(screen.getByTestId("file-picker-input"), {
    target: { files: [file] },
  });
  fireEvent.click(screen.getByRole("button", { name: "Guardar registro" }));

  await waitFor(() => expect(save).toHaveBeenCalled());
  expect(save).toHaveBeenCalledWith({ name: "Contrato marco" });
  await waitFor(() =>
    expect(persistAttachments).toHaveBeenCalledWith(
      expect.objectContaining({ id: "contract-1" }),
      [{ field: "contract", files: [file] }],
      expect.any(Function),
    ),
  );
});

it("uploads an attachment immediately, then associates it when the record is saved", async () => {
  const file = new File(["contract"], "contract.pdf", {
    type: "application/pdf",
  });
  const temporary = {
    id: "temporary-contract-1",
    name: "contract.pdf",
    mime: "application/pdf",
    size: 8,
    field: "contract",
    version: 1,
    expiresAt: "2026-09-10T00:00:00.000Z",
  };
  const uploadTemporary = vi.fn().mockResolvedValue(temporary);
  const persistTemporary = vi.fn().mockResolvedValue(undefined);
  const save = vi.fn().mockResolvedValue({
    id: "contract-1",
    created_at: "2026-09-09T00:00:00.000Z",
    updated_at: "2026-09-09T00:00:00.000Z",
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <DynamicForm
        object={{
          name: "contracts",
          label: "Contratos",
          description: "",
          config: makeConfig({
            name: { type: "Textbox", label: "Nombre", required: true },
            contract: {
              type: "R2Attachment",
              label: "Contrato",
              config: { maxFiles: 1 },
            },
          }),
        }}
        onPersistTemporaryAttachments={persistTemporary}
        onSave={save}
        onUploadTemporaryAttachment={uploadTemporary}
      />
    </QueryClientProvider>,
  );

  fireEvent.input(await screen.findByRole("textbox", { name: "Nombre" }), {
    target: { value: "Contrato marco" },
  });
  fireEvent.change(screen.getByTestId("file-picker-input"), {
    target: { files: [file] },
  });
  await waitFor(() =>
    expect(uploadTemporary).toHaveBeenCalledWith("contract", file),
  );

  fireEvent.click(screen.getByRole("button", { name: "Guardar registro" }));
  await waitFor(() => expect(save).toHaveBeenCalled());
  await waitFor(() =>
    expect(persistTemporary).toHaveBeenCalledWith(
      expect.objectContaining({ id: "contract-1" }),
      [temporary],
    ),
  );
});

it("deletes uploaded temporary attachments when a record form is cancelled", async () => {
  const file = new File(["contract"], "contract.pdf", {
    type: "application/pdf",
  });
  const temporary = {
    id: "temporary-contract-1",
    name: "contract.pdf",
    mime: "application/pdf",
    size: 8,
    field: "contract",
    version: 1,
    expiresAt: "2026-09-10T00:00:00.000Z",
  };
  const discardTemporary = vi.fn().mockResolvedValue(undefined);
  const onCancel = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <DynamicForm
        object={{
          name: "contracts",
          label: "Contratos",
          description: "",
          config: makeConfig({
            contract: {
              type: "R2Attachment",
              label: "Contrato",
              config: { maxFiles: 1 },
            },
          }),
        }}
        onCancel={onCancel}
        onDiscardTemporaryAttachments={discardTemporary}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onUploadTemporaryAttachment={vi.fn().mockResolvedValue(temporary)}
      />
    </QueryClientProvider>,
  );

  fireEvent.change(await screen.findByTestId("file-picker-input"), {
    target: { files: [file] },
  });
  await waitFor(() =>
    expect(screen.getByText("Archivo cargado")).toBeTruthy(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
  await waitFor(() => expect(discardTemporary).toHaveBeenCalledWith([temporary]));
  expect(onCancel).toHaveBeenCalledOnce();
});

it("shows R2 transfer progress while an attachment is being uploaded", async () => {
  const file = new File(["contract"], "contract.pdf", {
    type: "application/pdf",
  });
  let finishUpload: () => void = () => {};
  const save = vi.fn().mockResolvedValue({
    id: "contract-1",
    created_at: "2026-09-09T00:00:00.000Z",
    updated_at: "2026-09-09T00:00:00.000Z",
  });
  const persistAttachments = vi.fn(
    async (_record, _attachments, onStatus) => {
      onStatus({ field: "contract", file, status: "uploading" });
      await new Promise<void>((resolve) => {
        finishUpload = resolve;
      });
      onStatus({ field: "contract", file, status: "uploaded" });
    },
  );
  const fetcher = vi.fn(async () => Response.json({ data: [] }));
  vi.stubGlobal("fetch", fetcher);

  render(
    <QueryClientProvider client={new QueryClient()}>
      <DynamicForm
        object={{
          name: "contracts",
          label: "Contratos",
          description: "",
          config: makeConfig({
            name: { type: "Textbox", label: "Nombre", required: true },
            contract: { type: "R2Attachment", label: "Contrato" },
          }),
        }}
        onPersistAttachments={persistAttachments}
        onSave={save}
      />
    </QueryClientProvider>,
  );

  fireEvent.input(await screen.findByRole("textbox", { name: "Nombre" }), {
    target: { value: "Contrato marco" },
  });
  fireEvent.change(screen.getByTestId("file-picker-input"), {
    target: { files: [file] },
  });
  fireEvent.click(screen.getByRole("button", { name: "Guardar registro" }));

  expect(await screen.findByText("Cargando archivo…")).toBeTruthy();
  expect(
    screen.getByRole("progressbar", { name: "Carga de contract.pdf" })
      .getAttribute("aria-valuetext"),
  ).toBe("Cargando archivo");

  finishUpload();
  await waitFor(() =>
    expect(screen.queryByText("Cargando archivo…")).toBeNull(),
  );
});

it("uses the latest saved record when retrying an attachment upload", async () => {
  const file = new File(["contract"], "contract.pdf", {
    type: "application/pdf",
  });
  const savedRecord = {
    id: "contract-1",
    _version: 2,
    created_at: "2026-09-09T00:00:00.000Z",
    updated_at: "2026-09-09T00:00:00.000Z",
  };
  const save = vi.fn().mockResolvedValue(savedRecord);
  const persistAttachments = vi
    .fn()
    .mockRejectedValueOnce(new Error("R2 no está disponible"))
    .mockResolvedValueOnce(undefined);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <DynamicForm
        object={{
          name: "contracts",
          label: "Contratos",
          description: "",
          config: makeConfig({
            name: { type: "Textbox", label: "Nombre", required: true },
            contract: { type: "R2Attachment", label: "Contrato" },
          }),
        }}
        onPersistAttachments={persistAttachments}
        onSave={save}
      />
    </QueryClientProvider>,
  );

  fireEvent.input(await screen.findByRole("textbox", { name: "Nombre" }), {
    target: { value: "Contrato marco" },
  });
  fireEvent.change(screen.getByTestId("file-picker-input"), {
    target: { files: [file] },
  });
  fireEvent.click(screen.getByRole("button", { name: "Guardar registro" }));
  await screen.findByText("R2 no está disponible");
  fireEvent.click(screen.getByRole("button", { name: "Guardar registro" }));

  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save.mock.calls[1]?.[1]).toEqual(savedRecord);
});

it("offers a cancel action beside save on a standard record form", async () => {
  const onCancel = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <DynamicForm
        object={{
          name: "test",
          label: "Test",
          description: "",
          config: makeConfig({
            name: { type: "Textbox", label: "Nombre", required: true },
          }),
        }}
        onCancel={onCancel}
        onSave={vi.fn().mockResolvedValue(undefined)}
      />
    </QueryClientProvider>,
  );

  fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
  expect(onCancel).toHaveBeenCalledOnce();
});

it("uses a user-facing label for the legacy R2 attachment field", async () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <DynamicForm
        object={{
          name: "test",
          label: "Test",
          description: "",
          config: makeConfig({
            attachment: { type: "R2Attachment", label: "Archivo R2" },
          }),
        }}
        onSave={vi.fn().mockResolvedValue(undefined)}
      />
    </QueryClientProvider>,
  );

  expect(await screen.findByText("Archivo adjunto")).toBeTruthy();
});
