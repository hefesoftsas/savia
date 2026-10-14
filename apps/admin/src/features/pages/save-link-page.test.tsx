import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { StoreContextProvider, memoryStore } from "ra-core";
import { ApiClient } from "@/api/api-client";
import { SaveLinkPage } from "./save-link-page";
import {
  clearSharedLink,
  readSharedLink,
  updateSharedLink,
} from "@/pwa/share-target";

afterEach(() => {
  cleanup();
  clearSharedLink();
  vi.restoreAllMocks();
});

function setup(
  options: {
    failOnce?: boolean;
    foldersFail?: boolean;
    rejectOnce?: boolean;
  } = {},
) {
  const captures: any[] = [];
  const apiClient = new ApiClient({
    baseUrl: "https://savia.test",
    tokenSource: { getAccessToken: async () => null },
    fetcher: async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/v1/tenants/current")
        return Response.json({ data: { id: 1, name: "My workspace" } });
      if (url.pathname === "/v1/pages/capture") {
        captures.push(JSON.parse(String(init?.body)));
        if (options.failOnce && captures.length === 1)
          throw new TypeError("Network lost");
        if (options.rejectOnce && captures.length === 1)
          return Response.json(
            { error: { code: "PRIVATE_CAPTURE_FOLDER_REQUIRED" } },
            { status: 409 },
          );
        return Response.json({
          data: {
            id: "saved",
            rootId: "folder",
            parentId: "folder",
            title: captures.at(-1).title,
            kind: "page",
            role: "owner",
            ownerId: "me",
            version: 1,
            isShared: false,
            updatedAt: new Date().toISOString(),
            content: [],
          },
        });
      }
      if (options.foldersFail)
        return Response.json({ error: { code: "FAILED" } }, { status: 500 });
      return Response.json({
        data: [
          {
            id: "editable",
            kind: "folder",
            title: "Team reading",
            role: "editor",
            parentId: null,
            rootId: "editable",
            isShared: true,
          },
          {
            id: "readonly",
            kind: "folder",
            title: "Read only",
            role: "reader",
          },
          { id: "page", kind: "page", title: "Not a folder", role: "owner" },
        ],
      });
    },
  });
  const authSession = {
    getIdentity: async () => ({
      id: "me",
      fullName: "Alex",
      email: "alex@example.com",
    }),
    login: vi.fn().mockResolvedValue(undefined),
  };
  const router = createMemoryRouter(
    [
      {
        path: "/save-link",
        element: <SaveLinkPage services={{ apiClient, authSession }} />,
      },
      { path: "/pages/:id?", element: <p>Saved page</p> },
    ],
    { initialEntries: ["/save-link"] },
  );
  render(
    <StoreContextProvider value={memoryStore({ locale: "es" })}>
      <RouterProvider router={router} />
    </StoreContextProvider>,
  );
  return { captures, router };
}
function shared() {
  updateSharedLink({
    captureId: crypto.randomUUID(),
    title: "Interesting article",
    url: "https://example.com/article",
    note: "Read later",
    receivedAt: Date.now(),
  });
}

