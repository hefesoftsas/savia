// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { OfficeDocumentsWidgetBody } from "./office-documents-widget";
import { AddWidgetDialog } from "./add-widget-dialog";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("shows the five most recent caller documents from both storage sources", async () => {
  const apiClient = {
    get: vi.fn(async (path: string) => {
      if (path === "/v1/office-settings") return { data: { enabled: true } };
      if (path === "/v1/office-documents")
        return {
          data: [
            {
              id: "saved-1",
              name: "Savia latest",
              updatedAt: "2026-10-03T12:00:00Z",
            },
            {
              id: "saved-2",
              name: "Savia older",
              updatedAt: "2026-10-01T12:00:00Z",
            },
            {
              id: "saved-3",
              name: "Savia oldest",
              updatedAt: "2026-09-28T12:00:00Z",
            },
          ],
        };
      if (path === "/v1/connected-office-documents")
        return {
          data: [
            {
              id: "drive-1",
              name: "Drive latest",
              provider: "google_drive",
              url: "https://drive.google.com/file/d/1",
              createdAt: "2026-10-03T13:00:00Z",
            },
            {
              id: "drive-2",
              name: "Drive older",
              provider: "onedrive_personal",
              url: "https://onedrive.live.com/file/2",
              createdAt: "2026-10-02T12:00:00Z",
            },
            {
              id: "drive-3",
              name: "Drive oldest",
              provider: "onedrive_business",
              url: "https://onedrive.office.com/file/3",
              createdAt: "2026-09-27T12:00:00Z",
            },
          ],
        };
      throw new Error(`Unexpected API path: ${path}`);
    }),
  };

  render(<OfficeDocumentsWidgetBody apiClient={apiClient as never} />);

  expect(
    await screen.findByRole("link", { name: /Drive latest/ }),
  ).toHaveAttribute("href", "https://drive.google.com/file/d/1");
  expect(screen.getByRole("link", { name: /Savia latest/ })).toHaveAttribute(
    "href",
    "/office/?base=%2Fv1%2Foffice-documents&file=saved-1",
  );
  expect(screen.getByRole("link", { name: /Drive older/ })).toBeVisible();
  expect(screen.getByRole("link", { name: /Savia older/ })).toBeVisible();
  expect(screen.getByRole("link", { name: /Savia oldest/ })).toBeVisible();
  expect(screen.queryByText("Drive oldest")).not.toBeInTheDocument();
  expect(
    screen
      .getAllByRole("link")
      .filter(
        (link) =>
          link.textContent?.includes("Drive") ||
          link.textContent?.includes("Savia"),
      ),
  ).toHaveLength(5);
  expect(screen.getByRole("link", { name: "New document" })).toHaveAttribute(
    "href",
    "/#/office-suite",
  );
  expect(
    screen.getByRole("link", { name: "View all documents" }),
  ).toHaveAttribute("href", "/#/office-suite");
});

it("does not request documents while the office suite is disabled", async () => {
  const apiClient = {
    get: vi.fn(async (path: string) => {
      if (path === "/v1/office-settings") return { data: { enabled: false } };
      throw new Error(`Unexpected API path: ${path}`);
    }),
  };

  render(<OfficeDocumentsWidgetBody apiClient={apiClient as never} />);

  expect(
    await screen.findByText("Office suite is disabled for this workspace."),
  ).toBeVisible();
  expect(apiClient.get).toHaveBeenCalledTimes(1);
});

it("keeps Savia documents visible when connected-drive loading fails", async () => {
  const apiClient = {
    get: vi.fn(async (path: string) => {
      if (path === "/v1/office-settings") return { data: { enabled: true } };
      if (path === "/v1/office-documents")
        return {
          data: [
            {
              id: "saved-1",
              name: "Available Savia document",
              updatedAt: "2026-10-03T12:00:00Z",
            },
          ],
        };
      if (path === "/v1/connected-office-documents")
        throw new Error("connected drive unavailable");
      throw new Error(`Unexpected API path: ${path}`);
    }),
  };

  render(<OfficeDocumentsWidgetBody apiClient={apiClient as never} />);

  expect(
    await screen.findByRole("link", { name: /Available Savia document/ }),
  ).toBeVisible();
  expect(
    screen.getByText(
      "One document source could not be loaded. Showing available documents.",
    ),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
  expect(
    screen.queryByText("No recent documents yet."),
  ).not.toBeInTheDocument();
});

it("does not claim an empty complete list if the other source fails", async () => {
  const apiClient = {
    get: vi.fn(async (path: string) => {
      if (path === "/v1/office-settings") return { data: { enabled: true } };
      if (path === "/v1/office-documents") return { data: [] };
      if (path === "/v1/connected-office-documents")
        throw new Error("connected drive unavailable");
      throw new Error(`Unexpected API path: ${path}`);
    }),
  };

  render(<OfficeDocumentsWidgetBody apiClient={apiClient as never} />);

  expect(
    await screen.findByText(
      "One document source could not be loaded. The list may be incomplete.",
    ),
  ).toBeVisible();
  expect(
    screen.queryByText("No recent documents yet."),
  ).not.toBeInTheDocument();
});

it("reports total failure instead of rendering an empty success state", async () => {
  const apiClient = {
    get: vi.fn(async (path: string) => {
      if (path === "/v1/office-settings") return { data: { enabled: true } };
      if (
        path === "/v1/office-documents" ||
        path === "/v1/connected-office-documents"
      )
        throw new Error("document source unavailable");
      throw new Error(`Unexpected API path: ${path}`);
    }),
  };

  render(<OfficeDocumentsWidgetBody apiClient={apiClient as never} />);

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not load recent documents.",
  );
  expect(
    screen.queryByText("No recent documents yet."),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
});

it("ignores an office settings response from the previous identity", async () => {
  let resolvePrevious!: (value: { data: { enabled: boolean } }) => void;
  const previousSettings = new Promise<{ data: { enabled: boolean } }>(
    (resolve) => {
      resolvePrevious = resolve;
    },
  );
  const apiClient = {
    get: vi.fn((path: string) => {
      if (path !== "/v1/office-settings")
        throw new Error(`Unexpected API path: ${path}`);
      if (apiClient.get.mock.calls.length === 1) return previousSettings;
      return Promise.resolve({ data: { enabled: false } });
    }),
  };

  render(<OfficeDocumentsWidgetBody apiClient={apiClient as never} />);
  window.dispatchEvent(new Event("savia:identity-changed"));
  expect(
    await screen.findByText("Office suite is disabled for this workspace."),
  ).toBeVisible();

  resolvePrevious({ data: { enabled: true } });
  await Promise.resolve();
  expect(
    screen.queryByText("No recent documents yet."),
  ).not.toBeInTheDocument();
  expect(apiClient.get).toHaveBeenCalledTimes(2);
});

it("lets the user add the office documents system widget", async () => {
  Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
    configurable: true,
    value: () => false,
  });
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
    configurable: true,
    value: vi.fn(),
  });
  const user = userEvent.setup();
  const onAdd = vi.fn(async () => true);
  render(
    <AddWidgetDialog
      open
      onOpenChange={vi.fn()}
      apiClient={undefined}
      onAdd={onAdd}
      saving={false}
    />,
  );

  await user.click(screen.getByRole("button", { name: "Personal" }));
  await user.click(
    screen.getByRole("combobox", { name: "Widget del sistema" }),
  );
  await user.click(screen.getByRole("option", { name: /Office documents/ }));
  await user.click(screen.getByRole("button", { name: "Agregar widget" }));

  expect(onAdd).toHaveBeenCalledWith({
    id: "office_documents",
    kind: "office_documents",
  });
});
