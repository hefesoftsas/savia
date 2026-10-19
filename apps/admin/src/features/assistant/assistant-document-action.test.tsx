// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { useLayoutEffect, type PropsWithChildren } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ApiClient } from "@/api/api-client";
import type { PluginAssistantProvider } from "@savia/studio-shared/plugin-assistant";
import { OFFICE_MAX_SIZE } from "@savia/studio-shared/office";
import { OfficeAvailabilityContext } from "@/features/office-settings/office-availability";
import {
  AssistantDocumentAction,
  type AssistantDocumentActionDefinition,
  documentSourceKey,
} from "./assistant-document-action";

Object.defineProperty(globalThis.crypto, "subtle", {
  value: webcrypto.subtle,
  configurable: true,
});

const action: AssistantDocumentActionDefinition = {
  id: "proposal-docx",
  label: "Generar propuesta DOCX",
  format: "docx",
};

function provider(
  invoke: PluginAssistantProvider["invoke"],
  overrides: Partial<PluginAssistantProvider> = {},
): PluginAssistantProvider {
  return {
    title: "Tender",
    actionId: "assistant-chat",
    context: { dossierId: "tender-1", companyId: "company-1" },
    sessionId: "session-1",
    invoke,
    close: vi.fn(),
    ...overrides,
  };
}

function popup() {
  return {
    opener: window,
    document: {
      createElement: vi.fn(() => ({ name: "", content: "" })),
      head: { append: vi.fn() },
    },
    location: { replace: vi.fn() },
    close: vi.fn(),
  };
}

function generated(
  invoke = vi.fn(async () => ({
    revision: 1,
    messages: [],
    document: {
      url: "https://secop.example/private/download/signed-token",
      fileName: "propuesta-tender-1.docx",
      format: "docx" as const,
    },
  })),
) {
  return invoke;
}

type PostFormMock = ReturnType<
  typeof vi.fn<
    (
      path: string,
      body: FormData,
      init?: RequestInit,
    ) => Promise<{ data: { id: string } }>
  >
>;

function api(
  postForm: PostFormMock = vi.fn(async () => ({
    data: { id: "office_doc_123" },
  })),
) {
  return {
    postForm,
    get: vi.fn(async () => ({ data: null })),
    post: vi.fn(),
  } as unknown as Pick<ApiClient, "postForm" | "get" | "post">;
}

function AvailableOffice({ children }: PropsWithChildren) {
  return (
    <OfficeAvailabilityContext.Provider
      value={{ enabled: true, loading: false, error: false }}
    >
      {children}
    </OfficeAvailabilityContext.Provider>
  );
}

function renderAction(
  invoke: PluginAssistantProvider["invoke"] = generated(),
  apiClient = api(),
) {
  return render(
    <AssistantDocumentAction
      provider={provider(invoke)}
      action={action}
      apiClient={apiClient}
    />,
    { wrapper: AvailableOffice },
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it.each([
  ["disabled", { enabled: false, loading: false, error: false }],
  ["loading", { enabled: false, loading: true, error: false }],
  ["unavailable", { enabled: false, loading: false, error: true }],
])(
  "hides the action and does not generate while Office is %s",
  (_state, value) => {
    const invoke = vi.fn();
    const open = vi.spyOn(window, "open");
    render(
      <OfficeAvailabilityContext.Provider value={value}>
        <AssistantDocumentAction
          provider={provider(invoke)}
          action={action}
          apiClient={api()}
        />
      </OfficeAvailabilityContext.Provider>,
    );

    expect(screen.queryByRole("button", { name: action.label })).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  },
);

it("aborts the upload and closes the pending editor tab when Office is disabled", async () => {
  const reserved = popup();
  vi.spyOn(window, "open").mockReturnValue(reserved as never);
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
  );
  let resolveUpload!: (value: { data: { id: string } }) => void;
  const postForm: PostFormMock = vi.fn(
    (_path: string, _form: FormData, _init?: RequestInit) =>
      new Promise<{ data: { id: string } }>(
        (resolve) => (resolveUpload = resolve),
      ),
  );
  const invoke = generated();
  const availability = {
    enabled: true,
    loading: false,
    error: false,
  };
  function AvailabilityHarness({ enabled }: { enabled: boolean }) {
    return (
      <OfficeAvailabilityContext.Provider value={{ ...availability, enabled }}>
        <AssistantDocumentAction
          provider={provider(invoke)}
          action={action}
          apiClient={api(postForm)}
        />
      </OfficeAvailabilityContext.Provider>
    );
  }
  const view = render(<AvailabilityHarness enabled />);
  fireEvent.click(screen.getByRole("button", { name: action.label }));
  await screen.findByText("Saving to Office suite…");
  const uploadSignal = postForm.mock.calls[0]![2]?.signal;
  expect(uploadSignal).toBeInstanceOf(AbortSignal);
  expect(uploadSignal!.aborted).toBe(false);

  view.rerender(<AvailabilityHarness enabled={false} />);
  expect(uploadSignal!.aborted).toBe(true);
  expect(reserved.close).toHaveBeenCalledTimes(1);
  resolveUpload({ data: { id: "office_doc_late" } });
  await Promise.resolve();
  expect(reserved.location.replace).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: action.label })).toBeNull();
});

