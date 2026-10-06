import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StoreContextProvider, memoryStore, useLocaleState } from "ra-core";
import { ApiClientError } from "@/api/api-client";
import { CompanionRecordingsPage } from "./recordings-page";
import type { CompanionRecordingsClient } from "./client";
vi.mock("../assistant/recording-assistant", () => ({
  RecordingAssistant: ({
    context,
  }: {
    context: { kind: string; id: string; title: string };
  }) => (
    <div
      data-testid="recording-assistant"
      data-kind={context.kind}
      data-id={context.id}
      data-title={context.title}
    />
  ),
}));
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
  remove: vi.fn().mockResolvedValue(undefined),
});
beforeEach(() => {
  URL.createObjectURL = vi.fn().mockReturnValue("blob:private-audio");
  URL.revokeObjectURL = vi.fn();
});
afterEach(cleanup);
function LocaleButton({ locale, label }: { locale: string; label: string }) {
  const [, setLocale] = useLocaleState();
  return <button onClick={() => setLocale(locale)}>{label}</button>;
}
function show(client: ReturnType<typeof mockClient>) {
  return render(
    <StoreContextProvider value={memoryStore({ locale: "en" })}>
      <>
        <LocaleButton locale="es" label="Español" />
        <CompanionRecordingsPage
          client={client as unknown as CompanionRecordingsClient}
        />
      </>
    </StoreContextProvider>,
  );
}
it("starts processing without a routine consent checkbox and restores saved notes", async () => {
  const client = mockClient(),
    user = userEvent.setup();
  const view = show(client);
  const generate = await screen.findByRole("button", {
    name: "Generate summary",
  });
  await waitFor(() =>
    expect(client.audio).toHaveBeenCalledWith("one", expect.any(AbortSignal)),
  );
  expect(generate).toBeEnabled();
  expect(client.generate).not.toHaveBeenCalled();
  await user.click(generate);
  expect(await screen.findByText("Backend saved notes")).toBeVisible();
  const assistant = await screen.findByTestId("recording-assistant");
  expect(assistant).toHaveAttribute("data-kind", "recording");
  expect(assistant).toHaveAttribute("data-id", "one");
  expect(assistant).toHaveAttribute("data-title", "System audio");
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(client.generate).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:private-audio");
  client.notes.mockResolvedValue(result);
  show(client);
  expect(await screen.findByText("Backend saved notes")).toBeVisible();
  expect(client.generate).toHaveBeenCalledTimes(1);
});

