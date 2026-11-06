import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ApiClient } from "@/api/api-client";
import { RecordProperties } from "./record-properties";

afterEach(cleanup);
const binding = {
  domain: "/v1/studio/1",
  collection: "tasks",
  recordId: "task-1",
};
it("loads current authorized record properties and omits hidden fields", async () => {
  const paths: string[] = [];
  const api = new ApiClient({
    baseUrl: "https://savia.test",
    tokenSource: { getAccessToken: async () => null },
    fetcher: async (input) => {
      const path = new URL(String(input)).pathname;
      paths.push(path);
      return Response.json({
        data: path.endsWith("objects")
          ? [
              {
                name: "tasks",
                config: {
                  fields: {
                    title: { label: "Task" },
                    secret: { hidden: true },
                  },
                },
              },
            ]
          : { id: "task-1", title: "Current task", secret: "Do not show" },
      });
    },
  });
  render(<RecordProperties api={api} binding={binding} />);
  expect(await screen.findByText("Current task")).toBeVisible();
  expect(screen.queryByText("Do not show")).not.toBeInTheDocument();
  expect(paths).toContain("/v1/studio/1/api/records/tasks/task-1");
});
it("does not display properties when the viewer cannot read the collection", async () => {
  const api = new ApiClient({
    baseUrl: "https://savia.test",
    tokenSource: { getAccessToken: async () => null },
    fetcher: async () =>
      Response.json(
        { error: { code: "FORBIDDEN", message: "Forbidden" } },
        { status: 403 },
      ),
  });
  render(<RecordProperties api={api} binding={binding} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not load");
  expect(screen.queryByRole("definition")).not.toBeInTheDocument();
});
