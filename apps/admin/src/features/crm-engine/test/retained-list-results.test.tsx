import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "@testing-library/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ListContextProvider, useListContext } from "ra-core";
import { RetainedListResults } from "../retained-list-results";
afterEach(cleanup);
function Rows() {
  const { data, isPending } = useListContext();
  return (
    <div>
      {isPending
        ? "Loading"
        : (data?.map((r) => r.name).join(",") ?? "No rows")}
    </div>
  );
}
let client = new QueryClient();
function View({
  scope = "people",
  ...value
}: {
  scope?: string;
  data?: { id: string; name: string }[];
  error?: Error;
  isPending?: boolean;
  isFetching?: boolean;
  isPlaceholderData?: boolean;
}) {
  return (
    <QueryClientProvider client={client}>
      <ListContextProvider
        value={
          {
            ...value,
            resource: scope,
            refetch: async () => {},
            total: 1,
          } as never
        }
      >
        <RetainedListResults scope={scope}>
          <Rows />
        </RetainedListResults>
      </ListContextProvider>
    </QueryClientProvider>
  );
}
it("keeps successful rows visible after an interrupted page change and exposes retry", () => {
  const { rerender } = render(<View data={[{ id: "1", name: "Ana" }]} />);
  rerender(<View isPending isFetching />);
  expect(screen.getByText("Ana")).toBeVisible();
  rerender(<View error={new Error("No connection")} />);
  expect(screen.getByText("Ana")).toBeVisible();
  expect(screen.getByRole("alert")).toHaveTextContent("No connection");
  expect(screen.getByRole("button", { name: "Reintentar" })).toBeVisible();
});
it("does not reuse another collection or retain records after access is denied", () => {
  const { rerender } = render(<View data={[{ id: "1", name: "Ana" }]} />);
  rerender(<View scope="private" isPending />);
  expect(screen.queryByText("Ana")).not.toBeInTheDocument();
  rerender(<View data={[{ id: "1", name: "Ana" }]} />);
  rerender(
    <View error={Object.assign(new Error("Forbidden"), { status: 403 })} />,
  );
  expect(screen.queryByText("Ana")).not.toBeInTheDocument();
});

it("clears retained and placeholder rows when the resource cache is reset or removed", async () => {
  for (const operation of ["reset", "remove"] as const) {
    client = new QueryClient();
    const data = [{ id: "1", name: "Revoked person" }];
    const key = ["people", "getList", {}];
    client.setQueryData(key, { data, total: 1 });
    const { rerender, unmount } = render(<View data={data} />);
    expect(screen.getByText("Revoked person")).toBeVisible();
    await act(async () => {
      if (operation === "reset") await client.resetQueries({ queryKey: key });
      else client.removeQueries({ queryKey: key });
    });
    expect(screen.queryByText("Revoked person")).not.toBeInTheDocument();
    rerender(<View data={data} isPlaceholderData isFetching />);
    expect(screen.queryByText("Revoked person")).not.toBeInTheDocument();
    rerender(<View error={new Error("Disconnected")} />);
    expect(screen.queryByText("Revoked person")).not.toBeInTheDocument();
    rerender(<View data={[{ id: "2", name: "Authorized person" }]} />);
    expect(screen.getByText("Authorized person")).toBeVisible();
    unmount();
  }
});

it("does not restore the same placeholder array after a denied refetch", () => {
  const data = [{ id: "secret", name: "Private person" }];
  const { rerender } = render(<View data={data} />);
  rerender(
    <View
      data={data}
      error={Object.assign(new Error("Forbidden"), { status: 403 })}
    />,
  );
  rerender(<View data={data} isPlaceholderData isFetching />);
  expect(screen.queryByText("Private person")).not.toBeInTheDocument();
});

it("accepts an authoritative refetch after denied access even when structural sharing reuses an array", async () => {
  client = new QueryClient();
  const data = [{ id: "1", name: "Restored person" }];
  const key = ["people", "getList", {}];
  client.setQueryData(key, { data, total: 1 });
  const { rerender } = render(<View data={data} />);
  rerender(
    <View
      data={data}
      error={Object.assign(new Error("Forbidden"), { status: 403 })}
    />,
  );
  rerender(<View data={data} isPlaceholderData isFetching />);
  await act(async () => {
    await client.fetchQuery({
      queryKey: key,
      queryFn: async () => ({ data, total: 1 }),
    });
  });
  rerender(<View data={data} />);
  expect(screen.getByText("Restored person")).toBeVisible();
});