it("uploads the generated DOCX to Savia, then opens its Office editor", async () => {
  const reserved = popup();
  vi.spyOn(window, "open").mockReturnValue(reserved as never);
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { "content-length": "3" },
    }),
  );
  const postForm: PostFormMock = vi.fn(async () => ({
    data: { id: "office_doc_123" },
  }));
  const invoke = generated();

  renderAction(invoke, api(postForm));
  fireEvent.click(screen.getByRole("button", { name: action.label }));

  expect(await screen.findByText("Saved in Office suite.")).toBeVisible();
  expect(invoke).toHaveBeenCalledWith({
    method: "generate-document",
    actionId: "proposal-docx",
  });
  expect(fetch).toHaveBeenCalledWith(
    "https://secop.example/private/download/signed-token",
    expect.objectContaining({
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: expect.any(AbortSignal),
    }),
  );
  const [path, form, init] = postForm.mock.calls[0]!;
  expect(path).toBe("/v1/office-documents");
  expect(form).toBeInstanceOf(FormData);
  expect(form.get("file")).toMatchObject({
    name: "Tender-propuesta-tender-1.docx",
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  expect(init).toEqual({ signal: expect.any(AbortSignal) });
  expect(reserved.opener).toBeNull();
  expect(reserved.location.replace).toHaveBeenCalledWith(
    "/office/?base=%2Fv1%2Foffice-documents&file=office_doc_123",
  );
  expect(screen.getByRole("link", { name: "Open document" })).toHaveAttribute(
    "href",
    "/office/?base=%2Fv1%2Foffice-documents&file=office_doc_123",
  );
});

it("rejects declared and streamed files above the Office limit without uploading", async () => {
  const cases = [
    new Response(null, {
      headers: { "content-length": String(OFFICE_MAX_SIZE + 1) },
    }),
    new Response(new Uint8Array(OFFICE_MAX_SIZE + 1), { status: 200 }),
  ];
  for (const source of cases) {
    vi.spyOn(window, "open").mockReturnValueOnce(popup() as never);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(source);
    const postForm: PostFormMock = vi.fn(async () => ({
      data: { id: "unused" },
    }));
    const { unmount } = renderAction(generated(), api(postForm));
    fireEvent.click(screen.getByRole("button", { name: action.label }));
    expect(
      await screen.findByText("Could not generate or save the document."),
    ).toBeVisible();
    expect(postForm).not.toHaveBeenCalled();
    unmount();
    vi.restoreAllMocks();
  }
});

it("reports fetch and upload failures with a retry action", async () => {
  vi.spyOn(window, "open").mockReturnValue(popup() as never);
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response("provider unavailable", { status: 503 }),
  );
  const postForm: PostFormMock = vi.fn(async () => ({
    data: { id: "unused" },
  }));
  renderAction(generated(), api(postForm));
  fireEvent.click(screen.getByRole("button", { name: action.label }));
  expect(
    await screen.findByText("Could not generate or save the document."),
  ).toBeVisible();
  expect(postForm).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
});

it("saves successfully when the popup is blocked and exposes a reopen link", async () => {
  vi.spyOn(window, "open").mockReturnValue(null);
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(new Uint8Array([4, 5]), { status: 200 }),
  );
  renderAction();
  fireEvent.click(screen.getByRole("button", { name: action.label }));
  expect(
    await screen.findByRole("link", { name: "Open document" }),
  ).toHaveAttribute("target", "_blank");
});