it("shows safe provider diagnostics and recovers a transcript after summary processing fails", async () => {
  const client = mockClient();
  client.generate.mockRejectedValue(
    new ApiClientError(
      502,
      "PROVIDER_REQUEST_FAILED",
      "Provider request failed",
      {
        error: {
          code: "PROVIDER_REQUEST_FAILED",
          message: "Provider request failed",
          providerOperation: "summary",
          upstreamStatus: 429,
        },
      },
    ),
  );
  client.notes.mockResolvedValue({
    transcript: {
      text: "A transcript persisted before summary generation failed.",
      source: "system",
      model: "openai/whisper-large-v3",
      durationSeconds: 10,
    },
    summary: null,
  });
  const user = userEvent.setup();
  show(client);
  await user.click(
    await screen.findByRole("button", { name: "Generate summary" }),
  );

  expect(
    await screen.findByText(
      "Summary provider returned HTTP 429. Check provider usage before trying again.",
    ),
  ).toBeVisible();
  expect(
    await screen.findByText(
      "A transcript persisted before summary generation failed.",
    ),
  ).toBeInTheDocument();
  expect(client.notes).toHaveBeenCalledWith("one");
  expect(
    screen.queryByLabelText("I understand saved results will be replaced."),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Generate summary" }));
  expect(client.generate).toHaveBeenNthCalledWith(2, "one", "auto", false);
  await user.click(screen.getByRole("button", { name: "Español" }));
  expect(
    await screen.findByText(
      "El proveedor de resúmenes respondió HTTP 429. Revisa el consumo del proveedor antes de reintentar.",
    ),
  ).toBeVisible();
});

it("keeps the saved language selector available and asks consent only to change it", async () => {
  const client = mockClient();
  client.notes.mockResolvedValue({ ...result, language: "pt" });
  client.generate.mockResolvedValue({ ...result, language: "en" });
  const user = userEvent.setup();
  show(client);

  const language = await screen.findByLabelText("Transcript language");
  await waitFor(() => {
    expect(language).toBeEnabled();
    expect(language).toHaveValue("pt");
  });
  expect(
    screen.queryByLabelText("I understand saved results will be replaced."),
  ).not.toBeInTheDocument();

  await user.selectOptions(language, "en");
  const consent = await screen.findByLabelText(
    "I understand saved results will be replaced.",
  );
  const generate = screen.getByRole("button", { name: "Generate summary" });
  expect(generate).toBeDisabled();
  await user.click(consent);
  expect(generate).toBeEnabled();
  await user.click(generate);
  await waitFor(() =>
    expect(client.generate).toHaveBeenCalledWith("one", "en", true),
  );
});

it("shows a saved language outside the preset list instead of displaying Automatic", async () => {
  const client = mockClient();
  client.notes.mockResolvedValue({ ...result, language: "zh" });
  show(client);

  const language = await screen.findByLabelText("Transcript language");
  await waitFor(() => {
    expect(language).toBeEnabled();
    expect(language).toHaveValue("zh");
  });
  expect(screen.getByRole("option", { name: /zh/ })).toBeInTheDocument();
});

it("keeps language changes disabled while saved notes are loading", async () => {
  const client = mockClient();
  let resolveNotes!: (notes: any) => void;
  client.notes.mockImplementation(
    () => new Promise((resolve) => (resolveNotes = resolve)),
  );
  show(client);

  const language = await screen.findByLabelText("Transcript language");
  expect(language).toBeDisabled();
  resolveNotes({ ...result, language: "zh" });
  await waitFor(() => {
    expect(language).toBeEnabled();
    expect(language).toHaveValue("zh");
  });
});

it("ignores unrecognized provider diagnostic values", async () => {
  const client = mockClient();
  client.generate.mockRejectedValue(
    new ApiClientError(
      502,
      "PROVIDER_REQUEST_FAILED",
      "Provider request failed",
      {
        error: {
          code: "PROVIDER_REQUEST_FAILED",
          message: "Provider request failed",
          providerOperation: "transcription\nprivate detail",
          upstreamStatus: "429 private detail",
        },
      },
    ),
  );
  client.notes.mockResolvedValue({ transcript: null, summary: null });
  const user = userEvent.setup();
  show(client);
  await user.click(
    await screen.findByRole("button", { name: "Generate summary" }),
  );

  expect(
    await screen.findByText(
      "Processing failed. Check provider usage before trying again.",
    ),
  ).toBeVisible();
  expect(screen.queryByText(/private detail/)).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Español" }));
  expect(
    await screen.findByText(
      "El procesamiento falló. Revisa el consumo del proveedor antes de reintentar.",
    ),
  ).toBeVisible();
  expect(client.generate).toHaveBeenCalledTimes(1);
});
it("exposes an empty state without fictional samples", async () => {
  const client = mockClient();
  client.list.mockResolvedValue({ recordings: [], cursor: null });
  show(client);
  expect(await screen.findByText("No recordings yet")).toBeVisible();
  expect(client.audio).not.toHaveBeenCalled();
});
it("uploads from disk and selects the saved recording without processing it", async () => {
  const client = {
    ...mockClient(),
    connectedDrives: vi.fn().mockResolvedValue([]),
    upload: vi.fn().mockResolvedValue({
      ...recording,
      id: "uploaded",
      source: "upload",
      name: "Meeting.mp3",
      durationSeconds: null,
    }),
  };
  const user = userEvent.setup();
  show(client);
  await user.click(
    await screen.findByRole("button", { name: "Upload recording" }),
  );
  await user.upload(
    screen.getByLabelText("Audio file"),
    new File(["audio"], "Meeting.mp3", { type: "audio/mpeg" }),
  );
  expect(
    await screen.findByRole("heading", { name: "Meeting.mp3" }),
  ).toBeVisible();
  expect(client.generate).not.toHaveBeenCalled();
  expect(client.upload).toHaveBeenCalledTimes(1);
});
it("only offers connected drives and imports a search result", async () => {
  const client = {
    ...mockClient(),
    connectedDrives: vi
      .fn()
      .mockResolvedValue([{ provider: "google_drive", label: "Google Drive" }]),
    searchFiles: vi
      .fn()
      .mockResolvedValue([
        { id: "cloud-one", name: "Cloud meeting.mp3", mimeType: "audio/mpeg" },
      ]),
    importFile: vi.fn().mockResolvedValue({
      ...recording,
      id: "cloud-upload",
      source: "upload",
      name: "Cloud meeting.mp3",
    }),
  };
  const user = userEvent.setup();
  show(client);
  await user.click(
    await screen.findByRole("button", { name: "Upload recording" }),
  );
  await user.selectOptions(
    await screen.findByLabelText("Source"),
    "google_drive",
  );
  expect(
    screen.queryByRole("option", { name: "OneDrive Personal" }),
  ).not.toBeInTheDocument();
  await user.type(screen.getByLabelText("Search audio files"), "meeting");
  await user.click(screen.getByRole("button", { name: "Search" }));
  await user.click(
    await screen.findByRole("button", { name: "Import Cloud meeting.mp3" }),
  );
  expect(
    await screen.findByRole("heading", { name: "Cloud meeting.mp3" }),
  ).toBeVisible();
  expect(client.importFile).toHaveBeenCalledWith("google_drive", "cloud-one");
  expect(client.generate).not.toHaveBeenCalled();
});
it("rejects local files larger than 50 MB before uploading", async () => {
  const client = {
    ...mockClient(),
    connectedDrives: vi.fn().mockResolvedValue([]),
    upload: vi.fn(),
  };
  const user = userEvent.setup();
  show(client);
  await user.click(
    await screen.findByRole("button", { name: "Upload recording" }),
  );
  const file = new File(["audio"], "large.wav", { type: "audio/wav" });
  Object.defineProperty(file, "size", { value: 50_000_001 });
  await user.upload(screen.getByLabelText("Audio file"), file);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Choose an audio file up to 50 MB.",
  );
  expect(client.upload).not.toHaveBeenCalled();
});
it("waits for the initial list before enabling uploads", async () => {
  let resolveList!: (value: {
    recordings: (typeof recording)[];
    cursor: null;
  }) => void;
  const client = {
    ...mockClient(),
    connectedDrives: vi.fn().mockResolvedValue([]),
  };
  client.list.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveList = resolve;
      }),
  );
  show(client);
  expect(
    screen.getByRole("button", { name: "Upload recording" }),
  ).toBeDisabled();
  resolveList({ recordings: [], cursor: null });
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Upload recording" }),
    ).toBeEnabled(),
  );
});

