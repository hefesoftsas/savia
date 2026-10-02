import { StrictMode } from "react";
import {
  cleanup,
  render,
  screen,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router-dom";
import { ApiClient } from "@/api/api-client";
import type { AppServices } from "@/app-services";
import { AppServicesProvider } from "@/features/assistant/assistant-context";
import { PagesSidebar } from "./pages-sidebar";
import { PagesPage } from "./pages-page";
import type { PageDocument } from "./client";

vi.mock("./editor", () => ({
  PageEditor: () => <textarea aria-label="Document body" />,
}));
afterEach(cleanup);
function setup(route = "/pages/project") {
  const common = {
    ownerId: "owner",
    version: 1,
    updatedAt: "2026-10-01T10:00:00Z",
    isShared: false,
    role: "owner" as const,
    content: [],
  };
  const documents: PageDocument[] = [
    {
      ...common,
      id: "project",
      rootId: "project",
      parentId: null,
      title: "Projects",
      kind: "folder",
    },
    {
      ...common,
      id: "notes",
      rootId: "project",
      parentId: "project",
      title: "Launch notes",
      kind: "page",
    },
  ];
  const creates: unknown[] = [];
  const deletes: string[] = [];
  const api = new ApiClient({
    baseUrl: "https://savia.test",
    tokenSource: { getAccessToken: async () => null },
    fetcher: async (input, init) => {
      const url = new URL(String(input));
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        creates.push(body);
        const document = {
          ...common,
          ...body,
          id: "new",
          parentId: body.parentId ?? null,
          rootId: body.parentId ? "project" : "new",
        };
        documents.push(document);
        return Response.json({ data: document });
      }
      const id = url.pathname.split("/").at(-1);
      if (init?.method === "DELETE") {
        deletes.push(`${id}?${url.searchParams.toString()}`);
        const index = documents.findIndex((page) => page.id === id);
        if (index !== -1) documents.splice(index, 1);
        return Response.json({ data: { deleted: true } });
      }
      const document = documents.find((page) => page.id === id);
      if (init?.method === "PUT" && document) {
        Object.assign(document, JSON.parse(String(init.body)), {
          version: document.version + 1,
        });
        return Response.json({ data: document });
      }
      return Response.json({ data: id === "pages" ? documents : document });
    },
  });
  const services = { apiClient: api } as AppServices;
  const router = createMemoryRouter(
    [
      {
        element: (
          <AppServicesProvider services={services}>
            <PagesSidebar onNavigate={() => {}} />
            <Outlet />
          </AppServicesProvider>
        ),
        children: [
          {
            path: "/pages/:pageId?",
            element: <PagesPage services={services} />,
          },
        ],
      },
    ],
    { initialEntries: [route] },
  );
  render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
  return { router, creates, deletes };
}
it("confirms sidebar deletion and removes the page only after confirmation", async () => {
  const { deletes } = setup("/pages/project");
  await userEvent.click(
    await screen.findByRole("button", { name: "Expand Projects" }),
  );
  await screen.findByRole("link", { name: "Launch notes" });
  await userEvent.click(
    screen.getByRole("button", { name: "Delete Launch notes" }),
  );
  expect(screen.getByRole("dialog", { name: "Delete page" })).toBeVisible();
  expect(deletes).toEqual([]);
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("link", { name: "Launch notes" })).toBeVisible();
  expect(deletes).toEqual([]);
  await userEvent.click(
    screen.getByRole("button", { name: "Delete Launch notes" }),
  );
  await userEvent.click(screen.getByRole("button", { name: "Delete page" }));
  await waitFor(() => expect(deletes).toEqual(["notes?version=1"]));
  await waitFor(() =>
    expect(
      screen.queryByRole("link", { name: "Launch notes" }),
    ).not.toBeInTheDocument(),
  );
});
it("keeps a collapsible folder tree in the main navigation and shows folder contents without an editor", async () => {
  const { router } = setup("/pages/notes");
  const collapse = await screen.findByRole("button", {
    name: "Collapse Projects",
  });
  expect(
    await screen.findByRole("textbox", { name: "Document body" }),
  ).toBeVisible();
  await userEvent.click(collapse);
  expect(
    screen.queryByRole("link", { name: "Launch notes" }),
  ).not.toBeInTheDocument();
  await userEvent.click(
    screen.getByRole("button", { name: "Expand Projects" }),
  );
  expect(screen.getByRole("link", { name: "Launch notes" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await userEvent.click(screen.getAllByRole("link", { name: "Projects" })[0]);
  await waitFor(() =>
    expect(router.state.location.pathname).toBe("/pages/project"),
  );
  expect(await screen.findByRole("region", { name: "Contents" })).toBeVisible();
  expect(
    screen.queryByRole("textbox", { name: "Document body" }),
  ).not.toBeInTheDocument();
});
it("creates one persisted folder from the sidebar and updates its title in navigation after saving", async () => {
  const { router, creates } = setup("/pages?create=folder");
  await waitFor(() =>
    expect(router.state.location.pathname).toBe("/pages/new"),
  );
  expect(creates).toEqual([{ title: "Untitled folder", kind: "folder" }]);
  fireEvent.change(await screen.findByRole("textbox", { name: "Heading" }), {
    target: { value: "Research" },
  });
  await waitFor(
    () => expect(screen.getByRole("link", { name: "Research" })).toBeVisible(),
    { timeout: 2500 },
  );
  expect(
    screen.queryByRole("textbox", { name: "Document body" }),
  ).not.toBeInTheDocument();
});