it("aborts work on context change before a late provider result can fetch or navigate", async () => {
  const reserved = popup();
  vi.spyOn(window, "open").mockReturnValue(reserved as never);
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  let resolve!: (value: never) => void;
  const invoke = vi.fn(() => new Promise<never>((done) => (resolve = done)));
  const currentProvider = provider(invoke);
  const postForm: PostFormMock = vi.fn(async () => ({
    data: { id: "unused" },
  }));
  let closeCountDuringParentLayout = -1;
  function ObserveProvider({ current }: { current: PluginAssistantProvider }) {
    useLayoutEffect(() => {
      if (current.sessionId === "session-2")
        closeCountDuringParentLayout = reserved.close.mock.calls.length;
    }, [current.sessionId]);
    return (
      <AssistantDocumentAction
        provider={current}
        action={action}
        apiClient={api(postForm)}
      />
    );
  }
  const view = render(<ObserveProvider current={currentProvider} />, {
    wrapper: AvailableOffice,
  });
  fireEvent.click(screen.getByRole("button", { name: action.label }));
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
  view.rerender(
    <ObserveProvider current={provider(invoke, { sessionId: "session-2" })} />,
  );
  expect(closeCountDuringParentLayout).toBe(1);
  expect(reserved.close).toHaveBeenCalledTimes(1);
  resolve({
    revision: 1,
    messages: [],
    document: {
      url: "https://secop.example/private/download/token",
      fileName: "proposal.docx",
      format: "docx",
    },
  } as never);
  await Promise.resolve();
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(postForm).not.toHaveBeenCalled();
  expect(reserved.location.replace).not.toHaveBeenCalled();
});

it("aborts an in-flight authenticated upload when the context changes", async () => {
  const reserved = popup();
  vi.spyOn(window, "open").mockReturnValue(reserved as never);
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
  );
  let resolveUpload!: (value: { data: { id: string } }) => void;
  const postForm: PostFormMock = vi.fn(
    (_path: string, _form: FormData, _init?: RequestInit) =>
      new Promise<{ data: { id: string } }>(
        (resolve) => (resolveUpload = resolve),
      ),
  );
  const invoke = generated();
  const apiClient = api(postForm);
  function ObserveProvider({ sessionId }: { sessionId: string }) {
    return (
      <AssistantDocumentAction
        provider={provider(invoke, { sessionId })}
        action={action}
        apiClient={apiClient}
      />
    );
  }
  const view = render(<ObserveProvider sessionId="session-1" />, {
    wrapper: AvailableOffice,
  });
  fireEvent.click(screen.getByRole("button", { name: action.label }));
  await screen.findByText("Saving to Office suite…");
  const uploadSignal = postForm.mock.calls[0]![2]?.signal;
  expect(uploadSignal).toBeInstanceOf(AbortSignal);
  expect(uploadSignal!.aborted).toBe(false);

  view.rerender(<ObserveProvider sessionId="session-2" />);
  expect(uploadSignal!.aborted).toBe(true);
  resolveUpload({ data: { id: "office_doc_late" } });
  await Promise.resolve();
  expect(reserved.close).toHaveBeenCalledTimes(1);
  expect(reserved.location.replace).not.toHaveBeenCalled();
  expect(screen.queryByRole("status")).toBeNull();
});

it("ignores duplicate clicks while generation is pending", async () => {
  vi.spyOn(window, "open").mockReturnValue(popup() as never);
  const invoke = vi.fn(() => new Promise<never>(() => {}));
  renderAction(invoke);
  fireEvent.click(screen.getByRole("button", { name: action.label }));
  fireEvent.click(screen.getByRole("button", { name: action.label }));
  await screen.findByText("Preparing the document…");
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
});

it("reopens a bound draft without generating or uploading another copy", async () => {
  const reserved = popup();
  vi.spyOn(window, "open").mockReturnValue(reserved as never);
  const invoke = generated();
  const client = api();
  vi.mocked(client.get).mockResolvedValue({ data: { id: "existing_edited" } });
  renderAction(invoke, client);
  fireEvent.click(screen.getByRole("button", { name: action.label }));
  await screen.findByRole("link", { name: "Open document" });
  expect(invoke).not.toHaveBeenCalled();
  expect(client.postForm).not.toHaveBeenCalled();
  expect(reserved.location.replace).toHaveBeenCalledWith(
    "/office/?base=%2Fv1%2Foffice-documents&file=existing_edited",
  );
});

