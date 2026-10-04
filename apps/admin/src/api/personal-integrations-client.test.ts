import { expect, it, vi } from "vitest";
import { PersonalIntegrationsClient } from "./personal-integrations-client";

it("bypasses the short-lived connection cache on realtime refresh", async () => {
  const get = vi
    .fn()
    .mockResolvedValueOnce({
      data: [{ id: "old", attributes: { status: "connected" } }],
    })
    .mockResolvedValueOnce({ data: [] });
  const client = new PersonalIntegrationsClient({ get } as never);
  expect(await client.listConnections()).toHaveLength(1);
  expect(await client.listConnections()).toHaveLength(1);
  expect(get).toHaveBeenCalledTimes(1);
  expect(await client.listConnections(true)).toEqual([]);
  expect(get).toHaveBeenCalledTimes(2);
});

it("does not reuse connection requests across authenticated identities", async () => {
  let resolveFirst!: (value: {
    data: Array<{ id: string; attributes: never }>;
  }) => void;
  const get = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    )
    .mockResolvedValue({ data: [] });
  const client = new PersonalIntegrationsClient({ get } as never);
  const first = client.listConnections();

  window.dispatchEvent(new Event("savia:identity-changed"));
  await expect(client.listConnections()).resolves.toEqual([]);
  resolveFirst({
    data: [
      {
        id: "old-user",
        attributes: {
          provider: "google_calendar",
          status: "connected",
        } as never,
      },
    ],
  });
  await first;

  await expect(client.listConnections()).resolves.toEqual([]);
  expect(get).toHaveBeenCalledTimes(2);
});

it("requests an issue preview without retaining the returned metadata", async () => {
  const preview = {
    provider: "linear" as const,
    url: "https://linear.app/acme/issue/ENG-7",
    identifier: "ENG-7",
    title: "Fix the dashboard",
    status: "Todo",
    assignee: null,
  };
  const post = vi.fn().mockResolvedValue({ data: preview });
  const client = new PersonalIntegrationsClient({ post } as never);

  await expect(client.previewIssue(preview.url)).resolves.toEqual(preview);
  expect(post).toHaveBeenCalledWith("/v1/personal-integrations/issue-preview", {
    url: preview.url,
  });
});

it("lists collaboration channels with provider and cursor pagination", async () => {
  const page = {
    data: [
      {
        id: "channel-1",
        name: "launch",
        teamId: "team-1",
        teamName: "Product",
      },
    ],
    pagination: { nextCursor: "cursor-2" },
  };
  const get = vi.fn().mockResolvedValue(page);
  const client = new PersonalIntegrationsClient({ get } as never);

  await expect(
    client.listCollaborationChannels({
      provider: "microsoft_teams",
      cursor: "cursor/2",
    }),
  ).resolves.toEqual({
    channels: page.data,
    nextCursor: "cursor-2",
  });
  expect(get).toHaveBeenCalledWith(
    "/v1/personal-integrations/collaboration/channels?provider=microsoft_teams&cursor=cursor%2F2",
  );
});

it("sends a reviewed record message to its selected collaboration channel", async () => {
  const result = { provider: "slack", messageId: "message-1" } as const;
  const post = vi.fn().mockResolvedValue({ data: result });
  const client = new PersonalIntegrationsClient({ post } as never);
  const input = {
    provider: "slack" as const,
    channelId: "channel-1",
    title: "Renewal",
    summary: "Customer requested a quote",
    url: "https://savia.example/admin?object=deals&view=records&record=1",
    context: {
      apiBasePath: "/v1/studio/7",
      collection: "deals",
      recordId: "1",
      fields: ["name", "status"],
    },
    requestId: "attempt-1",
  };

  await expect(client.shareRecordToChat(input)).resolves.toEqual(result);
  expect(post).toHaveBeenCalledWith(
    "/v1/personal-integrations/collaboration/messages",
    input,
  );
});