it("continues an empty filtered page to find visible recordings", async () => {
  const client = mockClient();
  client.list.mockResolvedValueOnce({
    recordings: [],
    cursor: "next-page",
  } as any);
  show(client);
  expect(
    await screen.findByRole("region", { name: "Meeting notes" }),
  ).toBeVisible();
  expect(client.list).toHaveBeenCalledWith("next-page");
});

it("returns keyboard focus to the mobile picker after selecting a recording", async () => {
  const client = mockClient();
  client.list.mockResolvedValue({
    recordings: [
      recording,
      { ...recording, id: "two", name: "Second meeting" },
    ],
    cursor: null,
  });
  const user = userEvent.setup();
  show(client);
  const picker = await screen.findByRole("button", {
    name: "Select a recording",
  });
  // jsdom has no layout; represent the mobile trigger's visible rectangle.
  vi.spyOn(picker, "getClientRects").mockReturnValue([
    { width: 390, height: 44 },
  ] as unknown as DOMRectList);
  await user.click(picker);
  const second = screen.getByRole("button", { name: /Second meeting/ });
  second.focus();
  await user.keyboard("{Enter}");
  expect(picker).toHaveAttribute("aria-expanded", "false");
  expect(picker).toHaveFocus();
  expect(
    await screen.findByRole("heading", { name: "Second meeting" }),
  ).toBeVisible();
});

