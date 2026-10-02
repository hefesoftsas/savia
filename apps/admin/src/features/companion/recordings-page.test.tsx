import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StoreContextProvider, memoryStore } from "ra-core";
import { CompanionRecordingsPage } from "./recordings-page";
import type { CompanionRecordingsClient } from "./client";
const recording = {
  id: "one",
  source: "system",
  durationSeconds: 10,
  bytes: 40000,
  createdAt: "2026-10-01T12:00:00Z",
  format: "ogg",
  sha256: "hash",
};
const result = {
  transcript: { text: "A real returned transcript" },
  summary: {
    summary: "Backend saved notes",
    decisions: ["Ship"],
    actions: [],
    openQuestions: [],
  },
};
const mockClient = () => ({
  list: vi.fn().mockResolvedValue({ recordings: [recording], cursor: null }),
  audio: vi.fn().mockResolvedValue(new Blob(["ogg"], { type: "audio/ogg" })),
  notes: vi.fn().mockResolvedValue({ transcript: null, summary: null }),
  generate: vi.fn().mockResolvedValue(result),
});
beforeEach(() => {
  URL.createObjectURL = vi.fn().mockReturnValue("blob:private-audio");
  URL.revokeObjectURL = vi.fn();
});
afterEach(cleanup);
function show(client: ReturnType<typeof mockClient>) {
  return render(
    <StoreContextProvider value={memoryStore({ locale: "en" })}>
      <CompanionRecordingsPage
        client={client as unknown as CompanionRecordingsClient}
      />
    </StoreContextProvider>,
  );
}
it("requires consent before processing and restores saved notes after remount", async () => {
  const client = mockClient(),
    user = userEvent.setup();
  const view = show(client);
  const generate = await screen.findByRole("button", {
    name: "Generate summary",
  });
  await waitFor(() =>
    expect(client.audio).toHaveBeenCalledWith("one", expect.any(AbortSignal)),
  );
  expect(generate).toBeDisabled();
  expect(client.generate).not.toHaveBeenCalled();
  await user.click(screen.getByRole("checkbox"));
  await user.click(generate);
  expect(await screen.findByText("Backend saved notes")).toBeVisible();
  expect(client.generate).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:private-audio");
  client.notes.mockResolvedValue(result);
  show(client);
  expect(await screen.findByText("Backend saved notes")).toBeVisible();
  expect(client.generate).toHaveBeenCalledTimes(1);
});
it("exposes an empty state without fictional samples", async () => {
  const client = mockClient();
  client.list.mockResolvedValue({ recordings: [], cursor: null });
  show(client);
  expect(await screen.findByText("No recordings yet")).toBeVisible();
  expect(client.audio).not.toHaveBeenCalled();
});
