// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { PluginAssistantProvider } from "@savia/studio-shared/plugin-assistant";
import {
  AssistantDocumentAction,
  type AssistantDocumentActionDefinition,
} from "./assistant-document-action";

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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("requests the advertised action once and downloads the returned private DOCX", async () => {
  const reserved = popup();
  vi.spyOn(window, "open").mockReturnValue(reserved as never);
  const invoke = vi.fn(async () => ({
    revision: 1,
    messages: [],
    document: {
      url: "https://secop.example/private/download/signed-token",
      fileName: "propuesta-tender-1.docx",
      format: "docx" as const,
    },
  }));
  render(
    <AssistantDocumentAction provider={provider(invoke)} action={action} />,
  );

  fireEvent.click(screen.getByRole("button", { name: action.label }));
  expect(await screen.findByText("Download started.")).toBeVisible();
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(invoke).toHaveBeenCalledWith({
    method: "generate-document",
    actionId: "proposal-docx",
  });
  expect(reserved.opener).toBeNull();
  expect(reserved.location.replace).toHaveBeenCalledWith(
    "https://secop.example/private/download/signed-token",
  );
  expect(reserved.document.head.append).toHaveBeenCalledWith(
    expect.objectContaining({ name: "referrer", content: "no-referrer" }),
  );
  expect(reserved.close).not.toHaveBeenCalled();
});

it.each([
  ["missing result", undefined],
  [
    "unsafe URL",
    { url: "javascript:alert(1)", fileName: "bad.docx", format: "docx" },
  ],
])(
  "closes the temporary tab and offers retry for a %s",
  async (_name, document) => {
    const reserved = popup();
    vi.spyOn(window, "open").mockReturnValue(reserved as never);
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({ revision: 1, messages: [], document })
      .mockResolvedValueOnce({
        revision: 1,
        messages: [],
        document: {
          url: "https://secop.example/private/download/token",
          fileName: "proposal.docx",
          format: "docx",
        },
      });
    render(
      <AssistantDocumentAction provider={provider(invoke)} action={action} />,
    );

    fireEvent.click(screen.getByRole("button", { name: action.label }));
    expect(
      await screen.findByText("Could not generate the document."),
    ).toBeVisible();
    expect(reserved.close).toHaveBeenCalledTimes(1);
    expect(reserved.location.replace).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Download started.")).toBeVisible();
    expect(invoke).toHaveBeenCalledTimes(2);
  },
);

it("does not invoke without a popup and ignores duplicate clicks while pending", async () => {
  const open = vi.spyOn(window, "open").mockReturnValueOnce(null);
  const invoke = vi.fn(() => new Promise<never>(() => {}));
  render(
    <AssistantDocumentAction provider={provider(invoke)} action={action} />,
  );

  fireEvent.click(screen.getByRole("button", { name: action.label }));
  expect(
    await screen.findByText("Allow pop-ups to start the download."),
  ).toBeVisible();
  expect(invoke).not.toHaveBeenCalled();

  open.mockReturnValue(popup() as never);
  fireEvent.click(screen.getByRole("button", { name: action.label }));
  expect(screen.getByRole("button", { name: action.label })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: action.label }));
  expect(invoke).toHaveBeenCalledTimes(1);
});

it("closes a reserved tab and ignores a late result after context changes or unmount", async () => {
  const reserved = popup();
  vi.spyOn(window, "open").mockReturnValue(reserved as never);
  let resolve!: (value: never) => void;
  const invoke = vi.fn(() => new Promise<never>((done) => (resolve = done)));
  const currentProvider = provider(invoke);
  const view = render(
    <AssistantDocumentAction provider={currentProvider} action={action} />,
  );
  fireEvent.click(screen.getByRole("button", { name: action.label }));
  expect(invoke).toHaveBeenCalledTimes(1);

  view.rerender(
    <AssistantDocumentAction
      provider={provider(invoke, { sessionId: "session-2" })}
      action={action}
    />,
  );
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
  expect(reserved.location.replace).not.toHaveBeenCalled();
  expect(screen.queryByRole("status")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: action.label }));
  view.unmount();
  expect(reserved.close).toHaveBeenCalledTimes(2);
});
