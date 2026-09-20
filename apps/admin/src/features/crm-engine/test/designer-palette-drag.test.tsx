// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { render } from "./studio-test-render";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Designer from "../designer";
import { designerPaletteDragType } from "../designer-field-dnd";
import { makeConfig, type CrmObject } from "@savia/crm-shared/metadata";

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/objects")) {
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/api/settings/geocoding")) {
        return new Response(
          JSON.stringify({
            geoapifyConfigured: false,
            geoapifyStored: false,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
      return new Response(JSON.stringify({ error: "unexpected" }), {
        status: 404,
      });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("adds a field when dragging a palette item into the canvas", () => {
  const object: CrmObject = {
    name: "addresses",
    label: "Direcciones",
    description: "",
    config: makeConfig({ name: { type: "Textbox", label: "Nombre" } }),
  };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Designer object={object} onSaved={vi.fn()} />
    </QueryClientProvider>,
  );

  const paletteButton = screen.getByRole("button", { name: "Número" });
  const dropZone = screen.getByRole("region", {
    name: /Sin sección \(1 campo\)/,
  });
  const fieldList = dropZone.querySelector(".grouped-designer-zone-list");
  expect(fieldList).toBeTruthy();

  fireEvent.dragStart(paletteButton, {
    dataTransfer: {
      setData: vi.fn(),
      effectAllowed: "copy",
      types: [designerPaletteDragType],
    },
  });
  fireEvent.dragOver(fieldList!, {
    dataTransfer: {
      types: [designerPaletteDragType],
      dropEffect: "copy",
    },
    preventDefault: vi.fn(),
    clientY: 999,
  });
  expect(
    document.querySelector(".grouped-designer-insert-indicator-line"),
  ).toBeTruthy();
  fireEvent.drop(fieldList!, {
    dataTransfer: {
      getData: (type: string) =>
        type === designerPaletteDragType ? "Number" : "",
      types: [designerPaletteDragType],
    },
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  });

  expect(screen.getAllByText("Número").length).toBeGreaterThan(1);
  expect(
    screen.getByRole("region", { name: /Sin sección \(2 campos\)/ }),
  ).toBeTruthy();
});
