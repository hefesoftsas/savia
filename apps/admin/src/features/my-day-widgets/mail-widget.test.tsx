import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  screen,
  within,
  waitFor,
  act,
} from "@testing-library/react";
import { render } from "../studio-engine/test/locale-test-render";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { useMyDayMail, type PersonalMailLike } from "./use-my-day-mail";
import { MailWidgetBody } from "./mail-widget";
afterEach(cleanup);
function client(providers = ["gmail", "outlook"]) {
  return {
    listConnections: vi.fn(async () =>
      providers.map((provider) => ({
        provider,
        status: "connected",
        externalAccountLabel: `${provider}@example.com`,
      })),
    ),
    listMessages: vi.fn(async ({ provider }: { provider: string }) => [
      {
        id: "same",
        subject: `${provider} message`,
        sender: "Ana",
        receivedAt: provider === "gmail" ? null : "2026-01-01T00:00:00Z",
        webLink:
          provider === "outlook"
            ? "https://outlook.office.com/mail/item/1"
            : null,
      },
    ]),
    sendMail: vi.fn(),
  } as PersonalMailLike;
}
function Inbox({ service }: { service: PersonalMailLike }) {
  const mail = useMyDayMail(service);
  return (
    <>
      <span data-testid="accounts">{mail.connections.length}</span>
      <MailWidgetBody mail={mail} onCompose={() => {}} />
    </>
  );
}
it("merges providers with distinct same-ID rows, missing dates last, and filters", async () => {
  const user = userEvent.setup();
  render(<Inbox service={client()} />);
  expect(
    (await screen.findByText("outlook message")).closest("a"),
  ).toHaveAttribute("target", "_blank");
  expect(screen.getByText("outlook message").closest("a")).toHaveAttribute(
    "rel",
    "noopener noreferrer",
  );
  expect(screen.getByText("gmail message")).toBeInTheDocument();
  const rows = screen.getAllByRole("listitem");
  expect(rows[0]).toHaveTextContent("outlook message");
  await user.click(screen.getByRole("tab", { name: "Gmail" }));
  expect(screen.queryByText("outlook message")).not.toBeInTheDocument();
});
it("retains successful rows when one provider fails and retries", async () => {
  const service = client();
  vi.mocked(service.listMessages).mockImplementation(async ({ provider }) => {
    if (provider === "gmail") throw new Error("offline");
    return [
      {
        id: "1",
        subject: "Outlook works",
        sender: null,
        receivedAt: null,
        webLink: null,
      },
    ];
  });
  render(<Inbox service={service} />);
  expect(await screen.findByText("Outlook works")).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("Gmail");
  fireEvent.click(screen.getByRole("button", { name: "Actualizar correos" }));
  await waitFor(() => expect(service.listMessages).toHaveBeenCalledTimes(4));
});
it.each(["gmail", "outlook"])(
  "loads sole connected %s account",
  async (provider) => {
    render(<Inbox service={client([provider])} />);
    expect(await screen.findByText(`${provider} message`)).toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "Todos" }),
    ).not.toBeInTheDocument();
  },
);
it("does not read disconnected accounts", async () => {
  const service = client([]);
  render(<Inbox service={service} />);
  await waitFor(() =>
    expect(screen.getByTestId("accounts")).toHaveTextContent("0"),
  );
  expect(service.listMessages).not.toHaveBeenCalled();
});
it("clears identity state and ignores old pending mailbox responses", async () => {
  const service = client(["gmail"]);
  let resolve!: (
    value: Awaited<ReturnType<PersonalMailLike["listMessages"]>>,
  ) => void;
  vi.mocked(service.listMessages)
    .mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    )
    .mockResolvedValue([]);
  render(<Inbox service={service} />);
  await waitFor(() => expect(service.listMessages).toHaveBeenCalledOnce());
  act(() => window.dispatchEvent(new Event("savia:identity-changed")));
  await act(async () =>
    resolve([
      {
        id: "old",
        subject: "Previous identity",
        sender: null,
        receivedAt: null,
        webLink: null,
      },
    ]),
  );
  expect(screen.queryByText("Previous identity")).not.toBeInTheDocument();
});
it("caps the visible inbox at ten messages and distinguishes an empty mailbox", async () => {
  const service = client(["gmail"]);
  vi.mocked(service.listMessages).mockResolvedValue(
    Array.from({ length: 25 }, (_, id) => ({
      id: String(id),
      subject: `Message ${id}`,
      sender: null,
      receivedAt: null,
      webLink: null,
    })),
  );
  render(<Inbox service={service} />);
  await screen.findByText("Message 0");
  expect(
    within(screen.getByRole("list", { name: "Correos" })).getAllByRole(
      "listitem",
    ),
  ).toHaveLength(10);
  vi.mocked(service.listMessages).mockResolvedValue([]);
  fireEvent.click(screen.getByRole("button", { name: "Actualizar correos" }));
  expect(
    await screen.findByText("No hay correos en esta bandeja."),
  ).toBeInTheDocument();
});

it.each([
  [
    "gmail",
    "https://mail.google.com/mail/?authuser=gmail%40example.com#all/19f123",
  ],
  ["outlook", "https://outlook.live.com/mail/0/id/message-1"],
])(
  "opens the entire %s message row in a new tab",
  async (provider, webLink) => {
    const service = client([provider]);
    vi.mocked(service.listMessages).mockResolvedValue([
      {
        id: "19f123",
        subject: "Open this message",
        sender: "sender@example.com",
        receivedAt: "2026-01-01T00:00:00Z",
        webLink,
      },
    ]);
    render(<Inbox service={service} />);
    const subject = await screen.findByText("Open this message");
    const link = subject.closest("a");
    expect(link).toHaveAttribute("href", webLink);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByText("sender@example.com").closest("a")).toBe(link);
    expect(
      screen
        .getByText(
          new RegExp(`${provider === "gmail" ? "Gmail" : "Outlook"} ·`),
        )
        .closest("a"),
    ).toBe(link);
  },
);
it("does not make an untrusted mail URL clickable", async () => {
  const service = client(["gmail"]);
  vi.mocked(service.listMessages).mockResolvedValue([
    {
      id: "1",
      subject: "Unsafe link",
      sender: null,
      receivedAt: null,
      webLink: "https://mail.google.com.evil.test/message",
    },
  ]);
  render(<Inbox service={service} />);
  expect((await screen.findByText("Unsafe link")).closest("a")).toBeNull();
});
