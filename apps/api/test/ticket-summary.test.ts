import { describe, expect, it, vi } from "vitest";
import type {
  ActivePersonalIntegrationConnection,
  PersonalIntegrationNangoClient,
  PersonalIntegrationRepository,
} from "../src/personal-integrations/contracts";
import { PersonalIntegrationOperations } from "../src/personal-integrations/operations";
import { fetchTicketSummary } from "../src/personal-integrations/ticket-summary";

const connection = (
  provider: "jira" | "github",
): ActivePersonalIntegrationConnection => ({
  id: `${provider}-connection`,
  principalId: "principal-1",
  provider,
  status: "connected",
  externalAccountLabel: null,
  scopes: [],
  lastValidatedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  externalAccountId: null,
  nangoConnectionId: `${provider}-nango-connection`,
  nangoIntegrationId: `${provider}-integration`,
});

function fakeNango(
  respond: (request: {
    method: string;
    path: string;
    body?: unknown;
  }) => Response | Promise<Response>,
): PersonalIntegrationNangoClient {
  return {
    createConnectSession: async () => {
      throw new Error("unused");
    },
    createReconnectSession: async () => {
      throw new Error("unused");
    },
    getConnection: async () => {
      throw new Error("unused");
    },
    deleteConnection: async () => {
      throw new Error("unused");
    },
    proxy: async ({ method, path, body }) => respond({ method, path, body }),
  };
}