it("reviews a received link and saves only on confirmation to a private default folder", async () => {
  shared();
  const { captures, router } = setup();
  expect(
    await screen.findByDisplayValue("Interesting article"),
  ).toBeInTheDocument();
  await screen.findByText(/alex@example.com/);
  expect(captures).toHaveLength(0);
  expect(
    screen.queryByRole("option", { name: "Read only" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Guardar enlace" }));
  await waitFor(() =>
    expect(router.state.location.pathname).toBe("/pages/saved"),
  );
  expect(captures).toEqual([
    expect.objectContaining({
      title: "Interesting article",
      url: "https://example.com/article",
      note: "Read later",
      folderTitle: "Guardados",
    }),
  ]);
  expect(captures[0].parentId).toBeUndefined();
  expect(readSharedLink()).toBeNull();
});

it("keeps the draft and capture ID when retrying an uncertain save", async () => {
  shared();
  const { captures } = setup({ failOnce: true });
  await screen.findByText(/alex@example.com/);
  fireEvent.click(screen.getByRole("button", { name: "Guardar enlace" }));
  await screen.findByRole("alert");
  expect(readSharedLink()?.url).toBe("https://example.com/article");
  fireEvent.click(screen.getByRole("button", { name: "Reintentar guardado" }));
  await screen.findByText("Saved page");
  expect(captures).toHaveLength(2);
  expect(captures[1]).toEqual(captures[0]);
});

it("lets the user choose an editable folder and explains inherited access", async () => {
  shared();
  const { captures } = setup();
  await screen.findByRole("option", { name: "Team reading" });
  fireEvent.change(screen.getByLabelText("Carpeta"), {
    target: { value: "editable" },
  });
  expect(screen.getByText(/permisos de la carpeta/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Guardar enlace" }));
  await screen.findByText("Saved page");
  expect(captures[0].parentId).toBe("editable");
});

it("offers manual entry when there is no draft and prevents unsafe URLs", async () => {
  const { captures } = setup();
  await screen.findByText(/alex@example.com/);
  fireEvent.change(screen.getByLabelText("Enlace"), {
    target: { value: "javascript:alert(1)" },
  });
  expect(screen.getByRole("button", { name: "Guardar enlace" })).toBeDisabled();
  expect(captures).toHaveLength(0);
});

it("keeps default saving available when the folder list cannot load", async () => {
  shared();
  setup({ foldersFail: true });
  await screen.findByText(/No se pudieron cargar las carpetas/);
  fireEvent.click(screen.getByRole("button", { name: "Guardar enlace" }));
  await screen.findByText("Saved page");
});

it("clears an unsaved capture on cancel", async () => {
  shared();
  const { router, captures } = setup();
  fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/pages"));
  expect(readSharedLink()).toBeNull();
  expect(captures).toHaveLength(0);
});

it("allows correcting the destination after a known server rejection", async () => {
  shared();
  const { captures } = setup({ rejectOnce: true });
  await screen.findByText(/alex@example.com/);
  fireEvent.click(screen.getByRole("button", { name: "Guardar enlace" }));
  await screen.findByText(/No se pudo guardar en ese destino/);
  expect(screen.getByLabelText("Carpeta")).toBeEnabled();
  fireEvent.change(screen.getByLabelText("Carpeta"), {
    target: { value: "editable" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Guardar enlace" }));
  await screen.findByText("Saved page");
  expect(captures[1].parentId).toBe("editable");
  expect(captures[1].captureId).toBe(captures[0].captureId);
});

it("preserves the incoming draft when an expired session requires login", async () => {
  shared();
  setup();
  await screen.findByText(/alex@example.com/);
  act(() => window.dispatchEvent(new Event("savia:session-cleared")));
  expect(
    screen.getByRole("button", { name: "Iniciar sesión para continuar" }),
  ).toBeEnabled();
  expect(readSharedLink()?.url).toBe("https://example.com/article");
  expect(screen.getByRole("button", { name: "Guardar enlace" })).toBeDisabled();
});

it("clears the draft when the authenticated principal changes", async () => {
  shared();
  setup();
  await screen.findByText(/alex@example.com/);
  act(() => window.dispatchEvent(new Event("savia:principal-changed")));
  expect(readSharedLink()).toBeNull();
  expect(screen.getByLabelText("Enlace")).toHaveValue("");
  expect(screen.getByRole("button", { name: "Guardar enlace" })).toBeDisabled();
});

it("restores the destination and locks an uncertain request across a reload", async () => {
  shared();
  const first = setup({ failOnce: true });
  await screen.findByRole("option", { name: "Team reading" });
  fireEvent.change(screen.getByLabelText("Carpeta"), {
    target: { value: "editable" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Guardar enlace" }));
  await screen.findByRole("alert");
  cleanup();
  const second = setup();
  await screen.findByText(/alex@example.com/);
  expect(screen.getByLabelText("Carpeta")).toHaveValue("editable");
  expect(screen.getByLabelText("Título")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Reintentar guardado" }));
  await screen.findByText("Saved page");
  expect(second.captures[0]).toEqual(first.captures[0]);
});
