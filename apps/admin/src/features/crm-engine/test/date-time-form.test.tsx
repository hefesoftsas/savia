// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import DynamicForm from "../dynamic-form";
import { makeConfig } from "@savia/crm-shared/metadata";
afterEach(cleanup);
it("submits a changed CRM datetime from the native picker through the real form", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  const config = makeConfig({ hs_timestamp: { type: "Textbox", label: "Fecha", required: true, config: { dateTime: true } } });
  config.studio = { collection: { kind: "crm", sourceId: "hubspot", resource: "notes", capabilities: { list: true, read: true, create: true, update: true, delete: true, schema: false, customFields: false } } };
  render(<QueryClientProvider client={new QueryClient()}><DynamicForm object={{ name: "notes", label: "Notas", description: "", config }} values={{ id: "1", hs_timestamp: new Date(2026, 8, 11, 18, 30).toISOString() }} onSave={save} /></QueryClientProvider>);
  const input = await screen.findByLabelText(/Fecha/);
  (input as HTMLInputElement).value = "2026-09-11T18:45";
  fireEvent.blur(input);
  fireEvent.click(screen.getByRole("button", { name: "Guardar registro" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ hs_timestamp: new Date(2026, 8, 11, 18, 45).toISOString() })));
});
