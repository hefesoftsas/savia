import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { StoreContextProvider, memoryStore } from "ra-core";
import { RecordingQuestions } from "./recording-questions";
afterEach(cleanup);
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
