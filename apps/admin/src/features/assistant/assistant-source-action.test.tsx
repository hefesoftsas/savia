// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AssistantSourceAction } from "./assistant-source-action";
import type { PluginAssistantProvider } from "@savia/studio-shared/plugin-assistant";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const provider = (
  invoke: PluginAssistantProvider["invoke"],
): PluginAssistantProvider => ({
  sessionId: "one",
  title: "Tender",
  actionId: "chat",
  context: { dossierId: "t1" },
  invoke,
  close: vi.fn(),
});
it("opens the server-resolved PDF at the cited page without sending document URLs", async () => {
  const popup = {
    opener: window,
    location: { replace: vi.fn() },
    close: vi.fn(),
  };
  vi.spyOn(window, "open").mockReturnValue(popup as never);
  const invoke = vi.fn(async () => ({
    revision: 1,
    messages: [],
    source: {
      url: "https://secop.example/private/source/ticket",
      page: 4,
    },
  }));
  render(
    <AssistantSourceAction
      provider={provider(invoke)}
      messageId="answer1"
      citationId="S001"
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Open source" }));
  await waitFor(() =>
    expect(popup.location.replace).toHaveBeenCalledWith(
      "https://secop.example/private/source/ticket#page=4",
    ),
  );
  expect(invoke).toHaveBeenCalledWith({
    method: "open-source",
    messageId: "answer1",
    citationId: "S001",
  });
  expect(popup.opener).toBeNull();
});
it("closes the blank tab and offers retry after an expired source or unsafe response", async () => {
  const popup = {
    opener: null,
    location: { replace: vi.fn() },
    close: vi.fn(),
  };
  vi.spyOn(window, "open").mockReturnValue(popup as never);
  render(
    <AssistantSourceAction
      provider={provider(
        vi.fn(async () => ({
          revision: 1,
          messages: [],
          source: { url: "javascript:alert(1)" },
        })),
      )}
      messageId="answer1"
      citationId="S001"
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Open source" }));
  await screen.findByRole("alert");
  expect(popup.close).toHaveBeenCalled();
  expect(popup.location.replace).not.toHaveBeenCalled();
  expect(
    screen
      .getByRole("button", { name: "Open source" })
      .hasAttribute("disabled"),
  ).toBe(false);
});
