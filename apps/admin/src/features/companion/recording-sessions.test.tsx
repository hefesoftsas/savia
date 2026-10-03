import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { StoreContextProvider, memoryStore } from "ra-core";
import { ApiClient } from "@/api/api-client";
import { RecordingSessions } from "./recording-sessions";
import type { RecordingSession } from "./sessions-client";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const session = (id: string): RecordingSession => ({
  id,
  name: `Interview ${id}`,
  createdAt: "2026-10-03T10:00:00Z",
  state: "ready",
  durationSeconds: 3600,
  chunks: [],
  job: {
    status: "needs_attention",
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
it("requires fresh retry consent, submits once, and clears a partial answer when selection changes", async () => {
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
      if (path.endsWith("/questions"))
        return Response.json({
          answer: "The budget remains pending.",
          insufficientEvidence: false,
          partial: true,
          evidence: [
            {
              source: "microphone",
              sequence: 0,
              startSeconds: 0,
              durationSeconds: 30,
            },
          ],
        });
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
  await user.click(
    screen.getByLabelText(
      "I agree to send audio and transcripts to OpenRouter. Processing may incur charges.",
    ),
  );
  expect(generate).toBeDisabled();
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
      body: { consent: true, retryAmbiguous: true },
    },
  ]);
  await user.type(
    screen.getByLabelText("Your question"),
    "What is the budget?",
  );
  await user.click(
    screen.getByLabelText(
      "I agree to send this transcript and question to OpenRouter. Processing may incur charges.",
    ),
  );
  await user.click(screen.getByRole("button", { name: "Ask about recording" }));
  expect(await screen.findByText("The budget remains pending.")).toBeVisible();
  expect(
    screen.getByText(
      "This answer uses selected transcript excerpts, not the entire recording.",
    ),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: /Interview two/ }));
  expect(
    screen.queryByText("The budget remains pending."),
  ).not.toBeInTheDocument();
  expect(screen.getByLabelText("Your question")).toHaveValue("");
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
