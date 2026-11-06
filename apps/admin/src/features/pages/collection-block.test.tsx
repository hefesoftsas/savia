import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ApiClient } from "@/api/api-client";
import { CollectionBlock } from "./collection-block";

afterEach(cleanup);
it("applies the saved view's filters and search field to the viewer's record request", async () => {
  const urls: URL[] = [];
  const filters = {
    logic: "and",
    conditions: [{ field: "status", op: "eq", value: "open" }],
  };
  const api = new ApiClient({
    baseUrl: "https://savia.test",
    tokenSource: { getAccessToken: async () => null },
    fetcher: async (input) => {
      const url = new URL(String(input));
      urls.push(url);
      if (url.pathname.endsWith("objects"))
        return Response.json({
          data: [
            {
              name: "tasks",
              label: "Tasks",
              config: {
                fields: {
                  title: { type: "Text" },
                  status: { type: "Dropdown" },
                },
                studio: { pipeline: { field: "status" } },
              },
            },
          ],
        });
      if (url.pathname.includes("/views/"))
        return Response.json({
          data: [
            {
              id: "active",
              config: {
                q: "launch",
                searchField: "title",
                filters,
                group: "",
                columns: ["title"],
                sort: { field: "title", order: "ASC" },
              },
            },
          ],
        });
      return Response.json({
        data: [{ id: "1", title: "Launch app", status: "open" }],
        total: 1,
      });
    },
  });
  render(
    <CollectionBlock
      api={api}
      reference={{
        domain: "/v1/studio/1",
        collection: "tasks",
        viewId: "active",
        mode: "pipeline",
      }}
    />,
  );
  expect(await screen.findByRole("link", { name: "Launch app" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "open" })).toBeVisible();
  const request = urls.find((url) => url.pathname.includes("/records/"))!;
  expect(request.searchParams.get("searchField")).toBe("title");
  expect(JSON.parse(request.searchParams.get("filters")!)).toEqual(filters);
  expect(request.searchParams.get("sort")).toBe("title");
});
it("does not fetch records when the saved view is unavailable to the viewer", async () => {
  const paths: string[] = [];
  const api = new ApiClient({
    baseUrl: "https://savia.test",
    tokenSource: { getAccessToken: async () => null },
    fetcher: async (input) => {
      const path = new URL(String(input)).pathname;
      paths.push(path);
      return Response.json({
        data: path.endsWith("objects")
          ? [{ name: "tasks", label: "Tasks", config: { fields: {} } }]
          : [],
      });
    },
  });
  render(
    <CollectionBlock
      api={api}
      reference={{
        domain: "/v1/studio/1",
        collection: "tasks",
        viewId: "missing",
        mode: "table",
      }}
    />,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not load");
  expect(paths.some((path) => path.includes("/records/"))).toBe(false);
});
