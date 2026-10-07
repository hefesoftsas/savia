import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { StoreContextProvider, memoryStore } from "ra-core";
import { ApiClient } from "@/api/api-client";
import { RecordingSessions } from "./recording-sessions";
import type { RecordingSession } from "./sessions-client";
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
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
});
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;
const session = (id: string): RecordingSession => ({
  id,
  name: `Interview ${id}`,
  createdAt: "2026-10-03T10:00:00Z",
  state: "ready",
  durationSeconds: 3600,
  chunks: [],
  job: {
    status: "needs_attention",
    language: "es",
    completedChunks: 1,
    totalChunks: 120,
    transcripts: {
      "microphone:0": {
        source: "microphone",
        text: "Budget is pending",
        model: "fixture",
        durationSeconds: 30,
      },
    },
    summary: null,
  },
});
it("keeps retry acknowledgement for ambiguous processing and passes session context to chat", async () => {
  const submissions: { path: string; body: unknown }[] = [];
  const api = new ApiClient({
    baseUrl: "https://savia.test",
    tokenSource: { getAccessToken: async () => "test" },
    fetcher: async (input, init) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      if (request.method === "GET" && path !== "/v1/companion/sessions")
        return Response.json(session(path.endsWith("/two") ? "two" : "one"));
      if (request.method === "GET")
        return Response.json({
          sessions: [session("one"), session("two")],
          cursor: null,
        });
      submissions.push({ path, body: await request.json() });
      return Response.json({
        ...session("one"),
        job: { ...session("one").job, status: "queued" },
      });
    },
  });
  render(
    <StoreContextProvider value={memoryStore({ locale: "en" })}>
      <RecordingSessions api={api} />
    </StoreContextProvider>,
  );
  const user = userEvent.setup();
  const generate = await screen.findByRole("button", {
    name: "Generate transcript and summary",
  });
  expect(generate).toBeDisabled();
  expect(screen.queryByText(/I agree to send audio/)).not.toBeInTheDocument();
  const assistant = await screen.findByTestId("recording-assistant");
  expect(assistant).toHaveAttribute("data-kind", "session");
  expect(assistant).toHaveAttribute("data-id", "one");
  expect(assistant).toHaveAttribute("data-title", "Interview one");
  await user.click(
    screen.getByLabelText("I accept that retrying may incur another charge."),
  );
  await user.click(generate);
  expect(
    await screen.findByText(
      "You can close this page. Processing continues in Savia.",
    ),
  ).toBeVisible();
  expect(submissions).toEqual([
    {
      path: "/v1/companion/sessions/one/notes",
      body: {
        consent: true,
        retryAmbiguous: true,
        language: "es",
        retranscribe: false,
      },
    },
  ]);
  await user.click(screen.getByRole("button", { name: /Interview two/ }));
  expect(await screen.findByTestId("recording-assistant")).toHaveAttribute(
    "data-id",
    "two",
  );
});

it("requires acknowledgement to switch transcript language", async () => {
  const submissions: { path: string; body: unknown }[] = [];
  const api = new ApiClient({
    baseUrl: "https://savia.test",
    tokenSource: { getAccessToken: async () => "test" },
    fetcher: async (input, init) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      if (request.method === "GET")
        return Response.json(
          path === "/v1/companion/sessions"
            ? { sessions: [session("one")], cursor: null }
            : session("one"),
        );
      submissions.push({ path, body: await request.json() });
      return Response.json({
        ...session("one"),
        job: { ...session("one").job, status: "queued" },
      });
    },
  });
  render(
    <StoreContextProvider value={memoryStore({ locale: "en" })}>
      <RecordingSessions api={api} />
    </StoreContextProvider>,
  );
  const user = userEvent.setup();
  const generate = await screen.findByRole("button", {
    name: "Generate transcript and summary",
  });
  await user.click(
    screen.getByLabelText("I accept that retrying may incur another charge."),
  );
  const language = screen.getByLabelText("Transcript language");
  await user.selectOptions(language, "en");
  expect(
    screen.getByText(
      "Switching language replaces the saved transcript and summary. Provider usage may be billed again.",
    ),
  ).toBeVisible();
  expect(generate).toBeDisabled();
  await user.click(
    screen.getByLabelText("I understand saved results will be replaced."),
  );
  await user.click(generate);
  expect(await screen.findByText(/^Queued/)).toBeVisible();
  expect(submissions).toEqual([
    {
      path: "/v1/companion/sessions/one/notes",
      body: {
        consent: true,
        retryAmbiguous: true,
        language: "en",
        retranscribe: true,
      },
    },
  ]);
});

