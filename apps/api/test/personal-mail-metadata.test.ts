import { describe, it, expect, vi } from "vitest";
import { PersonalIntegrationOperations } from "../src/personal-integrations/operations";
import { normalizeGmailMessage } from "../src/personal-integrations/mail-metadata";
import type {
  PersonalIntegrationRepository,
  PersonalIntegrationNangoClient,
} from "../src/personal-integrations/contracts";

function setup(
  provider: "gmail" | "outlook",
  responses: Array<unknown | Response>,
  externalAccountLabel = "member@gmail.com",
) {
  const paths: string[] = [];
  const repository = {
    findActiveConnection: vi.fn().mockResolvedValue({
      status: "connected",
      provider,
      externalAccountLabel,
    }),
  } as unknown as PersonalIntegrationRepository;
  const nango = {
    proxy: vi.fn(async ({ path }: { path: string }) => {
      paths.push(path);
      const response = responses.shift();
      return response instanceof Response
        ? response
        : Response.json(response ?? {});
    }),
  } as unknown as PersonalIntegrationNangoClient;
  return {
    operations: new PersonalIntegrationOperations(repository, nango),
    paths,
  };
}

describe("personal inbox", () => {
  it("lists recent inbox without a query and hydrates Gmail metadata", async () => {
    const { operations, paths } = setup("gmail", [
      { messages: [{ id: "message-not-hex", threadId: "deadbeef" }] },
      {
        id: "message-not-hex",
        internalDate: "1767225600000",
        payload: {
          headers: [
            { name: "Subject", value: "Hello" },
            { name: "From", value: "Ana <ana@example.com>" },
          ],
        },
      },
      { emailAddress: "member@gmail.com" },
    ]);
    const messages = await operations.listMessages({
      principalId: "owner",
      provider: "gmail",
    } as never);
    expect(messages).toEqual([
      {
        id: "message-not-hex",
        subject: "Hello",
        sender: "Ana <ana@example.com>",
        receivedAt: "2026-01-01T00:00:00.000Z",
        webLink:
          "https://mail.google.com/mail/u/?authuser=member%40gmail.com#all/deadbeef",
      },
    ]);
    expect(
      new URL(paths[0]!, "https://example.test").searchParams.get("labelIds"),
    ).toBe("INBOX");
    expect(paths[1]).toContain("format=metadata");
    expect(paths[1]).not.toContain("format=full");
    expect(paths[2]).toBe("/gmail/v1/users/me/profile");
  });

  it("uses the Gmail profile address instead of the saved connection label", async () => {
    const { operations } = setup(
      "gmail",
      [
        { messages: [{ id: "message-not-hex", threadId: "deadbeef" }] },
        { id: "message-not-hex" },
        { emailAddress: "actual@gmail.com" },
      ],
      "wrong-account@gmail.com",
    );
    const messages = await operations.listMessages({
      principalId: "owner",
      provider: "gmail",
    } as never);

    expect(messages[0]?.webLink).toBe(
      "https://mail.google.com/mail/u/?authuser=actual%40gmail.com#all/deadbeef",
    );
  });

  it("retains Gmail rows and uses an unscoped permalink when profile lookup fails", async () => {
    const { operations } = setup("gmail", [
      { messages: [{ id: "message-not-hex", threadId: "deadbeef" }] },
      { id: "message-not-hex", payload: { headers: [] } },
      new Response(null, { status: 502 }),
    ]);
    const messages = await operations.listMessages({
      principalId: "owner",
      provider: "gmail",
    } as never);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      id: "message-not-hex",
      webLink: "https://mail.google.com/mail/u/#all/deadbeef",
    });
  });
  it("uses Outlook inbox ordering and exposes native links", async () => {
    const { operations, paths } = setup("outlook", [
      {
        value: [
          {
            id: "2",
            subject: "Hi",
            receivedDateTime: "2026-01-01T00:00:00Z",
            from: { emailAddress: { address: "ana@example.com" } },
            webLink: "https://outlook.office.com/mail/item/2",
          },
        ],
      },
    ]);
    const messages = await operations.listMessages({
      principalId: "owner",
      provider: "outlook",
    } as never);
    expect(paths[0]).toContain("/me/mailFolders/inbox/messages?");
    expect(
      new URL(paths[0]!, "https://example.test").searchParams.get("$orderby"),
    ).toBe("receivedDateTime desc");
    expect(messages[0]?.webLink).toBe("https://outlook.office.com/mail/item/2");
  });
  it("preserves search semantics and rejects unsafe native links", async () => {
    const { operations, paths } = setup("outlook", [
      {
        value: [
          { id: "2", webLink: "https://outlook.office.com.evil.test/phish" },
        ],
      },
    ]);
    const messages = await operations.listMessages({
      principalId: "owner",
      provider: "outlook",
      query: "renewal",
    });
    expect(paths[0]).toContain("/me/messages?");
    expect(
      new URL(paths[0]!, "https://example.test").searchParams.get("$filter"),
    ).toBe("contains(subject,'renewal')");
    expect(messages[0]?.webLink).toBeNull();
  });
});

describe("Gmail browser permalinks", () => {
  it("uses the Gmail thread ID and account-scoped authuser parameter", () => {
    expect(
      normalizeGmailMessage(
        { id: "message-not-hex", threadId: "aB12ef" },
        "member+label@gmail.com",
      )?.webLink,
    ).toBe(
      "https://mail.google.com/mail/u/?authuser=member%2Blabel%40gmail.com#all/aB12ef",
    );
  });

  it("falls back to a hex message ID and rejects unsafe identifiers or account labels", () => {
    expect(
      normalizeGmailMessage(
        { id: "a1b2", threadId: "../../external" },
        "member@gmail.com",
      )?.webLink,
    ).toBe(
      "https://mail.google.com/mail/u/?authuser=member%40gmail.com#all/a1b2",
    );
    expect(
      normalizeGmailMessage(
        { id: "not-hex", threadId: "also-not-hex" },
        "member@gmail.com",
      )?.webLink,
    ).toBeNull();
    expect(
      normalizeGmailMessage({ id: "a1b2" }, "member@gmail.com/evil")?.webLink,
    ).toBeNull();
    expect(normalizeGmailMessage({ id: "a1b2" })?.webLink).toBe(
      "https://mail.google.com/mail/u/#all/a1b2",
    );
  });
});

it("keeps failed Gmail hydration rows and bounds provider metadata concurrency", async () => {
  let active = 0;
  let maximum = 0;
  let reads = 0;
  const repository = {
    findActiveConnection: async () => ({ status: "connected" }),
  } as unknown as PersonalIntegrationRepository;
  const nango = {
    proxy: async ({ path }: { path: string }) => {
      if (path.includes("messages?"))
        return Response.json({
          messages: Array.from({ length: 30 }, (_, id) => ({ id: String(id) })),
        });
      ++active;
      maximum = Math.max(maximum, active);
      ++reads;
      await Promise.resolve();
      await Promise.resolve();
      --active;
      return new Response(null, { status: 502 });
    },
  } as unknown as PersonalIntegrationNangoClient;
  const messages = await new PersonalIntegrationOperations(
    repository,
    nango,
  ).listMessages({ principalId: "owner", provider: "gmail" });
  expect(messages).toHaveLength(25);
  expect(reads).toBe(26);
  expect(maximum).toBeLessThanOrEqual(4);
  expect(messages[0]).toMatchObject({
    id: "0",
    subject: null,
    receivedAt: null,
    webLink: "https://mail.google.com/mail/u/#all/0",
  });
});
