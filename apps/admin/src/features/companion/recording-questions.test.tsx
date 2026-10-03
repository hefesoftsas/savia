import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { StoreContextProvider, memoryStore, useLocaleState } from "ra-core";
import { ApiClientError } from "@/api/api-client";
import { RecordingQuestions } from "./recording-questions";
afterEach(cleanup);
function LocaleButton({ locale, label }: { locale: string; label: string }) {
  const [, setLocale] = useLocaleState();
  return <button onClick={() => setLocale(locale)}>{label}</button>;
}
it("requires consent, shows insufficient evidence, and clears answers on recording change", async () => {
  const answer = vi.fn().mockResolvedValue({
    answer: "No budget was agreed.",
    insufficientEvidence: true,
  });
  const user = userEvent.setup();
  const show = (id: string) => (
    <StoreContextProvider value={memoryStore({ locale: "en" })}>
      <RecordingQuestions key={id} id={id} client={{ answer }} />
    </StoreContextProvider>
  );
  const view = render(show("one"));
  await user.type(
    screen.getByLabelText("Your question"),
    "What budget was agreed?",
  );
  expect(
    screen.getByRole("button", { name: "Ask about recording" }),
  ).toBeDisabled();
  await user.click(screen.getByRole("checkbox"));
  await user.click(screen.getByRole("button", { name: "Ask about recording" }));
  expect(await screen.findByText("No budget was agreed.")).toBeVisible();
  expect(
    screen.getByText("Insufficient evidence in this recording."),
  ).toBeVisible();
  expect(answer).toHaveBeenCalledExactlyOnceWith(
    "one",
    "What budget was agreed?",
  );
  view.rerender(show("two"));
  expect(screen.queryByText("No budget was agreed.")).not.toBeInTheDocument();
  expect(screen.getByRole("checkbox")).not.toBeChecked();
});

it("shows safe provider diagnostics after one rejected question request", async () => {
  const answer = vi.fn().mockRejectedValue(
    new ApiClientError(
      502,
      "PROVIDER_REQUEST_FAILED",
      "Provider request failed",
      {
        error: {
          code: "PROVIDER_REQUEST_FAILED",
          message: "Provider request failed",
          providerOperation: "question",
          upstreamStatus: 401,
        },
      },
    ),
  );
  const user = userEvent.setup();
  render(
    <StoreContextProvider value={memoryStore({ locale: "en" })}>
      <LocaleButton locale="es" label="Español" />
      <RecordingQuestions id="one" client={{ answer }} />
    </StoreContextProvider>,
  );
  await user.type(screen.getByLabelText("Your question"), "Who agreed?");
  await user.click(screen.getByRole("checkbox"));
  await user.click(screen.getByRole("button", { name: "Ask about recording" }));

  expect(
    await screen.findByText(
      "Question provider returned HTTP 401. Check provider usage before trying again.",
    ),
  ).toBeVisible();
  expect(answer).toHaveBeenCalledExactlyOnceWith("one", "Who agreed?");
  await user.click(screen.getByRole("button", { name: "Español" }));
  expect(
    await screen.findByText(
      "El proveedor respondió HTTP 401 al contestar la pregunta. Revisa el consumo del proveedor antes de reintentar.",
    ),
  ).toBeVisible();
  expect(answer).toHaveBeenCalledExactlyOnceWith("one", "Who agreed?");
});

it("relocalizes a generic question failure without exposing error details", async () => {
  const answer = vi
    .fn()
    .mockRejectedValue(new Error("private provider detail"));
  const user = userEvent.setup();
  render(
    <StoreContextProvider value={memoryStore({ locale: "en" })}>
      <LocaleButton locale="es" label="Español" />
      <RecordingQuestions id="one" client={{ answer }} />
    </StoreContextProvider>,
  );
  await user.type(screen.getByLabelText("Your question"), "Who agreed?");
  await user.click(screen.getByRole("checkbox"));
  await user.click(screen.getByRole("button", { name: "Ask about recording" }));

  expect(
    await screen.findByText(
      "Processing failed. Check provider usage before trying again.",
    ),
  ).toBeVisible();
  expect(screen.queryByText(/private provider detail/)).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Español" }));
  expect(
    await screen.findByText(
      "El procesamiento falló. Revisa el consumo del proveedor antes de reintentar.",
    ),
  ).toBeVisible();
  expect(answer).toHaveBeenCalledExactlyOnceWith("one", "Who agreed?");
});