it("plays and downloads the full concatenated audio per source", async () => {
  const withChunks: RecordingSession = {
    ...session("full"),
    chunks: [
      {
        source: "microphone",
        sequence: 0,
        startSeconds: 0,
        durationSeconds: 30,
        bytes: 4,
        format: "ogg",
      },
      {
        source: "microphone",
        sequence: 1,
        startSeconds: 30,
        durationSeconds: 30,
        bytes: 4,
        format: "ogg",
      },
    ],
    job: {
      ...session("full").job,
      status: "complete",
      completedChunks: 2,
      totalChunks: 2,
      summary: {
        summary: "All good.",
        decisions: [],
        actions: [],
        openQuestions: [],
      },
    },
  };
  const requested: string[] = [];
  URL.createObjectURL = vi.fn(
    () => "blob:full-audio",
  ) as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL;
  // The list and detail endpoints return the session with chunks.
  const fetchingApi = new ApiClient({
    baseUrl: "https://savia.test",
    tokenSource: { getAccessToken: async () => "test" },
    fetcher: async (input) => {
      const url = new URL(String(input));
      requested.push(`${url.pathname}${url.search}`);
      if (url.pathname === "/v1/companion/sessions")
        return Response.json({ sessions: [withChunks], cursor: null });
      if (url.pathname.endsWith("/audio"))
        return new Response("full-audio-bytes", {
          headers: { "content-type": "audio/ogg" },
        });
      if (url.pathname.includes("/chunks/"))
        return new Response("part-audio-bytes", {
          headers: { "content-type": "audio/ogg" },
        });
      return Response.json(withChunks);
    },
  });
  render(
    <StoreContextProvider value={memoryStore({ locale: "en" })}>
      <RecordingSessions api={fetchingApi} />
    </StoreContextProvider>,
  );
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Play full audio" }),
  );
  expect(
    await screen.findByRole("link", { name: "Download full audio" }),
  ).toHaveAttribute("download", "savia-full-microphone.ogg");
  expect(requested).toContain(
    "/v1/companion/sessions/full/audio?source=microphone",
  );
});

