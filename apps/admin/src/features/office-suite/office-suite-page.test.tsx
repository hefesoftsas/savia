import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ApiClient } from "@/api/api-client";
import { OfficeSuitePage } from "./office-suite-page";
import { createBlankOfficeFile } from "../office/new-office-file";
vi.mock("../office/new-office-file", () => ({
  createBlankOfficeFile: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
function setup(
  fail = false,
  options: {
    failConnectedOnce?: boolean;
    failConnectedList?: boolean;
    initialLocal?: unknown;
    providers?: {
      provider: string;
      label: string;
      accountLabel: string | null;
    }[];
  } = {},
) {
  const files: unknown[] = options.initialLocal ? [options.initialLocal] : [];
  const connectedFiles: unknown[] = [];
  const connectedPosts: FormData[] = [];
  let failedConnected = false;
  const apiClient = new ApiClient({
    baseUrl: "https://savia.test",
    tokenSource: { getAccessToken: async () => null },
    fetcher: async (_url, init) => {
      const pathname = new URL(String(_url)).pathname;
      if (pathname === "/v1/connected-office-documents/providers")
        return Response.json({
          data: options.providers ?? [
            {
              provider: "google_drive",
              label: "Google Drive",
              accountLabel: "casa@example.test",
            },
            {
              provider: "onedrive_personal",
              label: "OneDrive personal",
              accountLabel: null,
            },
          ],
        });
      if (pathname === "/v1/connected-office-documents") {
        if (init?.method === "POST") {
          const body = init.body as FormData;
          connectedPosts.push(body);
          if (options.failConnectedOnce && !failedConnected) {
            failedConnected = true;
            return Response.json(
              {
                error: { code: "FAILED", message: "Cloud storage unavailable" },
              },
              { status: 503 },
            );
          }
          const provider = body.get("provider") as string;
          const format = body.get("format") as string;
          const saved = {
            id: `cloud-${connectedFiles.length + 1}`,
            name: `${body.get("name")}.${format}`,
            format,
            provider,
            url: "https://drive.example.test/file/cloud-1",
            createdAt: "2026-10-02T10:00:00Z",
          };
          connectedFiles.push(saved);
          return Response.json({ data: saved }, { status: 201 });
        }
        if (options.failConnectedList)
          return Response.json(
            {
              error: { code: "FAILED", message: "Connected list unavailable" },
            },
            { status: 503 },
          );
        return Response.json({ data: connectedFiles });
      }
      if (init?.method === "POST") {
        if (fail)
          return Response.json(
            { error: { code: "FAILED", message: "Storage unavailable" } },
            { status: 503 },
          );
        const file = (init.body as FormData).get("file") as File;
        const saved = {
          id: "doc-1",
          name: file.name,
          mime: file.type,
          size: file.size,
          version: 1,
          updatedAt: "2026-10-02T10:00:00Z",
        };
        files.push(saved);
        return Response.json({ data: saved });
      }
      return Response.json({ data: files });
    },
  });
  vi.mocked(createBlankOfficeFile).mockResolvedValue(
    new File(["test"], "Budget.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  const view = render(<OfficeSuitePage services={{ apiClient }} />);
  return { apiClient, files, connectedFiles, connectedPosts, options, ...view };
}
it.each([
  "savia:active-tenant-changed",
  "savia:identity-changed",
  "savia:session-cleared",
])(
  "clears private document links and reloads when %s fires",
  async (eventName) => {
    const original = {
      id: "tenant-a-document",
      name: "Tenant A.docx",
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size: 10,
      version: 1,
      updatedAt: "2026-10-02T10:00:00Z",
    };
    const view = setup(false, { initialLocal: original });
    await screen.findByRole("link", { name: "Tenant A.docx" });
    view.connectedFiles.push({
      id: "cloud-old",
      name: "Private old link",
      format: "docx",
      provider: "google_drive",
      url: "https://docs.google.com/document/d/old/edit",
      createdAt: original.updatedAt,
    });
    fireEvent(window, new Event("focus"));
    await screen.findByRole("link", { name: "Private old link" });
    view.files.splice(0, view.files.length, {
      ...original,
      id: "tenant-b-document",
      name: "Tenant B.docx",
    });
    view.connectedFiles.length = 0;
    fireEvent(window, new Event(eventName));
    expect(
      screen.queryByRole("link", { name: "Tenant A.docx" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Private old link" }),
    ).not.toBeInTheDocument();
    await screen.findByRole("link", { name: "Tenant B.docx" });
  },
);

it("creates a persisted spreadsheet inline and exposes its editor link", async () => {
  setup();
  await screen.findByText("You have no documents yet");
  fireEvent.click(screen.getByRole("button", { name: /Spreadsheet/ }));
  fireEvent.change(screen.getByRole("textbox", { name: "Document name" }), {
    target: { value: "Budget" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create and save" }));
  expect(
    await screen.findByRole("link", { name: "Budget.xlsx" }),
  ).toHaveAttribute(
    "href",
    "/office/?base=%2Fv1%2Foffice-documents&file=doc-1",
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(createBlankOfficeFile).toHaveBeenCalledWith("xlsx", "Budget");
});
it("preserves the creation form and offers retry after failed persistence", async () => {
  setup(true);
  await screen.findByText("You have no documents yet");
  fireEvent.change(screen.getByRole("textbox", { name: "Document name" }), {
    target: { value: "Budget" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create and save" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Storage unavailable",
  );
  expect(screen.getByRole("textbox", { name: "Document name" })).toHaveValue(
    "Budget",
  );
  expect(screen.getByRole("button", { name: "Create and save" })).toBeEnabled();
  expect(
    screen.queryByRole("link", { name: "Budget.xlsx" }),
  ).not.toBeInTheDocument();
});

it("creates a Google Drive document, persists its link, and lists it after reload", async () => {
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  const view = setup();
  await screen.findByText("You have no documents yet");
  const storage = await screen.findByLabelText("Save document in");
  expect(
    Array.from((storage as HTMLSelectElement).options).map(
      (option) => option.value,
    ),
  ).toEqual(["savia", "google_drive", "onedrive_personal"]);
  fireEvent.change(storage, { target: { value: "google_drive" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Document name" }), {
    target: { value: "Cloud notes" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create and save" }));

  const link = await screen.findByRole("link", { name: "Cloud notes.docx" });
  expect(link).toHaveAttribute(
    "href",
    "https://drive.example.test/file/cloud-1",
  );
  expect(link).toHaveAttribute("target", "_blank");
  expect(link).toHaveAttribute("rel", "noopener noreferrer");
  expect(
    screen.getByText(/Google Drive · Stored in connected drive/),
  ).toBeTruthy();
  expect(open).toHaveBeenCalledWith("about:blank", "_blank");
  expect(view.connectedPosts).toHaveLength(1);
  const body = view.connectedPosts[0];
  expect(body.get("provider")).toBe("google_drive");
  expect(body.get("format")).toBe("docx");
  expect(body.get("name")).toBe("Cloud notes");
  expect(body.get("requestId")).toMatch(/^[0-9a-f-]{36}$/i);
  expect(body.has("file")).toBe(false);

  view.unmount();
  render(<OfficeSuitePage services={{ apiClient: view.apiClient }} />);
  expect(
    await screen.findByRole("link", { name: "Cloud notes.docx" }),
  ).toBeTruthy();
  expect(view.connectedPosts[0].get("requestId")).toBe(body.get("requestId"));
});

it("opens the provider editor in the prepared tab after its link is saved", async () => {
  const replace = vi.fn();
  const waitingTab = {
    opener: window,
    document: { title: "", body: document.createElement("body") },
    location: { replace },
    close: vi.fn(),
  };
  vi.spyOn(window, "open").mockReturnValue(waitingTab as unknown as Window);
  setup();
  await screen.findByText("You have no documents yet");
  fireEvent.change(screen.getByLabelText("Save document in"), {
    target: { value: "google_drive" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Document name" }), {
    target: { value: "Cloud notes" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create and save" }));
  await screen.findByRole("link", { name: "Cloud notes.docx" });
  expect(waitingTab.opener).toBeNull();
  expect(waitingTab.document.body.textContent).toBe(
    "Preparing connected document…",
  );
  expect(replace).toHaveBeenCalledWith(
    "https://drive.example.test/file/cloud-1",
  );
  expect(waitingTab.close).not.toHaveBeenCalled();
});

it("includes a generated Office template for OneDrive and reuses an idempotency key on retry", async () => {
  vi.spyOn(window, "open").mockReturnValue(null);
  const view = setup(false, { failConnectedOnce: true });
  await screen.findByText("You have no documents yet");
  fireEvent.change(await screen.findByLabelText("Save document in"), {
    target: { value: "onedrive_personal" },
  });
  fireEvent.click(screen.getByRole("button", { name: /Spreadsheet/ }));
  fireEvent.change(screen.getByRole("textbox", { name: "Document name" }), {
    target: { value: "Quarterly plan" },
  });
  const create = screen.getByRole("button", { name: "Create and save" });
  fireEvent.click(create);
  expect(await screen.findByText("Cloud storage unavailable")).toBeTruthy();
  expect(screen.getByRole("textbox", { name: "Document name" })).toHaveValue(
    "Quarterly plan",
  );
  expect(view.connectedPosts[0].has("file")).toBe(true);
  const requestId = view.connectedPosts[0].get("requestId");
  expect(requestId).toMatch(/^[0-9a-f-]{36}$/i);

  fireEvent.click(create);
  expect(
    await screen.findByRole("link", { name: "Quarterly plan.xlsx" }),
  ).toBeTruthy();
  expect(view.connectedPosts).toHaveLength(2);
  expect(view.connectedPosts[1].get("requestId")).toBe(requestId);

  fireEvent.change(screen.getByRole("textbox", { name: "Document name" }), {
    target: { value: "Quarterly plan revised" },
  });
  fireEvent.click(create);
  expect(
    await screen.findByRole("link", { name: "Quarterly plan revised.xlsx" }),
  ).toBeTruthy();
  expect(view.connectedPosts[2].get("requestId")).not.toBe(requestId);
});

it("keeps Savia documents visible when the connected-drive list is unavailable", async () => {
  setup(false, {
    failConnectedList: true,
    initialLocal: {
      id: "local-1",
      name: "Budget.xlsx",
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      size: 10,
      version: 1,
      updatedAt: "2026-10-02T10:00:00Z",
    },
  });
  expect(
    await screen.findByText("Could not load connected-drive documents."),
  ).toBeTruthy();
  expect(screen.getByRole("link", { name: "Budget.xlsx" })).toBeTruthy();
});