it("requests the native booking agenda with range and time zone", async () => {
  const booking = { id: "booking-1", tenantId: 7 };
  const get = vi.fn().mockResolvedValue({ data: [booking] });
  const client = new PersonalIntegrationsClient({ get } as never);

  await expect(
    client.listBookingAgenda({
      from: "2026-01-03T00:00:00.000Z",
      to: "2026-01-04T00:00:00.000Z",
      timeZone: "America/Bogota",
    }),
  ).resolves.toEqual([booking]);
  expect(get).toHaveBeenCalledWith(
    "/v1/personal-integrations/bookings?from=2026-01-03T00%3A00%3A00.000Z&to=2026-01-04T00%3A00%3A00.000Z&timeZone=America%2FBogota",
  );
});

it("requests a video conference only when creating a video call", async () => {
  const created = {
    id: "event-1",
    title: "Planning",
    startsAt: "2026-10-05T14:00:00.000Z",
    endsAt: "2026-10-05T14:30:00.000Z",
    webLink: null,
    conference: {
      provider: "google_meet",
      joinUrl: "https://meet.google.com/abc-defg-hij",
      status: "ready",
    },
  };
  const post = vi.fn().mockResolvedValue({ data: created });
  const client = new PersonalIntegrationsClient({ post } as never);

  await expect(
    client.createCalendarEvent({
      provider: "google_calendar",
      title: "Planning",
      startsAt: created.startsAt,
      endsAt: created.endsAt,
      videoCall: true,
    }),
  ).resolves.toEqual(created);
  expect(post).toHaveBeenCalledWith("/v1/personal-integrations/events", {
    provider: "google_calendar",
    title: "Planning",
    startsAt: created.startsAt,
    endsAt: created.endsAt,
    videoCall: true,
  });
});

it("deletes a calendar event only after confirmed deletion and uses an encoded event id", async () => {
  const remove = vi.fn().mockResolvedValue({ data: { deleted: true } });
  const client = new PersonalIntegrationsClient({ delete: remove } as never);

  await client.deleteCalendarEvent({
    provider: "outlook",
    eventId: "event/part?other&value",
    connectionId: "calendar-connection-1",
  });

  expect(remove).toHaveBeenCalledWith(
    "/v1/personal-integrations/events/outlook/event%2Fpart%3Fother%26value",
    {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        confirmed: true,
        connectionId: "calendar-connection-1",
      }),
    },
  );
});

it("invalidates cached connections and notifies Pages after a successful connection", async () => {
  const connection = {
    id: "jira-1",
    attributes: {
      provider: "jira",
      status: "connected",
      externalAccountLabel: "acme",
      scopes: [],
      lastValidatedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  };
  const get = vi
    .fn()
    .mockResolvedValueOnce({ data: [] })
    .mockResolvedValue({
      data: [connection],
    });
  const post = vi.fn().mockResolvedValue({ data: connection });
  const client = new PersonalIntegrationsClient({ get, post } as never);
  const changed = vi.fn();
  window.addEventListener("savia:personal-integrations-changed", changed);

  await client.listConnections();
  await client.complete("jira", "nango-connection-1");

  expect(changed).toHaveBeenCalledTimes(1);
  await expect(client.listConnections()).resolves.toHaveLength(1);
  expect(get).toHaveBeenCalledTimes(2);
  window.removeEventListener("savia:personal-integrations-changed", changed);
});

it("invalidates cached connections and notifies Pages after disconnect", async () => {
  const get = vi
    .fn()
    .mockResolvedValueOnce({
      data: [
        {
          id: "linear-1",
          attributes: { provider: "linear", status: "connected" },
        },
      ],
    })
    .mockResolvedValue({ data: [] });
  const remove = vi.fn().mockResolvedValue(undefined);
  const client = new PersonalIntegrationsClient({
    get,
    delete: remove,
  } as never);
  const changed = vi.fn();
  window.addEventListener("savia:personal-integrations-changed", changed);

  await client.listConnections();
  await client.disconnect("linear");

  expect(changed).toHaveBeenCalledTimes(1);
  await expect(client.listConnections()).resolves.toEqual([]);
  expect(get).toHaveBeenCalledTimes(2);
  window.removeEventListener("savia:personal-integrations-changed", changed);
});
