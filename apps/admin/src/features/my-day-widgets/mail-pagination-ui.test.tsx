import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { PersonalMailProvider } from "@savia/studio-shared/mail-contracts";
import type { MailRow, MailState } from "./use-my-day-mail";
import { MailWidgetBody } from "./mail-widget";

afterEach(cleanup);

function inboxRows() {
  return within(screen.getByRole("list", { name: "Correos" })).getAllByRole(
    "listitem",
  );
}

function message(
  id: string,
  provider: PersonalMailProvider = "gmail",
): MailRow {
  return {
    id,
    provider,
    accountLabel: `${provider}@example.com`,
    subject: `Message ${id}`,
    sender: "Ana",
    receivedAt: `2026-01-${String(30 - Number(id)).padStart(2, "0")}T00:00:00Z`,
    webLink: null,
  };
}
function state(
  messages: MailRow[],
  overrides: Partial<MailState> = {},
): MailState {
  return {
    connections: ["gmail", "outlook"].map((provider) => ({
      provider,
      status: "connected",
      externalAccountLabel: `${provider}@example.com`,
    })),
    reconnectRequired: [],
    messages,
    loading: false,
    errors: [],
    sessionRevision: 0,
    refresh: vi.fn(async () => {}),
    hasMore: { gmail: false, outlook: false },
    loadingMore: false,
    loadMore: vi.fn(async () => {}),
    ...overrides,
  } as MailState;
}
function messages(count: number, provider: PersonalMailProvider = "gmail") {
  return Array.from({ length: count }, (_, index) =>
    message(String(index + 1), provider),
  );
}

