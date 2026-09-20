// @vitest-environment jsdom
import React from "react";
import { afterEach, it, expect, vi } from "vitest";
import { screen, waitFor, cleanup } from "@testing-library/react";
import { render } from "./locale-test-render";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { R2AttachmentField } from "../r2-attachment-field";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("does not show attachment loading before a new record is saved", () => {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <R2AttachmentField
        field="contract"
        object="contracts"
        onPendingChange={vi.fn()}
        pending={[]}
        policy={{
          accept: ["application/pdf"],
          maxFiles: 1,
          maxSize: 1024,
        }}
      />
    </QueryClientProvider>,
  );

  expect(screen.queryByText("Cargando archivos…")).toBeNull();
  expect(
    screen.getByText(
      "El archivo se cargará ahora y se asociará al guardar el registro.",
    ),
  ).toBeTruthy();
});

it("lists attachments belonging to its field only", async () => {
  const fetcher = vi.fn(async () =>
    Response.json({
      data: [
        {
          id: "attachment-1",
          name: "contract.pdf",
          mime: "application/pdf",
          size: 200,
          field: "contract",
          version: 1,
          created_at: "2026-09-09T00:00:00.000Z",
        },
      ],
    }),
  );
  vi.stubGlobal("fetch", fetcher);

  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <R2AttachmentField
        field="contract"
        object="contracts"
        onPendingChange={vi.fn()}
        pending={[]}
        policy={{
          accept: ["application/pdf"],
          maxFiles: 1,
          maxSize: 1024,
        }}
        recordId="record-1"
      />
    </QueryClientProvider>,
  );

  expect(await screen.findByText("contract.pdf")).toBeTruthy();
  await waitFor(() =>
    expect(String(fetcher.mock.calls[0]?.[0])).toContain(
      "/api/files/contracts/record-1?field=contract",
    ),
  );
});