it("plays microphone and system audio together as one combined call", async () => {
  const twoSources: RecordingSession = {
    ...session("mixed"),
    chunks: [
      {
        source: "microphone",
        sequence: 0,
        startSeconds: 0,
        durationSeconds: 30,
        bytes: 4,
        format: "ogg",
      },
      {
        source: "system",
        sequence: 0,
        startSeconds: 0,
        durationSeconds: 30,
        bytes: 4,
        format: "ogg",
      },
    ],
    job: {
      ...session("mixed").job,
      status: "complete",
      completedChunks: 2,
      totalChunks: 2,
      summary: {
        summary: "All good.",
        decisions: [],
        actions: [],
        openQuestions: [],
      },
    },
  };
  const requested: string[] = [];
  URL.createObjectURL = vi.fn(
    () => "blob:mixed-audio",
  ) as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL;
  const fetchingApi = new ApiClient({
    baseUrl: "https://savia.test",
    tokenSource: { getAccessToken: async () => "test" },
    fetcher: async (input) => {
      const url = new URL(String(input));
      requested.push(`${url.pathname}${url.search}`);
      if (url.pathname === "/v1/companion/sessions")
        return Response.json({ sessions: [twoSources], cursor: null });
      if (url.pathname.endsWith("/audio"))
        return new Response("full-audio-bytes", {
          headers: { "content-type": "audio/ogg" },
        });
      return Response.json(twoSources);
    },
  });
  render(
    <StoreContextProvider value={memoryStore({ locale: "en" })}>
      <RecordingSessions api={fetchingApi} />
    </StoreContextProvider>,
  );
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Play combined call" }),
  );
  expect(requested).toContain(
    "/v1/companion/sessions/mixed/audio?source=microphone",
  );
  expect(requested).toContain(
    "/v1/companion/sessions/mixed/audio?source=system",
  );
  await screen.findByText("Microphone and system audio, played together.");
  expect(document.querySelectorAll("audio")).toHaveLength(2);
  const play = vi
    .spyOn(HTMLMediaElement.prototype, "play")
    .mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  await user.click(
    screen.getByRole("button", { name: "Start combined playback" }),
  );
  expect(play).toHaveBeenCalledTimes(2);

  play.mockRejectedValueOnce(new Error("Playback was blocked"));
  await user.click(
    screen.getByRole("button", { name: "Start combined playback" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "One or more audio tracks could not start",
  );
});

it("masters the combined call from the longest source timeline", async () => {
  const uneven: RecordingSession = {
    ...session("uneven"),
    chunks: [
      {
        source: "microphone",
        sequence: 0,
        startSeconds: 0,
        durationSeconds: 30,
        bytes: 9,
        format: "ogg",
      },
      {
        source: "system",
        sequence: 0,
        startSeconds: 0,
        durationSeconds: 60,
        bytes: 22,
        format: "ogg",
      },
    ],
    job: {
      ...session("uneven").job,
      status: "complete",
      completedChunks: 2,
      totalChunks: 2,
      summary: {
        summary: "All good.",
        decisions: [],
        actions: [],
        openQuestions: [],
      },
    },
  };
  URL.createObjectURL = ((blob: Blob) =>
    `blob:${blob.size}`) as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL;
  const fetchingApi = new ApiClient({
    baseUrl: "https://savia.test",
    tokenSource: { getAccessToken: async () => "test" },
    fetcher: async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/v1/companion/sessions")
        return Response.json({ sessions: [uneven], cursor: null });
      if (url.pathname.endsWith("/audio")) {
        const body =
          url.searchParams.get("source") === "system"
            ? "system-audio-bytes-long"
            : "mic-bytes";
        return new Response(body, {
          headers: { "content-type": "audio/ogg" },
        });
      }
      return Response.json(uneven);
    },
  });
  render(
    <StoreContextProvider value={memoryStore({ locale: "en" })}>
      <RecordingSessions api={fetchingApi} />
    </StoreContextProvider>,
  );
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Play combined call" }),
  );
  await screen.findByText("Microphone and system audio, played together.");
  expect(document.querySelector("audio[controls]")).toHaveAttribute(
    "src",
    "blob:23",
  );
  const play = vi
    .spyOn(HTMLMediaElement.prototype, "play")
    .mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  await user.click(
    screen.getByRole("button", { name: "Start combined playback" }),
  );
  const [master, microphone] = document.querySelectorAll("audio");
  Object.defineProperties(master, {
    paused: { configurable: true, writable: true, value: false },
    currentTime: { configurable: true, writable: true, value: 40 },
  });
  Object.defineProperties(microphone, {
    paused: { configurable: true, writable: true, value: true },
    ended: { configurable: true, value: true },
    duration: { configurable: true, value: 30 },
    currentTime: { configurable: true, writable: true, value: 30 },
  });

  fireEvent.timeUpdate(master);

  expect(play).toHaveBeenCalledTimes(2);

  master.currentTime = 10;
  fireEvent.timeUpdate(master);
  expect(play).toHaveBeenCalledTimes(3);
});

it("falls back to per-segment playback for mobile M4A sources", async () => {
  const mobile: RecordingSession = {
    ...session("mobile"),
    chunks: [
      {
        source: "microphone",
        sequence: 0,
        startSeconds: 0,
        durationSeconds: 30,
        bytes: 4,
        format: "m4a",
      },
    ],
    job: {
      ...session("mobile").job,
      status: "complete",
      completedChunks: 1,
      totalChunks: 1,
      summary: {
        summary: "All good.",
        decisions: [],
        actions: [],
        openQuestions: [],
      },
    },
  };
  const requested: string[] = [];
  URL.createObjectURL = vi.fn(
    () => "blob:segment-audio",
  ) as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL;
  const fetchingApi = new ApiClient({
    baseUrl: "https://savia.test",
    tokenSource: { getAccessToken: async () => "test" },
    fetcher: async (input) => {
      const url = new URL(String(input));
      requested.push(`${url.pathname}${url.search}`);
      if (url.pathname === "/v1/companion/sessions")
        return Response.json({ sessions: [mobile], cursor: null });
      if (url.pathname.includes("/chunks/"))
        return new Response("segment-bytes", {
          headers: { "content-type": "audio/mp4" },
        });
      return Response.json(mobile);
    },
  });
  render(
    <StoreContextProvider value={memoryStore({ locale: "en" })}>
      <RecordingSessions api={fetchingApi} />
    </StoreContextProvider>,
  );
  expect(await screen.findByLabelText("Listen from")).toBeVisible();
  expect(requested).toContain(
    "/v1/companion/sessions/mobile/chunks/microphone/0",
  );
  await waitFor(() =>
    expect(document.querySelectorAll("audio")).toHaveLength(1),
  );
  expect(
    screen.queryByRole("button", { name: "Play combined call" }),
  ).not.toBeInTheDocument();
});

