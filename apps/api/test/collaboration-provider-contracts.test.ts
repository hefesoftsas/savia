import { describe, expect, it, vi } from "vitest";
import { listCollaborationChannels } from "../src/personal-integrations/collaboration";
import type {
  ActivePersonalIntegrationConnection,
  PersonalIntegrationNangoClient,
  PersonalIntegrationRepository,
} from "../src/personal-integrations/contracts";

const connection = {
  id: "teams-connection",
  provider: "microsoft_teams",
  principalId: "alice",
  nangoConnectionId: "alice-teams",
  nangoIntegrationId: "teams",
  status: "connected",
} as ActivePersonalIntegrationConnection;

function listing(proxy: PersonalIntegrationNangoClient["proxy"]) {
  return {
    provider: "microsoft_teams" as const,
    connection,
    nango: { proxy } as PersonalIntegrationNangoClient,
    repository: {
      markReconnectRequired: vi.fn().mockResolvedValue(true),
    } as unknown as PersonalIntegrationRepository,
  };
}

function graphPages(pages: Record<string, unknown>) {
  return vi.fn<PersonalIntegrationNangoClient["proxy"]>(async ({ path }) => {
    if (!(path in pages))
      throw new Error(`Unexpected provider request: ${path}`);
    return Response.json(pages[path]);
  });
}

describe("collaboration provider boundaries", () => {
  it("keeps continuation tokens within the public API limit for large organizations", async () => {
    const proxy = vi.fn<PersonalIntegrationNangoClient["proxy"]>();
    proxy.mockResolvedValueOnce(
      Response.json({
        value: Array.from({ length: 100 }, (_, index) => ({
          id: `team-${index}`,
          displayName: `Team ${index} ${"x".repeat(200)}`,
        })),
      }),
    );
    proxy.mockResolvedValueOnce(
      Response.json({
        value: Array.from({ length: 100 }, (_, index) => ({
          id: `channel-${index}`,
          displayName: `Channel ${index}`,
        })),
      }),
    );
    const first = await listCollaborationChannels(listing(proxy));
    expect(first.nextCursor).not.toBeNull();
    expect(first.nextCursor!.length).toBeLessThanOrEqual(8192);
  });

  it("can resume its own Teams channel cursor without losing channels", async () => {
    const proxy = graphPages({
      "/v1.0/me/joinedTeams": {
        value: [{ id: "team-one", displayName: "Product" }],
      },
      "/v1.0/teams/team-one/channels?$top=100": {
        value: Array.from({ length: 100 }, (_, index) => ({
          id: `channel-${index}`,
          displayName: `Channel ${index}`,
        })),
        "@odata.nextLink":
          "https://graph.microsoft.com/v1.0/teams/team-one/channels?$skiptoken=next",
      },
      "/v1.0/teams/team-one/channels?$skiptoken=next": {
        value: [{ id: "last-channel", displayName: "Launch" }],
      },
    });
    const input = listing(proxy);
    const first = await listCollaborationChannels(input);
    expect(first.channels).toHaveLength(100);
    expect(first.nextCursor).not.toBeNull();
    const second = await listCollaborationChannels({
      ...input,
      cursor: first.nextCursor!,
    });
    expect(second).toEqual({
      channels: [
        {
          id: "last-channel",
          name: "Launch",
          teamId: "team-one",
          teamName: "Product",
        },
      ],
      nextCursor: null,
    });
    expect(proxy).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/v1.0/teams/team-one/channels?$skiptoken=next",
      }),
    );
  });

  it("preserves the next teams page when the channel page is full", async () => {
    const proxy = graphPages({
      "/v1.0/me/joinedTeams": {
        value: [{ id: "team-one", displayName: "Product" }],
        "@odata.nextLink":
          "https://graph.microsoft.com/v1.0/me/joinedTeams?$skiptoken=teams-next",
      },
      "/v1.0/teams/team-one/channels?$top=100": {
        value: Array.from({ length: 100 }, (_, index) => ({
          id: `channel-${index}`,
          displayName: `Channel ${index}`,
        })),
      },
      "/v1.0/me/joinedTeams?$skiptoken=teams-next": {
        value: [{ id: "team-two", displayName: "Support" }],
      },
      "/v1.0/teams/team-two/channels?$top=100": {
        value: [{ id: "support", displayName: "Help" }],
      },
    });
    const input = listing(proxy);
    const first = await listCollaborationChannels(input);
    expect(first.nextCursor).not.toBeNull();
    const second = await listCollaborationChannels({
      ...input,
      cursor: first.nextCursor!,
    });
    expect(second.channels).toEqual([
      { id: "support", name: "Help", teamId: "team-two", teamName: "Support" },
    ]);
    expect(second.nextCursor).toBeNull();
  });

  it.each([
    "https://attacker.example/v1.0/teams/team-one/channels",
    "https://graph.microsoft.com/v1.0/me/messages",
    "https://graph.microsoft.com/v1.0/teams/another-team/channels",
  ])(
    "rejects an upstream continuation outside the selected channel resource: %s",
    async (nextLink) => {
      const proxy = vi.fn<PersonalIntegrationNangoClient["proxy"]>();
      proxy.mockResolvedValueOnce(
        Response.json({ value: [{ id: "team-one", displayName: "Product" }] }),
      );
      proxy.mockResolvedValueOnce(
        Response.json({ value: [], "@odata.nextLink": nextLink }),
      );
      await expect(
        listCollaborationChannels(listing(proxy)),
      ).rejects.toMatchObject({
        code: "PERSONAL_INTEGRATION_REQUEST_FAILED",
      });
      expect(proxy).toHaveBeenCalledTimes(2);
    },
  );

  it("marks a revoked Slack token for reconnection even when Slack returns HTTP 200", async () => {
    const proxy = vi
      .fn<PersonalIntegrationNangoClient["proxy"]>()
      .mockResolvedValue(Response.json({ ok: false, error: "token_revoked" }));
    const input = listing(proxy);
    await expect(
      listCollaborationChannels({
        ...input,
        provider: "slack",
        connection: { ...connection, provider: "slack" },
      }),
    ).rejects.toMatchObject({ code: "PERSONAL_INTEGRATION_REQUEST_FAILED" });
    expect(input.repository.markReconnectRequired).toHaveBeenCalledWith(
      "teams-connection",
    );
  });
});
