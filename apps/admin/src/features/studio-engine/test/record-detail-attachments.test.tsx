// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, screen, within, fireEvent } from "@testing-library/react";
import { render } from "./locale-test-render";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import RecordDetail from "../record-detail";
import { api, downloadCrm } from "../api";
import { makeConfig, R2_ATTACHMENT_TYPE } from "@savia/studio-shared/metadata";
vi.mock("../api", () => ({
  api: vi.fn(),
  studioFetch: vi.fn(),
  downloadCrm: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("shows persisted file metadata and download under its attachment field", async () => {
  const record = { id: "record-1", name: "Test" };
  vi.mocked(api).mockImplementation(async (path) => {
    if (path.startsWith("/record-detail"))
      return { data: { record, relations: [] } } as never;
    if (path.startsWith("/files"))
      return {
        data: [
          {
            id: "file-1",
            field: "attachment",
            name: "contrato.pdf",
            mime: "application/pdf",
            size: 2048,
            version: 1,
            created_at: "2026-09-09",
          },
          {
            id: "file-2",
            field: "other",
            name: "otro.pdf",
            mime: "application/pdf",
            size: 1024,
            version: 1,
            created_at: "2026-09-09",
          },
        ],
      } as never;
    return { data: [], total: 0 } as never;
  });
  vi.mocked(downloadCrm).mockResolvedValue(undefined);
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <RecordDetail
        object={{
          name: "test",
          label: "Test",
          description: "",
          config: makeConfig({
            name: { type: "Textbox", label: "Nombre" },
            attachment: { type: R2_ATTACHMENT_TYPE, label: "Archivo adjunto" },
            empty: { type: R2_ATTACHMENT_TYPE, label: "Sin adjuntos" },
          }),
        }}
        record={record}
        onEdit={() => {}}
        onClose={() => {}}
        onRefresh={() => {}}
      />
    </QueryClientProvider>,
  );
  expect(await screen.findByText("contrato.pdf")).toBeVisible();
  const field = screen.getByText("Archivo adjunto").parentElement!;
  expect(within(field).getByText(/2 KB/)).toBeVisible();
  expect(within(field).getByText(/application\/pdf/)).toBeVisible();
  expect(within(field).queryByText("otro.pdf")).toBeNull();
  expect(
    within(screen.getByText("Sin adjuntos").parentElement!).getByText("—"),
  ).toBeVisible();
  fireEvent.click(
    within(field).getByRole("button", { name: "Descargar contrato.pdf" }),
  );
  expect(downloadCrm).toHaveBeenCalledWith(
    "/api/file/file-1/download",
    "contrato.pdf",
  );
});
