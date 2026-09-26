// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StorePortQuoteResults as QuoteResults } from "@savia/release-catalog/test-fixtures";

afterEach(cleanup);

function offer(provider: string) {
  return {
    productId: provider,
    flowId: provider,
    label: provider,
    provider,
    status: "succeeded" as const,
    quoteNumber: `REF-${provider}`,
    premium: 1200000,
  };
}

it("resets insurer filtering when a different saved quote is selected", async () => {
  const user = userEvent.setup();
  const { rerender } = render(
    <QuoteResults
      runs={[]}
      loading={false}
      hasSelectedQuote
      selectedHistoryQuoteId="first"
      batchItems={[offer("First carrier"), offer("Second carrier")]}
    />,
  );
  await user.click(screen.getByRole("button", { name: "First carrier (1)" }));
  rerender(
    <QuoteResults
      runs={[]}
      loading={false}
      hasSelectedQuote
      selectedHistoryQuoteId="second"
      batchItems={[offer("Third carrier")]}
    />,
  );
  expect(
    await screen.findByRole("heading", { name: "Third carrier" }),
  ).toBeVisible();
});

it("does not describe saved pending records as active provider requests", () => {
  render(
    <QuoteResults
      runs={[]}
      loading={false}
      hasSelectedQuote
      selectedHistoryQuoteId="saved"
      batchItems={[
        {
          ...offer("Carrier"),
          status: "pending",
          quoteNumber: undefined,
          premium: undefined,
        },
      ]}
    />,
  );
  expect(screen.queryByText("Consultando proveedor…")).not.toBeInTheDocument();
  expect(screen.queryByText("↻ En progreso")).not.toBeInTheDocument();
});
