import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "./api-client";
import { createSaviaDataProvider } from "./savia-data-provider";

describe("Savia data provider", () => {
  it("maps a public document page to flattened React Admin records", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              id: "quote-1",
              kind: "quote",
              attributes: { number: "Q-100", premium: 1200 },
              relationships: {
                customer: { id: "customer-1", kind: "customer-profile" },
              },
            },
          ],
          page: { limit: 25, offset: 25 },
        }),
        { headers: { "content-type": "application/json" } },
      ),
    );
    const dataProvider = createSaviaDataProvider(
      new ApiClient({
        baseUrl: "http://127.0.0.1:8787",
        tokenSource: { getAccessToken: async () => "token" },
        fetcher,
      }),
    );

    const result = await dataProvider.getList("workspace/quotes", {
      pagination: { page: 2, perPage: 25 },
      sort: { field: "id", order: "ASC" },
      filter: {},
    });

    expect(fetcher).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/v1/workspace/quotes?limit=25&offset=25",
      expect.any(Object),
    );
    expect(result).toMatchObject({
      data: [
        expect.objectContaining({
          id: "quote-1",
          kind: "quote",
          number: "Q-100",
          premium: 1200,
        }),
      ],
      pageInfo: { hasNextPage: false, hasPreviousPage: true },
    });
    expect(result.data[0]?.relationships).toEqual({
      customer: { id: "customer-1", kind: "customer-profile" },
    });
  });
});