describe("personal ticket summary", () => {
  it("uses available Jira status IDs and current-user JQL, then returns the newest ticket and comment", async () => {
    const requests: string[] = [];
    const nango = fakeNango(({ path, body }) => {
      requests.push(path);
      if (path === "/oauth/token/accessible-resources")
        return Response.json([
          { id: "cloud-1", url: "https://acme.atlassian.net" },
        ]);
      if (path.endsWith("/rest/api/3/status"))
        return Response.json([{ id: "10001", name: "Code Review" }]);
      if (path.includes("/issue/OPS-8/comment?"))
        return Response.json({
          total: 2,
          comments: [
            {
              author: { displayName: "Bo" },
              body: "Latest review note",
              created: "2026-08-20T00:00:00.000Z",
            },
          ],
        });
      if (path.endsWith("/rest/api/3/search/jql")) {
        expect(body).toMatchObject({
          jql: "assignee = currentUser() AND status in (10001) AND project = OPS ORDER BY updated DESC",
          maxResults: 30,
          fields: ["summary", "status", "updated", "description", "comment"],
        });
        return Response.json({
          issues: [
            {
              key: "OPS-8",
              fields: {
                summary: "Ship ticket summary",
                status: { name: "Code Review" },
                updated: "2026-09-01T10:00:00.000Z",
                description: "No external links.",
                comment: {
                  total: 2,
                  comments: [
                    {
                      author: { displayName: "Ari" },
                      body: "older",
                      created: "2026-08-01T00:00:00.000Z",
                    },
                    {
                      author: { displayName: "Bo" },
                      body: "Latest review note",
                      created: "2026-08-20T00:00:00.000Z",
                    },
                  ],
                },
              },
            },
          ],
          isLast: true,
        });
      }
      throw new Error(`Unexpected request ${path}`);
    });

    const result = await fetchTicketSummary(nango, connection("jira"), null, {
      project: "OPS",
    });

    expect(result.tickets).toHaveLength(1);
    expect(result.tickets[0]).toMatchObject({
      key: "OPS-8",
      status: "Code Review",
      comments: {
        total: 2,
        latest: {
          author: "Bo",
          body: "Latest review note",
          createdAt: "2026-08-20T00:00:00.000Z",
          url: "https://acme.atlassian.net/browse/OPS-8",
        },
      },
      pullRequests: [],
      prLookup: "unavailable",
    });
    expect(requests).toHaveLength(4);
  });

  it("resolves validated PR links with GitHub state, latest comment, and complete review thread count", async () => {
    let requests = 0;
    const nango = fakeNango(({ method, path }) => {
      if (path === "/oauth/token/accessible-resources")
        return Response.json([
          { id: "cloud-1", url: "https://acme.atlassian.net" },
        ]);
      if (path.endsWith("/rest/api/3/status"))
        return Response.json([{ id: "10001", name: "Code Review" }]);
      if (path.endsWith("/rest/api/3/search/jql"))
        return Response.json({
          issues: [
            {
              key: "OPS-9",
              fields: {
                summary: "Linked PR",
                status: { name: "Code Review" },
                updated: "2026-09-02T10:00:00.000Z",
                description: "https://github.com/acme/web/pull/12",
                comment: { total: 0, comments: [] },
              },
            },
          ],
          isLast: true,
        });
      if (path.includes("/issue/OPS-9/comment?"))
        return Response.json({ total: 0, comments: [] });
      if (method === "POST" && path === "/graphql" && requests++ === 0)
        return Response.json({
          data: { t0: { pageInfo: { hasNextPage: false }, nodes: [] } },
        });
      if (method === "POST" && path === "/graphql")
        return Response.json({
          data: {
            p0: {
              pullRequest: {
                url: "https://github.com/acme/web/pull/12",
                title: "Implement OPS-9",
                state: "OPEN",
                isDraft: false,
                merged: false,
                reviewDecision: "APPROVED",
                comments: {
                  totalCount: 1,
                  nodes: [
                    {
                      author: { login: "reviewer" },
                      body: "Looks good",
                      createdAt: "2026-09-02T12:00:00Z",
                      url: "https://github.com/acme/web/pull/12#issuecomment-1",
                    },
                  ],
                },
                reviews: { nodes: [] },
                reviewThreads: {
                  totalCount: 2,
                  pageInfo: { hasNextPage: false },
                  nodes: [
                    {
                      isResolved: true,
                      comments: { totalCount: 0, nodes: [] },
                    },
                    {
                      isResolved: false,
                      comments: { totalCount: 0, nodes: [] },
                    },
                  ],
                },
              },
            },
          },
        });
      throw new Error(`Unexpected request ${path}`);
    });

    const result = await fetchTicketSummary(
      nango,
      connection("jira"),
      connection("github"),
      {},
    );

    expect(result.tickets[0]?.pullRequests).toEqual([
      {
        url: "https://github.com/acme/web/pull/12",
        title: "Implement OPS-9",
        state: "open",
        reviewDecision: "approved",
        comments: {
          total: 1,
          latest: {
            author: "reviewer",
            body: "Looks good",
            createdAt: "2026-09-02T12:00:00Z",
            url: "https://github.com/acme/web/pull/12#issuecomment-1",
          },
        },
        unresolvedThreads: 1,
        available: true,
      },
    ]);
    expect(result.tickets[0]?.prLookup).toBe("complete");
  });

  it("keeps Jira results when GitHub lookup fails and reports the failure", async () => {
    let requests = 0;
    const nango = fakeNango(({ method, path }) => {
      if (path === "/oauth/token/accessible-resources")
        return Response.json([
          { id: "cloud-1", url: "https://acme.atlassian.net" },
        ]);
      if (path.endsWith("/rest/api/3/status"))
        return Response.json([{ id: "10001", name: "Code Review" }]);
      if (path.endsWith("/rest/api/3/search/jql"))
        return Response.json({
          issues: [
            {
              key: "OPS-10",
              fields: {
                summary: "Preserve me",
                status: { name: "Code Review" },
                updated: "2026-09-03T10:00:00.000Z",
                description: "https://github.com/acme/web/pull/13",
                comment: { total: 0, comments: [] },
              },
            },
          ],
          isLast: true,
        });
      if (path.includes("/issue/OPS-10/comment?"))
        return Response.json({ total: 0, comments: [] });
      if (method === "POST" && path === "/graphql")
        return new Response(null, { status: 503 });
      throw new Error(`Unexpected request ${path}`);
    });

    const result = await fetchTicketSummary(
      nango,
      connection("jira"),
      connection("github"),
      {},
    );

    expect(result.tickets[0]?.key).toBe("OPS-10");
    expect(result.tickets[0]?.pullRequests).toHaveLength(1);
    expect(result.tickets[0]?.pullRequests[0]).toMatchObject({
      available: false,
      unresolvedThreads: null,
    });
    expect(result.tickets[0]?.prLookup).toBe("partial");
    expect(result.partial).toBe(true);
    expect(result.warnings).toContain("github_unavailable");
  });

  it("fetches explicitly linked pull requests even when GitHub key search fails", async () => {
    let githubRequests = 0;
    const nango = fakeNango(({ method, path }) => {
      if (path === "/oauth/token/accessible-resources")
        return Response.json([
          { id: "cloud-1", url: "https://acme.atlassian.net" },
        ]);
      if (path.endsWith("/rest/api/3/status"))
        return Response.json([{ id: "10001", name: "Code Review" }]);
      if (path.endsWith("/rest/api/3/search/jql"))
        return Response.json({
          issues: [
            {
              key: "OPS-11",
              fields: {
                summary: "Direct PR",
                status: { name: "Code Review" },
                updated: "2026-09-04T10:00:00.000Z",
                description: "https://github.com/acme/web/pull/14",
                comment: { total: 0, comments: [] },
              },
            },
          ],
          isLast: true,
        });
      if (path.includes("/issue/OPS-11/comment?"))
        return Response.json({ total: 0, comments: [] });
      if (method === "POST" && path === "/graphql" && githubRequests++ === 0)
        return new Response(null, { status: 503 });
      if (method === "POST" && path === "/graphql")
        return Response.json({
          data: {
            p0: {
              pullRequest: {
                url: "https://github.com/acme/web/pull/14",
                title: "OPS-11",
                state: "OPEN",
                isDraft: false,
                merged: false,
                reviewDecision: "REVIEW_REQUIRED",
                comments: { totalCount: 0, nodes: [] },
                reviews: { nodes: [] },
                reviewThreads: {
                  totalCount: 0,
                  pageInfo: { hasNextPage: false },
                  nodes: [],
                },
              },
            },
          },
        });
      throw new Error(`Unexpected request ${path}`);
    });

    const result = await fetchTicketSummary(
      nango,
      connection("jira"),
      connection("github"),
      {},
    );

    expect(result.tickets[0]?.pullRequests[0]).toMatchObject({
      available: true,
      state: "open",
    });
    expect(result.tickets[0]?.prLookup).toBe("partial");
    expect(result.warnings).toContain("github_unavailable");
  });

  it("keeps verified pull request state while marking truncated review threads unknown", async () => {
    const nango = fakeNango(({ method, path }) => {
      if (path === "/oauth/token/accessible-resources")
        return Response.json([
          { id: "cloud-1", url: "https://acme.atlassian.net" },
        ]);
      if (path.endsWith("/rest/api/3/status"))
        return Response.json([{ id: "10001", name: "Code Review" }]);
      if (path.endsWith("/rest/api/3/search/jql"))
        return Response.json({
          issues: [
            {
              key: "OPS-12",
              fields: {
                summary: "Truncated threads",
                status: { name: "Code Review" },
                updated: "2026-09-05T10:00:00.000Z",
                description: "https://github.com/acme/web/pull/15",
                comment: { total: 0, comments: [] },
              },
            },
          ],
          isLast: true,
        });
      if (path.includes("/issue/OPS-12/comment?"))
        return Response.json({ total: 0, comments: [] });
      if (method === "POST" && path === "/graphql") {
        return Response.json({
          data: {
            p0: {
              pullRequest: {
                url: "https://github.com/acme/web/pull/15",
                title: "OPS-12",
                state: "OPEN",
                isDraft: false,
                merged: false,
                reviewDecision: "APPROVED",
                comments: { totalCount: 0, nodes: [] },
                reviews: { nodes: [] },
                reviewThreads: {
                  totalCount: 21,
                  pageInfo: { hasNextPage: true },
                  nodes: Array.from({ length: 20 }, () => ({
                    isResolved: false,
                    comments: { totalCount: 0, nodes: [] },
                  })),
                },
              },
            },
          },
        });
      }
      throw new Error(`Unexpected request ${path}`);
    });
    let graphqlCall = 0;
    const proxy = nango.proxy.bind(nango);
    nango.proxy = async (request) => {
      if (request.path === "/graphql" && graphqlCall++ === 0)
        return Response.json({
          data: { t0: { pageInfo: { hasNextPage: false }, nodes: [] } },
        });
      return proxy(request);
    };

    const result = await fetchTicketSummary(
      nango,
      connection("jira"),
      connection("github"),
      {},
    );

    expect(result.tickets[0]?.pullRequests[0]).toMatchObject({
      available: true,
      state: "open",
      reviewDecision: "approved",
      unresolvedThreads: null,
    });
    expect(result.warnings).toContain("github_partial");
  });

  it("rejects search matches whose exact Jira key is only a longer key", async () => {
    const nango = fakeNango(({ method, path }) => {
      if (path === "/oauth/token/accessible-resources")
        return Response.json([
          { id: "cloud-1", url: "https://acme.atlassian.net" },
        ]);
      if (path.endsWith("/rest/api/3/status"))
        return Response.json([{ id: "10001", name: "Code Review" }]);
      if (path.endsWith("/rest/api/3/search/jql"))
        return Response.json({
          issues: [
            {
              key: "OPS-8",
              fields: {
                summary: "Boundary",
                status: { name: "Code Review" },
                updated: "2026-09-06T10:00:00.000Z",
                description: "",
                comment: { total: 0, comments: [] },
              },
            },
          ],
          isLast: true,
        });
      if (path.includes("/issue/OPS-8/comment?"))
        return Response.json({ total: 0, comments: [] });
      if (method === "POST" && path === "/graphql")
        return Response.json({
          data: {
            t0: {
              pageInfo: { hasNextPage: false },
              nodes: [
                {
                  url: "https://github.com/acme/web/pull/80",
                  title: "Fix OPS-80",
                  body: "Implements OPS-80",
                },
              ],
            },
          },
        });
      throw new Error(`Unexpected request ${path}`);
    });

    const result = await fetchTicketSummary(
      nango,
      connection("jira"),
      connection("github"),
      {},
    );

    expect(result.tickets[0]?.pullRequests).toEqual([]);
    expect(result.tickets[0]?.prLookup).toBe("complete");
  });

  it.each([
    { pageInfo: { hasNextPage: false } },
    { nodes: [] },
    { nodes: [], pageInfo: {} },
    { nodes: null, pageInfo: { hasNextPage: false } },
  ])(
    "marks incomplete GitHub search metadata as partial: %j",
    async (search) => {
      const nango = fakeNango(({ path }) => {
        if (path === "/oauth/token/accessible-resources")
          return Response.json([
            { id: "cloud-1", url: "https://acme.atlassian.net" },
          ]);
        if (path.endsWith("/rest/api/3/status"))
          return Response.json([{ id: "10001", name: "Code Review" }]);
        if (path.endsWith("/rest/api/3/search/jql"))
          return Response.json({
            issues: [
              {
                key: "OPS-8",
                fields: {
                  summary: "Incomplete search",
                  status: { name: "Code Review" },
                  updated: "2026-09-06T10:00:00.000Z",
                  description: "",
                  comment: { total: 0, comments: [] },
                },
              },
            ],
            isLast: true,
          });
        if (path.includes("/issue/OPS-8/comment?"))
          return Response.json({ total: 0, comments: [] });
        if (path === "/graphql") return Response.json({ data: { t0: search } });
        throw new Error(`Unexpected request ${path}`);
      });
      const result = await fetchTicketSummary(
        nango,
        connection("jira"),
        connection("github"),
        {},
      );
      expect(result.tickets[0]?.prLookup).toBe("partial");
      expect(result.partial).toBe(true);
      expect(result.warnings).toContain("github_partial");
    },
  );

  it("marks an incomplete Jira search page as partial", async () => {
    const nango = fakeNango(({ path }) => {
      if (path === "/oauth/token/accessible-resources")
        return Response.json([
          { id: "cloud-1", url: "https://acme.atlassian.net" },
        ]);
      if (path.endsWith("/rest/api/3/status"))
        return Response.json([{ id: "10001", name: "Code Review" }]);
      if (path.endsWith("/rest/api/3/search/jql"))
        return Response.json({
          issues: [],
          isLast: false,
          nextPageToken: "next",
        });
      throw new Error(`Unexpected request ${path}`);
    });

    const result = await fetchTicketSummary(
      nango,
      connection("jira"),
      null,
      {},
    );

    expect(result.partial).toBe(true);
    expect(result.warnings).toContain("jira_partial");
  });

  it("fails when every Jira site is unavailable but preserves a successful site", async () => {
    const run = (successfulSite: boolean) =>
      fetchTicketSummary(
        fakeNango(({ path }) => {
          if (path === "/oauth/token/accessible-resources")
            return Response.json([
              { id: "cloud-1", url: "https://one.atlassian.net" },
              { id: "cloud-2", url: "https://two.atlassian.net" },
            ]);
          if (path.includes("/ex/jira/cloud-1/rest/api/3/status"))
            return new Response(null, { status: 503 });
          if (path.includes("/ex/jira/cloud-2/rest/api/3/status"))
            return successfulSite
              ? Response.json([])
              : new Response(null, { status: 503 });
          throw new Error(`Unexpected request ${path}`);
        }),
        connection("jira"),
        null,
        {},
      );

    await expect(run(false)).rejects.toThrow(
      "personal integration request could not be completed",
    );
    await expect(run(true)).resolves.toMatchObject({
      tickets: [],
      partial: true,
      warnings: ["jira_partial"],
    });
  });

  it("does not look up a GitHub connection when the provider is disabled", async () => {
    const jira = connection("jira");
    const findActiveConnection = vi.fn(
      async (_principalId: string, provider: "jira" | "github") =>
        provider === "jira" ? jira : connection("github"),
    );
    const repository = {
      findActiveConnection,
    } as unknown as PersonalIntegrationRepository;
    const nango = fakeNango(({ path }) => {
      if (path === "/oauth/token/accessible-resources")
        return Response.json([
          { id: "cloud-1", url: "https://acme.atlassian.net" },
        ]);
      if (path.endsWith("/rest/api/3/status")) return Response.json([]);
      throw new Error(`Unexpected request ${path}`);
    });
    const operations = new PersonalIntegrationOperations(repository, nango);

    await operations.summarizeTickets({
      principalId: "principal-1",
      config: {},
      githubEnabled: false,
    });

    expect(findActiveConnection).toHaveBeenCalledTimes(1);
    expect(findActiveConnection).toHaveBeenCalledWith("principal-1", "jira");
  });
});
