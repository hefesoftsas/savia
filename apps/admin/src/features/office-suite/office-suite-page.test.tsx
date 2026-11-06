import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
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
    failDelete?: boolean;
    initialLocal?: unknown;
    providers?: {
      provider: string;
      label: string;
      accountLabel: string | null;
    }[];
  } = {},
) {
  const files: unknown[] = options.initialLocal
    ? [
        {
          role: "owner",
          ownerName: "Owner",
          ...(options.initialLocal as object),
        },
      ]
    : [];
  const connectedFiles: unknown[] = [];
  const connectedPosts: FormData[] = [];
  let failedConnected = false;
  const apiClient = new ApiClient({
    baseUrl: "https://savia.test",
    tokenSource: { getAccessToken: async () => null },
    fetcher: async (_url, init) => {
      const pathname = new URL(String(_url)).pathname;
      if (init?.method === "DELETE") {
        if (options.failDelete)
          return Response.json(
            { error: { code: "FAILED", message: "Deletion unavailable" } },
            { status: 503 },
          );
        const target = pathname.startsWith("/v1/connected-office-documents/")
          ? connectedFiles
          : files;
        const index = target.findIndex(
          (file) =>
            (file as { id: string }).id ===
            decodeURIComponent(pathname.split("/").pop()!),
        );
        if (index >= 0) target.splice(index, 1);
        return new Response(null, { status: 204 });
      }
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
          role: "owner",
          ownerName: "Owner",
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
  "savia:principal-changed",
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
  expect(link.closest("li")).toHaveTextContent("Google Drive");
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

it("filters saved documents by storage without changing their persisted links", async () => {
  const view = setup(false, {
    initialLocal: {
      id: "local-1",
      name: "Local.docx",
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size: 100,
      version: 1,
      updatedAt: "2026-10-02T10:00:00Z",
    },
  });
  await screen.findByRole("link", { name: "Local.docx" });
  view.connectedFiles.push(
    ...["google_drive", "onedrive_personal", "onedrive_business"].map(
      (provider) => ({
        id: provider,
        name: `${provider}.docx`,
        format: "docx",
        provider,
        url: `https://drive.example.test/${provider}`,
        createdAt: "2026-10-02T10:00:00Z",
      }),
    ),
  );
  fireEvent(window, new Event("focus"));
  await screen.findByRole("link", { name: "google_drive.docx" });
  fireEvent.click(screen.getByRole("button", { name: "Google Drive" }));
  expect(
    screen.queryByRole("link", { name: "Local.docx" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "onedrive_personal.docx" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "google_drive.docx" }),
  ).toHaveAttribute("href", "https://drive.example.test/google_drive");
  fireEvent.click(screen.getByRole("button", { name: "OneDrive" }));
  expect(
    screen.getByRole("link", { name: "onedrive_personal.docx" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "onedrive_business.docx" }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "All storage" }));
  expect(screen.getByRole("link", { name: "Local.docx" })).toBeInTheDocument();
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

const localDocument = {
  id: "delete-1",
  name: "Delete me.docx",
  mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  size: 100,
  version: 2,
  updatedAt: "2026-10-02T10:00:00Z",
};
it("hides disconnected storage filters and resets the filter on disconnect", async () => {
  const view = setup(false, { initialLocal: localDocument });
  await screen.findByRole("link", { name: localDocument.name });
  fireEvent.click(screen.getByRole("button", { name: "Google Drive" }));
  view.options.providers = [];
  fireEvent(window, new Event("savia:personal-integrations-changed"));
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Google Drive" }),
    ).not.toBeInTheDocument(),
  );
  expect(
    screen.queryByRole("button", { name: "OneDrive" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "All storage" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(
    screen.getByRole("link", { name: localDocument.name }),
  ).toBeInTheDocument();
});
it("only shows the connected cloud filter", async () => {
  setup(false, {
    providers: [
      { provider: "onedrive_business", label: "OneDrive", accountLabel: null },
    ],
  });
  await screen.findByText("You have no documents yet");
  expect(
    screen.queryByRole("button", { name: "Google Drive" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "OneDrive" })).toBeInTheDocument();
});
it("confirms document deletion and keeps it deleted after refresh", async () => {
  const view = setup(false, { initialLocal: localDocument });
  const remove = vi.spyOn(view.apiClient, "delete");
  await screen.findByRole("link", { name: localDocument.name });
  fireEvent.click(
    screen.getByRole("button", {
      name: `Delete document: ${localDocument.name}`,
    }),
  );
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }),
  );
  expect(remove).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", {
      name: `Delete document: ${localDocument.name}`,
    }),
  );
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Delete document",
    }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("link", { name: localDocument.name }),
    ).not.toBeInTheDocument(),
  );
  expect(remove).toHaveBeenCalledWith(
    "/v1/office-documents/delete-1",
    expect.objectContaining({ body: JSON.stringify({ version: 2 }) }),
  );
  fireEvent(window, new Event("focus"));
  await screen.findByText("You have no documents yet");
});
it("preserves the document and offers retry when deletion fails", async () => {
  const view = setup(false, { initialLocal: localDocument, failDelete: true });
  await screen.findByRole("link", { name: localDocument.name });
  fireEvent.click(
    screen.getByRole("button", {
      name: `Delete document: ${localDocument.name}`,
    }),
  );
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Delete document",
    }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Deletion unavailable",
  );
  expect(
    screen.getByRole("link", { name: localDocument.name, hidden: true }),
  ).toBeInTheDocument();
  await waitFor(() =>
    expect(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Delete document",
      }),
    ).toBeEnabled(),
  );
  view.options.failDelete = false;
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Delete document",
    }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
});
it("removes a connected reference with an explicit provider-file explanation", async () => {
  const view = setup(false, { providers: [] });
  await screen.findByText("You have no documents yet");
  view.connectedFiles.push({
    id: "ref-1",
    name: "Cloud.docx",
    format: "docx",
    provider: "google_drive",
    url: "https://drive.example.test/cloud",
    createdAt: "2026-10-02T10:00:00Z",
  });
  fireEvent(window, new Event("focus"));
  await screen.findByRole("link", { name: "Cloud.docx" });
  expect(
    screen
      .getByRole("link", { name: "Cloud.docx" })
      .closest("li")
      ?.querySelector("svg:not(.lucide)"),
  ).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Remove reference: Cloud.docx" }),
  );
  expect(screen.getByRole("dialog")).toHaveTextContent(
    "The file will remain in Google Drive or OneDrive. Only its saved link in Savia will be removed.",
  );
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Remove reference",
    }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("link", { name: "Cloud.docx" }),
    ).not.toBeInTheDocument(),
  );
});

it.each(["reader", "editor"])(
  "shows shared %s files without owner actions",
  async (role) => {
    setup(false, {
      initialLocal: { ...localDocument, role, ownerName: "Alice" },
    });
    await screen.findByRole("link", { name: localDocument.name });
    expect(
      screen.queryByRole("button", {
        name: `Delete document: ${localDocument.name}`,
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: `Share document: ${localDocument.name}`,
      }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Shared by Alice")).toBeInTheDocument();
    expect(
      screen.getByText(role === "reader" ? "Can view" : "Can edit"),
    ).toBeInTheDocument();
  },
);
it("offers sharing only on owned Savia files and clears it on tenant change", async () => {
  setup(false, { initialLocal: localDocument });
  await screen.findByRole("link", { name: localDocument.name });
  fireEvent.click(
    screen.getByRole("button", {
      name: `Share document: ${localDocument.name}`,
    }),
  );
  expect(
    screen.getByRole("dialog", { name: "Share document" }),
  ).toBeInTheDocument();
  fireEvent(window, new Event("savia:active-tenant-changed"));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