it("adopts the newest exactly named owned legacy draft without replacing edits", async () => {
  vi.spyOn(window, "open").mockReturnValue(popup() as never);
  const client = api();
  vi.mocked(client.get)
    .mockResolvedValueOnce({ data: null })
    .mockResolvedValueOnce({
      data: [
        {
          id: "shared",
          name: "Tender-borrador.docx",
          role: "editor",
          updatedAt: "2026-10-18",
        },
        {
          id: "old",
          name: "Tender-borrador.docx",
          role: "owner",
          updatedAt: "2026-10-15",
        },
        {
          id: "new",
          name: "Tender-borrador.docx",
          role: "owner",
          updatedAt: "2026-10-16",
        },
        {
          id: "other",
          name: "Other-borrador.docx",
          role: "owner",
          updatedAt: "2026-10-19",
        },
      ],
    });
  vi.mocked(client.post).mockResolvedValue({ data: { id: "new" } });
  const invoke = generated();
  render(
    <AssistantDocumentAction
      provider={provider(invoke)}
      action={{ ...action, fileName: "borrador.docx" }}
      apiClient={client}
    />,
    { wrapper: AvailableOffice },
  );
  fireEvent.click(screen.getByRole("button", { name: action.label }));
  await screen.findByRole("link", { name: "Open document" });
  expect(client.post).toHaveBeenCalledWith(
    "/v1/office-documents/new/source",
    { key: expect.stringMatching(/^assistant:[a-f0-9]{64}$/) },
    { signal: expect.any(AbortSignal) },
  );
  expect(invoke).not.toHaveBeenCalled();
  expect(client.postForm).not.toHaveBeenCalled();
});

it("keeps draft keys stable across sessions and property order, but separates connections and contexts", async () => {
  const p = provider(generated());
  const first = await documentSourceKey(p, action.id);
  expect(
    await documentSourceKey(
      {
        ...p,
        sessionId: "fresh",
        context: { companyId: "company-1", dossierId: "tender-1" },
      },
      action.id,
    ),
  ).toBe(first);
  expect(
    await documentSourceKey(
      { ...p, context: { dossierId: "other" } },
      action.id,
    ),
  ).not.toBe(first);
  expect(
    await documentSourceKey({ ...p, connectionId: "other" }, action.id),
  ).not.toBe(first);
});

it("fails closed on draft lookup errors instead of generating a duplicate", async () => {
  const reserved = popup();
  vi.spyOn(window, "open").mockReturnValue(reserved as never);
  const client = api();
  vi.mocked(client.get).mockRejectedValue(new Error("unavailable"));
  const invoke = generated();
  renderAction(invoke, client);
  fireEvent.click(screen.getByRole("button", { name: action.label }));
  await screen.findByRole("alert");
  expect(invoke).not.toHaveBeenCalled();
  expect(client.postForm).not.toHaveBeenCalled();
  expect(reserved.close).toHaveBeenCalled();
});

it("skips legacy documents already bound to a different context", async () => {
  vi.spyOn(window, "open").mockReturnValue(popup() as never);
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(new Uint8Array([1]), { status: 200 }),
  );
  const client = api();
  vi.mocked(client.get)
    .mockResolvedValueOnce({ data: null })
    .mockResolvedValueOnce({
      data: [
        {
          id: "other_context",
          name: "Tender-borrador.docx",
          role: "owner",
          updatedAt: "2026-10-17",
        },
      ],
    });
  vi.mocked(client.post).mockRejectedValue(
    Object.assign(new Error("bound"), { code: "SOURCE_KEY_CONFLICT" }),
  );
  const invoke = generated();
  render(
    <AssistantDocumentAction
      provider={provider(invoke)}
      action={{ ...action, fileName: "borrador.docx" }}
      apiClient={client}
    />,
    { wrapper: AvailableOffice },
  );
  fireEvent.click(screen.getByRole("button", { name: action.label }));
  await screen.findByRole("link", { name: "Open document" });
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(client.postForm).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("alert")).toBeNull();
});