it("keeps focus on the desktop list when the mobile picker trigger is hidden", async () => {
  const client = mockClient();
  client.list.mockResolvedValue({
    recordings: [
      recording,
      { ...recording, id: "two", name: "Second meeting" },
    ],
    cursor: null,
  });
  const user = userEvent.setup();
  show(client);
  const picker = await screen.findByRole("button", {
    name: "Select a recording",
  });
  vi.spyOn(picker, "getClientRects").mockReturnValue(
    [] as unknown as DOMRectList,
  );
  const second = screen.getByRole("button", { name: /Second meeting/ });
  second.focus();
  await user.keyboard("{Enter}");
  expect(second).toHaveFocus();
  expect(
    await screen.findByRole("heading", { name: "Second meeting" }),
  ).toBeVisible();
});

it("confirms deletion, supports cancellation, and clears the last recording", async () => {
  const client = mockClient(),
    user = userEvent.setup();
  show(client);
  await user.click(
    await screen.findByRole("button", { name: "Delete recording" }),
  );
  expect(screen.getByRole("dialog")).toBeVisible();
  expect(client.remove).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(client.remove).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Delete recording" }));
  await user.click(screen.getByRole("button", { name: "Delete permanently" }));
  expect(client.remove).toHaveBeenCalledWith("one");
  expect(await screen.findByText("No recordings yet")).toBeVisible();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:private-audio");
});

it("preserves the recording when deletion fails", async () => {
  const client = mockClient(),
    user = userEvent.setup();
  client.remove.mockRejectedValue(new Error("Network failed"));
  show(client);
  await user.click(
    await screen.findByRole("button", { name: "Delete recording" }),
  );
  await user.click(screen.getByRole("button", { name: "Delete permanently" }));
  expect(
    await screen.findByText("Unable to delete this recording. Try again."),
  ).toBeVisible();
  expect(screen.queryByText("No recordings yet")).not.toBeInTheDocument();
});

it("selects the next recording and blocks duplicate deletion while pending", async () => {
  const client = mockClient(),
    user = userEvent.setup();
  client.list.mockResolvedValue({
    recordings: [recording, { ...recording, id: "two", name: "Next audio" }],
    cursor: null,
  });
  let finish!: () => void;
  client.remove.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  show(client);
  await user.click(
    await screen.findByRole("button", { name: "Delete recording" }),
  );
  await user.click(screen.getByRole("button", { name: "Delete permanently" }));
  expect(screen.getByRole("button", { name: "Deleting…" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  expect(client.remove).toHaveBeenCalledTimes(1);
  finish();
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  await waitFor(() =>
    expect(client.audio).toHaveBeenCalledWith("two", expect.any(AbortSignal)),
  );
  expect(screen.getByRole("heading", { name: "Next audio" })).toBeVisible();
});

it("translates the deletion confirmation into Spanish", async () => {
  const client = mockClient(),
    user = userEvent.setup();
  show(client);
  await screen.findByRole("button", { name: "Delete recording" });
  await user.click(screen.getByRole("button", { name: "Español" }));
  await user.click(screen.getByRole("button", { name: "Eliminar grabación" }));
  expect(
    screen.getByRole("button", { name: "Eliminar definitivamente" }),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "Cancelar" })).toBeVisible();
});