it("pages the loaded inbox in groups of ten with accessible previous and next controls", () => {
  const mail = state(messages(25));
  render(<MailWidgetBody mail={mail} onCompose={() => {}} />);

  expect(inboxRows()).toHaveLength(10);
  expect(screen.getByText("Página 1")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Anterior" })).toBeDisabled();

  fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
  expect(inboxRows()).toHaveLength(10);
  expect(screen.getByText("Message 11")).toBeInTheDocument();
  expect(screen.getByText("Página 2")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Anterior" }));
  expect(screen.getByText("Message 1")).toBeInTheDocument();
  expect(screen.queryByText("Message 11")).not.toBeInTheDocument();
});

it("loads one older provider page before advancing from the loaded frontier", async () => {
  let onLoadMore!: () => void;
  const mail = state(messages(10), {
    hasMore: { gmail: true, outlook: false },
    loadMore: vi.fn(async () => {
      await new Promise<void>((resolve) => {
        onLoadMore = () => {
          mail.messages = [
            ...mail.messages,
            ...messages(10).map((row) => ({
              ...row,
              id: `older-${row.id}`,
              subject: `Older ${row.id}`,
            })),
          ];
          mail.hasMore = { gmail: false, outlook: false };
          resolve();
        };
      });
    }),
  });
  render(<MailWidgetBody mail={mail} onCompose={() => {}} />);

  fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
  expect(mail.loadMore).toHaveBeenCalledWith(["gmail"]);
  expect(screen.getByRole("button", { name: "Siguiente" })).toBeDisabled();
  await act(async () => onLoadMore());
  await waitFor(() => expect(screen.getByText("Página 2")).toBeInTheDocument());
  expect(screen.getAllByText(/^Older /).length).toBeGreaterThan(0);
});

it("keeps the reader on the same rows when refresh adds newer messages", () => {
  const mail = state(messages(25));
  const view = render(<MailWidgetBody mail={mail} onCompose={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
  expect(screen.getByText("Message 11")).toBeInTheDocument();

  view.rerender(
    <MailWidgetBody
      mail={{ ...mail, messages: [message("new"), ...mail.messages] }}
      onCompose={() => {}}
    />,
  );
  expect(screen.getByText("Message 11")).toBeInTheDocument();
  expect(screen.queryByText("Message 10")).not.toBeInTheDocument();
});

it("does not advance when an older-page request makes no progress", async () => {
  const mail = state(messages(10), {
    hasMore: { gmail: true, outlook: false },
    loadMore: vi.fn(async () => {}),
  });
  render(<MailWidgetBody mail={mail} onCompose={() => {}} />);

  fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
  await waitFor(() => expect(mail.loadMore).toHaveBeenCalledTimes(4));
  await waitFor(() => expect(screen.getByText("Página 1")).toBeInTheDocument());
  expect(screen.getByRole("button", { name: "Siguiente" })).toBeEnabled();
  expect(
    screen.getByText("No pudimos completar esta página. Intenta de nuevo."),
  ).toBeInTheDocument();
});

it("uses shadcn tabs to filter providers and resets pagination when the account changes", async () => {
  const user = userEvent.setup();
  const mail = state([...messages(15, "gmail"), ...messages(15, "outlook")]);
  render(<MailWidgetBody mail={mail} onCompose={() => {}} />);
  await user.click(screen.getByRole("tab", { name: "Gmail" }));
  await waitFor(() =>
    expect(screen.getByRole("tab", { name: "Gmail" })).toHaveAttribute(
      "aria-selected",
      "true",
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
  expect(screen.getByText("Página 2")).toBeInTheDocument();

  await user.click(screen.getByRole("tab", { name: "Outlook" }));
  await waitFor(() => expect(screen.getByText("Página 1")).toBeInTheDocument());
  expect(inboxRows()).toHaveLength(10);
  expect(screen.getByRole("tab", { name: "Outlook" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

it("loads a provider page when its unseen frontier could reorder a loaded candidate page", async () => {
  const dated = (
    provider: PersonalMailProvider,
    id: string,
    month: number,
    day: number,
  ) => ({
    ...message(id, provider),
    id,
    subject: `${provider} ${id}`,
    receivedAt: new Date(Date.UTC(2026, month, day)).toISOString(),
  });
  const gmailRows = Array.from({ length: 25 }, (_, index) =>
    dated("gmail", `g${index + 1}`, 1, 25 - index),
  );
  const outlookRows = Array.from({ length: 25 }, (_, index) =>
    dated("outlook", `o${index + 1}`, 0, 26 - index),
  );
  const mail = state([...gmailRows, ...outlookRows], {
    hasMore: { gmail: true, outlook: false },
  });
  mail.loadMore = vi.fn(async (providers) => {
    expect(providers).toEqual(["gmail"]);
    mail.messages = [
      ...mail.messages,
      ...Array.from({ length: 10 }, (_, index) =>
        dated("gmail", `g${index + 26}`, 0, 31 - index),
      ),
    ];
    mail.hasMore = { gmail: false, outlook: false };
  });
  render(<MailWidgetBody mail={mail} onCompose={() => {}} />);

  fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
  expect(screen.getByText("Página 2")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));

  await waitFor(() => expect(screen.getByText("Página 3")).toBeInTheDocument());
  expect(mail.loadMore).toHaveBeenCalledOnce();
  expect(screen.getByText("gmail g30")).toBeInTheDocument();
  expect(screen.queryByText("outlook o1")).not.toBeInTheDocument();
});

it("stops paging after an older-page provider error and leaves the reader in place", async () => {
  const mail = state(messages(10), {
    hasMore: { gmail: true, outlook: false },
    loadMore: vi.fn(async () => {
      mail.errors = ["No pudimos cargar más correos de Gmail. Reintenta."];
    }),
  });
  render(<MailWidgetBody mail={mail} onCompose={() => {}} />);

  fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
  await waitFor(() =>
    expect(
      screen.getByText("No pudimos completar esta página. Intenta de nuevo."),
    ).toBeInTheDocument(),
  );
  expect(mail.loadMore).toHaveBeenCalledOnce();
  expect(screen.getByText("Página 1")).toBeInTheDocument();
});

it("does not fetch more for an all-undated stream while loaded rows remain", () => {
  const undated = messages(20).map((row) => ({ ...row, receivedAt: null }));
  const mail = state(undated, {
    hasMore: { gmail: true, outlook: false },
  });
  render(<MailWidgetBody mail={mail} onCompose={() => {}} />);

  fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
  expect(screen.getByText("Página 2")).toBeInTheDocument();
  expect(mail.loadMore).not.toHaveBeenCalled();
});

it("checks empty provider streams before advancing through an undated partial page", async () => {
  const mail = state(
    messages(15).map((row) => ({ ...row, receivedAt: null })),
    {
      hasMore: { gmail: true, outlook: true },
      loadMore: vi.fn(async (providers) => {
        expect(providers).toEqual(["gmail", "outlook"]);
        mail.hasMore = { gmail: false, outlook: false };
      }),
    },
  );
  render(<MailWidgetBody mail={mail} onCompose={() => {}} />);

  fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
  await waitFor(() => expect(mail.loadMore).toHaveBeenCalledOnce());
  await waitFor(() => expect(screen.getByText("Página 2")).toBeInTheDocument());
});

it("checks dated provider frontiers before advancing through a full undated page", async () => {
  const datedOutlook = messages(10, "outlook").map((row) => ({
    ...row,
    receivedAt: "2026-01-10T00:00:00.000Z",
  }));
  const undatedGmail = messages(20).map((row) => ({
    ...row,
    receivedAt: null,
  }));
  const mail = state([...datedOutlook, ...undatedGmail], {
    hasMore: { gmail: false, outlook: true },
    loadMore: vi.fn(async (providers) => {
      expect(providers).toEqual(["outlook"]);
      mail.hasMore = { gmail: false, outlook: false };
    }),
  });
  render(<MailWidgetBody mail={mail} onCompose={() => {}} />);

  fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
  await waitFor(() => expect(mail.loadMore).toHaveBeenCalledOnce());
  await waitFor(() => expect(screen.getByText("Página 2")).toBeInTheDocument());
});