it("deletes a session after confirmation and removes it from the list", async () => {
  const deleted: string[] = [];
  const api = new ApiClient({
    baseUrl: "https://savia.test",
    tokenSource: { getAccessToken: async () => "test" },
    fetcher: async (input, init) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      if (request.method === "DELETE") {
        deleted.push(path);
        return new Response(null, { status: 204 });
      }
      return Response.json(
        path === "/v1/companion/sessions"
          ? { sessions: [session("one")], cursor: null }
          : session("one"),
      );
    },
  });
  render(
    <StoreContextProvider value={memoryStore({ locale: "en" })}>
      <RecordingSessions api={api} />
    </StoreContextProvider>,
  );
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Delete session" }),
  );
  await user.click(
    await screen.findByRole("button", { name: "Delete permanently" }),
  );
  expect(deleted).toEqual(["/v1/companion/sessions/one"]);
  expect(await screen.findByText("No recording sessions yet")).toBeVisible();
});

it("opens the desktop review link directly on recording sessions", async () => {
  const { MemoryRouter } = await import("react-router-dom");
  const { CompanionRecordingsPage } = await import("./recordings-page");
  const paths: string[] = [];
  const apiClient = new ApiClient({
    baseUrl: "https://savia.test",
    tokenSource: { getAccessToken: async () => "test" },
    fetcher: async (input) => {
      paths.push(new URL(String(input)).pathname);
      return Response.json({ sessions: [], cursor: null });
    },
  });
  render(
    <MemoryRouter initialEntries={["/companion-recordings?tab=sessions"]}>
      <StoreContextProvider value={memoryStore({ locale: "en" })}>
        <CompanionRecordingsPage services={{ apiClient }} />
      </StoreContextProvider>
    </MemoryRouter>,
  );
  expect(await screen.findByText("No recording sessions yet")).toBeVisible();
  expect(paths).toEqual(["/v1/companion/sessions"]);
});

it("renames a session from its detail header", async () => {
  const patched: { path: string; method: string; body: unknown }[] = [];
  let name = "Interview one";
  const api = new ApiClient({
    baseUrl: "https://savia.test",
    tokenSource: { getAccessToken: async () => "test" },
    fetcher: async (input, init) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      if (request.method === "GET")
        return Response.json(
          path === "/v1/companion/sessions"
            ? { sessions: [{ ...session("one"), name }], cursor: null }
            : { ...session("one"), name },
        );
      if (request.method === "PATCH") {
        const body = (await request.json()) as { name: string };
        name = body.name;
        patched.push({ path, method: "PATCH", body });
        return Response.json({ ...session("one"), name });
      }
      return Response.json({ ...session("one"), name });
    },
  });
  render(
    <StoreContextProvider value={memoryStore({ locale: "en" })}>
      <RecordingSessions api={api} />
    </StoreContextProvider>,
  );
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Rename session" }),
  );
  const field = screen.getByLabelText("Session name");
  await user.clear(field);
  await user.type(field, "Budget review");
  await user.click(screen.getByRole("button", { name: "Save name" }));
  expect(
    await screen.findByRole("heading", { name: "Budget review" }),
  ).toBeVisible();
  expect(patched).toEqual([
    {
      path: "/v1/companion/sessions/one",
      method: "PATCH",
      body: { name: "Budget review" },
    },
  ]);
});
