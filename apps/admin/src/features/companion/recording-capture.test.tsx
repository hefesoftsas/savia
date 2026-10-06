import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StoreContextProvider, memoryStore } from "ra-core";
import { RecordingCapture } from "./recording-capture";
import type { CompanionRecordingsClient } from "./client";

beforeEach(() => {
  URL.createObjectURL = vi.fn().mockReturnValue("blob:take-audio");
  URL.revokeObjectURL = vi.fn();
});
afterEach(cleanup);

function show(
  props: Partial<React.ComponentProps<typeof RecordingCapture>> = {},
) {
  const client = (props.client ?? {}) as unknown as CompanionRecordingsClient;
  const onSaved = props.onSaved ?? vi.fn();
  render(
    <StoreContextProvider value={memoryStore({ locale: "en" })}>
      <RecordingCapture
        onSaved={onSaved}
        onClose={vi.fn()}
        onBusy={vi.fn()}
        {...props}
        client={client}
      />
    </StoreContextProvider>,
  );
  return { client, onSaved };
}

it("requires consent and reports a denied microphone", async () => {
  const user = userEvent.setup();
  const denied = new DOMException("denied", "NotAllowedError");
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia: vi.fn().mockRejectedValue(denied) },
    configurable: true,
  });
  Object.defineProperty(globalThis, "AudioContext", {
    value: vi.fn(),
    configurable: true,
  });
  show();
  const start = screen.getByRole("button", { name: "Start recording" });
  expect(start).toBeDisabled();
  await user.click(screen.getByText("I have permission to record this audio."));
  await user.click(start);
  expect(await screen.findByText(/Microphone access was denied/)).toBeVisible();
});

it("records, previews, names and saves the take as wav", async () => {
  const user = userEvent.setup();
  const take = {
    blob: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" }),
    durationSeconds: 61,
  };
  const stop = vi.fn().mockResolvedValue(take);
  const startCapture = vi.fn().mockResolvedValue({ stop, cancel: vi.fn() });
  const saved = { id: "fresh", name: "Charla.wav" };
  const { client, onSaved } = show({
    startCapture,
    client: {
      upload: vi.fn().mockResolvedValue(saved),
    } as unknown as CompanionRecordingsClient,
  });
  await user.click(screen.getByText("I have permission to record this audio."));
  await user.click(screen.getByRole("button", { name: "Start recording" }));
  expect(
    await screen.findByRole("button", { name: "Stop recording" }),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Stop recording" }));
  const name = await screen.findByLabelText("Recording name");
  expect((name as HTMLInputElement).value).toMatch(/.+/);
  await user.clear(name);
  await user.type(name, "Charla");
  await user.click(screen.getByRole("button", { name: "Save recording" }));
  const upload = client.upload as ReturnType<typeof vi.fn>;
  await waitFor(() => expect(upload).toHaveBeenCalledOnce());
  const file = upload.mock.calls[0][0] as File;
  expect(file).toBeInstanceOf(File);
  expect(file.name).toBe("Charla.wav");
  expect(onSaved).toHaveBeenCalledWith(saved);
});
