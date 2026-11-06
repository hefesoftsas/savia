import {
  act,
  cleanup,
  render as baseRender,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  QueryClient,
  QueryClientProvider,
  type QueryKey,
} from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountPage } from "./account-page";

const realtime = vi.hoisted(() => ({
  refreshes: {} as Record<string, () => unknown>,
}));

vi.mock("@/realtime/use-realtime-query", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/realtime/use-realtime-query")>();
  const { useQueryClient } = await import("@tanstack/react-query");
  return {
    ...actual,
    useRealtimeQuery: ({
      topics,
      queryKeys,
    }: {
      topics: string[];
      queryKeys: readonly QueryKey[];
    }) => {
      const client = useQueryClient();
      const refresh = () =>
        Promise.all(
          queryKeys.map((queryKey) =>
            client.invalidateQueries({ queryKey, exact: true }),
          ),
        );
      realtime.refreshes[topics.join(",")] = refresh;
      return { changed: false, reload: refresh, status: "connected" };
    },
  };
});

function render(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return baseRender(ui, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}

const apiUrl = "https://api.savia.test";
const originalAvatar =
  "https://api.savia.test/v1/account/avatar?v=11111111-1111-4111-8111-111111111111";
const updatedAvatar =
  "https://api.savia.test/v1/account/avatar?v=22222222-2222-4222-8222-222222222222";

function sessionResponse(image: string | null) {
  return Response.json({
    user: {
      email: "savia.admin@example.test",
      image,
      name: "Savia Local Administrator",
      twoFactorEnabled: false,
    },
  });
}

class UploadRequest {
  static instances: UploadRequest[] = [];

  status = 0;

  responseText = "";

  withCredentials = false;

  upload: { onprogress?: (event: ProgressEvent<EventTarget>) => void } = {};

  onerror: (() => void) | null = null;

  onload: (() => void) | null = null;

  open = vi.fn();

  send = vi.fn();

  constructor() {
    UploadRequest.instances.push(this);
  }

  complete(status = 204) {
    this.status = status;
    this.onload?.();
  }

  progress(loaded: number, total: number) {
    this.upload.onprogress?.({
      lengthComputable: true,
      loaded,
      total,
    } as ProgressEvent<EventTarget>);
  }
}

class LoadedImage {
  complete = true;

  naturalWidth = 1;

  crossOrigin: string | null = null;

  referrerPolicy = "";

  addEventListener = vi.fn();

  removeEventListener = vi.fn();

  set src(_value: string) {}
}

afterEach(() => {
  cleanup();
  UploadRequest.instances = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  realtime.refreshes = {};
});

describe("AccountPage", () => {
  it("shows the saved image and uploads a selected supported avatar", async () => {
    const user = userEvent.setup();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(sessionResponse(originalAvatar))
      .mockResolvedValueOnce(sessionResponse(updatedAvatar));
    vi.stubGlobal("fetch", fetcher);
    vi.stubGlobal(
      "XMLHttpRequest",
      UploadRequest as unknown as typeof XMLHttpRequest,
    );
    vi.stubGlobal("Image", LoadedImage as unknown as typeof Image);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:avatar-preview");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

    render(<AccountPage apiUrl={apiUrl} />);

    expect(
      await screen.findByRole("img", {
        name: "Avatar de Savia Local Administrator",
      }),
    ).toHaveAttribute("src", originalAvatar);
    await user.upload(
      screen.getByLabelText("Cambiar avatar"),
      new File(["png-bytes"], "portrait.png", { type: "image/png" }),
    );

    expect(await screen.findByText("Subiendo avatar…")).toBeVisible();
    expect(UploadRequest.instances).toHaveLength(1);
    const request = UploadRequest.instances[0]!;
    expect(request.open).toHaveBeenCalledWith(
      "PUT",
      `${apiUrl}/v1/account/avatar`,
      true,
    );
    expect(request.withCredentials).toBe(true);
    request.progress(1, 2);
    expect(await screen.findByText("50% cargado")).toBeVisible();
    request.complete();

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByRole("img", {
        name: "Avatar de Savia Local Administrator",
      }),
    ).toHaveAttribute("src", updatedAvatar);
  });

  it("rejects an unsupported image before creating an upload request", async () => {
    const user = userEvent.setup({ applyAccept: false });
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(sessionResponse(null)),
    );
    vi.stubGlobal(
      "XMLHttpRequest",
      UploadRequest as unknown as typeof XMLHttpRequest,
    );

    render(<AccountPage apiUrl={apiUrl} />);

    await user.upload(
      await screen.findByLabelText("Cambiar avatar"),
      new File(["pdf-bytes"], "portrait.pdf", { type: "application/pdf" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Usa una imagen JPG, PNG o WebP de hasta 2 MB.",
    );
    expect(UploadRequest.instances).toHaveLength(0);
  });

  it("removes the current avatar", async () => {
    const user = userEvent.setup();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(sessionResponse(originalAvatar))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(sessionResponse(null));
    vi.stubGlobal("fetch", fetcher);
    vi.stubGlobal("Image", LoadedImage as unknown as typeof Image);

    render(<AccountPage apiUrl={apiUrl} />);

    await user.click(
      await screen.findByRole("button", { name: "Quitar avatar" }),
    );

    await waitFor(() =>
      expect(fetcher).toHaveBeenCalledWith(
        `${apiUrl}/v1/account/avatar`,
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
    expect(screen.queryByRole("button", { name: "Quitar avatar" })).toBeNull();
  });

  it("keeps account content and a dirty password form during profile refresh", async () => {
    const user = userEvent.setup();
    let resolveRefresh!: (response: Response) => void;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(sessionResponse(originalAvatar));
    vi.stubGlobal("fetch", fetcher);
    vi.stubGlobal("Image", LoadedImage as unknown as typeof Image);

    render(<AccountPage apiUrl={apiUrl} />);
    const avatar = await screen.findByRole("img", {
      name: "Avatar de Savia Local Administrator",
    });
    fetcher
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveRefresh = resolve;
          }),
      )
      .mockResolvedValue(sessionResponse(updatedAvatar));

    act(() => {
      void realtime.refreshes.account?.();
    });

    expect(
      screen.getByRole("img", {
        name: "Avatar de Savia Local Administrator",
      }),
    ).toBe(avatar);
    expect(screen.queryByText("Cargando tu cuenta…")).not.toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(resolveRefresh).toBeTypeOf("function"));
    await act(async () => resolveRefresh(sessionResponse(updatedAvatar)));

    await user.click(screen.getByRole("tab", { name: "Seguridad" }));
    const password = screen.getByLabelText("Contraseña actual");
    await user.type(password, "current password draft");
    await act(async () => realtime.refreshes.account?.());
    expect(screen.getByLabelText("Contraseña actual")).toHaveValue(
      "current password draft",
    );
    await user.click(screen.getByRole("tab", { name: "Perfil" }));
    expect(
      await screen.findByRole("img", {
        name: "Avatar de Savia Local Administrator",
      }),
    ).toHaveAttribute("src", updatedAvatar);
  });

  it("hides cached profile data after an access-denied session refresh", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(sessionResponse(originalAvatar));
    vi.stubGlobal("fetch", fetcher);
    vi.stubGlobal("Image", LoadedImage as unknown as typeof Image);

    render(<AccountPage apiUrl={apiUrl} />);
    expect(
      await screen.findByRole("img", {
        name: "Avatar de Savia Local Administrator",
      }),
    ).toBeVisible();
    fetcher.mockResolvedValueOnce(
      Response.json({ error: { message: "Access revoked" } }, { status: 403 }),
    );

    await act(async () => {
      await realtime.refreshes.account?.();
    });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));

    expect(
      screen.queryByRole("img", {
        name: "Avatar de Savia Local Administrator",
      }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Access revoked");
    expect(screen.queryByLabelText("Cambiar avatar")).not.toBeInTheDocument();
  });

  it("retains the profile DOM after a transient session refresh failure", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(sessionResponse(originalAvatar));
    vi.stubGlobal("fetch", fetcher);
    vi.stubGlobal("Image", LoadedImage as unknown as typeof Image);

    render(<AccountPage apiUrl={apiUrl} />);
    const avatar = await screen.findByRole("img", {
      name: "Avatar de Savia Local Administrator",
    });
    fetcher.mockResolvedValueOnce(
      Response.json(
        { error: { message: "Temporary account read failure" } },
        { status: 503 },
      ),
    );

    await act(async () => {
      await realtime.refreshes.account?.();
    });

    expect(
      screen.getByRole("img", {
        name: "Avatar de Savia Local Administrator",
      }),
    ).toBe(avatar);
    expect(await screen.findByText(/Refresh failed:/)).toBeVisible();
  });
});
