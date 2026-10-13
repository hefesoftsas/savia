import type { NodeContext } from "@savia/flows-runtime";
import type { Node } from "@savia/flows-types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SearchMediaWikiNode } from "./search-mediawiki-node";

describe("SearchMediaWikiNode", () => {
  const createContext = (inputs: Record<string, unknown>): NodeContext =>
    ({
      nodeId: "search-mediawiki",
      inputs,
      organizationId: "test-org",
      env: {},
    }) as unknown as NodeContext;

  afterEach(() => vi.unstubAllGlobals());

  it("should return error for missing base URL", async () => {
    const node = new SearchMediaWikiNode({
      nodeId: "search-mediawiki",
    } as unknown as Node);
    const result = await node.execute(createContext({ query: "test" }));

    expect(result.status).toBe("error");
    expect(result.error).toContain("Base URL is required");
  });

  it("should return error for missing query", async () => {
    const node = new SearchMediaWikiNode({
      nodeId: "search-mediawiki",
    } as unknown as Node);
    const result = await node.execute(
      createContext({ baseUrl: "https://en.wikipedia.org" }),
    );

    expect(result.status).toBe("error");
    expect(result.error).toContain("Search query is required");
  });

  it("should return error for invalid base URL", async () => {
    const node = new SearchMediaWikiNode({
      nodeId: "search-mediawiki",
    } as unknown as Node);
    const result = await node.execute(
      createContext({ baseUrl: "not-a-url", query: "test" }),
    );

    expect(result.status).toBe("error");
    expect(result.error).toContain("Invalid base URL");
  });

  it("should remove all markup delimiters from API snippets", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          query: {
            searchinfo: { totalhits: 1 },
            search: [
              {
                title: "Test",
                pageid: 1,
                size: 1,
                wordcount: 1,
                snippet:
                  "<span class='searchmatch'>matched</span><scr<script>ipt>alert(1)</scr<script>ipt>",
                timestamp: "2026-10-01T00:00:00Z",
              },
            ],
          },
        }),
      }),
    );
    const node = new SearchMediaWikiNode({
      nodeId: "search-mediawiki",
    } as unknown as Node);

    const result = await node.execute(
      createContext({ baseUrl: "https://en.wikipedia.org", query: "test" }),
    );
    const snippet = (result.outputs?.results as Array<{ snippet: string }>)[0]
      .snippet;

    expect(snippet).toContain("matched");
    expect(snippet).toContain("alert(1)");
    expect(snippet).not.toMatch(/[<>]/);
  });
});
