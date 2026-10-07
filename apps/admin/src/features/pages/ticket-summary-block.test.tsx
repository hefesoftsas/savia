import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ApiClient } from "@/api/api-client";
import {
  TicketSummaryBlock,
  buildTicketSnapshotBlocks,
} from "./ticket-summary-block";

afterEach(cleanup);

function makeApi(fetcher: typeof fetch) {
  return new ApiClient({
    baseUrl: "https://savia.test",
    tokenSource: { getAccessToken: async () => "reader-token" },
    fetcher,
  });
}

const summary = {
  updatedAt: "2026-06-03T12:00:00.000Z",
  tickets: [
    {
      key: "OPS-41",
      title: "Restore the release pipeline",
      url: "https://jira.example/browse/OPS-41",
      status: "In Code Review",
      comments: {
        total: 3,
        latest: {
          author: "Rosa",
          body: "Ready for another look",
          createdAt: "2026-06-03T11:00:00.000Z",
          url: "https://jira.example/browse/OPS-41?focusedCommentId=1",
        },
      },
      pullRequests: [
        {
          url: "https://github.com/acme/platform/pull/42",
          title: "Fix release pipeline",
          state: "open" as const,
          reviewDecision: "review_required" as const,
          comments: {
            total: 2,
            latest: {
              author: "Kai",
              body: "Please add a test",
              createdAt: "2026-06-03T10:00:00.000Z",
              url: "https://github.com/acme/platform/pull/42#issuecomment-2",
            },
          },
          unresolvedThreads: 1,
          available: true,
        },
      ],
      prLookup: "complete" as const,
    },
  ],
  partial: false,
  warnings: [],
};

it("loads reader-scoped ticket details and refreshes on demand without saving response data", async () => {
  const fetcher = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ data: summary }),
  );
  const onConfigChange = vi.fn();
  const api = makeApi(fetcher);
  render(
    <TicketSummaryBlock api={api} connected onConfigChange={onConfigChange} />,
  );
  expect(
    await screen.findByRole("link", {
      name: /OPS-41.*Restore the release pipeline/,
    }),
  ).toHaveAttribute("href", "https://jira.example/browse/OPS-41");
  expect(screen.getAllByText("In Code Review")).toHaveLength(3);
  expect(screen.getByRole("link", { name: "Rosa" })).toBeInTheDocument();
  expect(screen.getByText("Ready for another look")).toBeInTheDocument();
  expect(screen.getByText(/1 unresolved thread/)).toBeInTheDocument();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]?.[0]).toContain(
    "/v1/personal-integrations/ticket-summary",
  );
  expect(fetcher.mock.calls[0]?.[0]).not.toContain("refresh=true");
  expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: "POST" });
  await fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  expect(fetcher.mock.calls[1]?.[0]).toContain(
    "/v1/personal-integrations/ticket-summary?refresh=true",
  );
});

it("keeps the saved summary and timestamp visible while refresh fails", async () => {
  let rejectRefresh!: (response: Response) => void;
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ data: summary }))
    .mockImplementationOnce(
      () => new Promise<Response>((done) => (rejectRefresh = done)),
    );
  render(
    <TicketSummaryBlock
      api={makeApi(fetcher)}
      connected
      onConfigChange={() => {}}
    />,
  );
  expect(
    await screen.findByRole("link", {
      name: /OPS-41.*Restore the release pipeline/,
    }),
  ).toBeInTheDocument();
  const updatedTime = screen.getByText(/Updated:/).querySelector("time");
  expect(updatedTime).toHaveAttribute("datetime", summary.updatedAt);

  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  expect(screen.getByRole("status")).toHaveTextContent("Loading tickets");
  expect(
    screen.getByRole("link", {
      name: /OPS-41.*Restore the release pipeline/,
    }),
  ).toBeInTheDocument();
  expect(screen.getByText(/Updated:/).querySelector("time")).toHaveAttribute(
    "datetime",
    summary.updatedAt,
  );

  await act(async () =>
    rejectRefresh(
      Response.json(
        { error: { message: "Provider unavailable" } },
        { status: 503 },
      ),
    ),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not refresh tickets. Showing the last saved summary.",
  );
  expect(
    screen.getByRole("link", {
      name: /OPS-41.*Restore the release pipeline/,
    }),
  ).toBeInTheDocument();
  expect(screen.getByText(/Updated:/).querySelector("time")).toHaveAttribute(
    "datetime",
    summary.updatedAt,
  );
});

it("does not fetch when Jira is disconnected and offers a connect link", () => {
  const fetcher = vi.fn();
  render(
    <TicketSummaryBlock
      api={makeApi(fetcher)}
      connected={false}
      onConfigChange={() => {}}
    />,
  );
  expect(screen.getByRole("link", { name: /Connect Jira/ })).toHaveAttribute(
    "href",
    "/#/my-integrations?tab=connections",
  );
  expect(fetcher).not.toHaveBeenCalled();
});

it("applies config changes through the editor callback and supports reset", async () => {
  const onConfigChange = vi.fn();
  render(
    <TicketSummaryBlock
      api={makeApi(vi.fn(async () => Response.json({ data: summary })))}
      connected
      onConfigChange={onConfigChange}
    />,
  );
  fireEvent.click(screen.getByText("Configure summary"));
  fireEvent.change(screen.getByRole("textbox", { name: "Jira project key" }), {
    target: { value: "OPS" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Statuses" }), {
    target: { value: "Review, Ready for QA" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  expect(onConfigChange).toHaveBeenCalledWith({
    project: "OPS",
    statuses: ["Review", "Ready for QA"],
  });
  fireEvent.click(screen.getByRole("button", { name: "Reset" }));
  expect(onConfigChange).toHaveBeenLastCalledWith({});
});

it("clears reader data immediately on identity or session changes and ignores stale responses", async () => {
  let resolve!: (response: Response) => void;
  const fetcher = vi.fn(
    () =>
      new Promise<Response>((done) => {
        resolve = done;
      }),
  );
  render(
    <TicketSummaryBlock
      api={makeApi(fetcher)}
      connected
      onConfigChange={() => {}}
    />,
  );
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  act(() => window.dispatchEvent(new Event("savia:identity-changed")));
  expect(
    screen.queryByRole("link", {
      name: /OPS-41.*Restore the release pipeline/,
    }),
  ).not.toBeInTheDocument();
  await act(async () => resolve(Response.json({ data: summary })));
  expect(
    screen.queryByRole("link", {
      name: /OPS-41.*Restore the release pipeline/,
    }),
  ).not.toBeInTheDocument();
  act(() => window.dispatchEvent(new Event("savia:session-cleared")));
  expect(
    screen.queryByRole("link", { name: /OPS-41/ }),
  ).not.toBeInTheDocument();
});

it("does not carry a queued refresh across disconnect and reconnect", async () => {
  const fetcher = vi.fn(async (_input: RequestInfo | URL) =>
    Response.json({ data: summary }),
  );
  const api = makeApi(fetcher);
  const onConfigChange = vi.fn();
  const { rerender } = render(
    <TicketSummaryBlock api={api} connected onConfigChange={onConfigChange} />,
  );
  await screen.findByRole("link", { name: /OPS-41/ });

  act(() => {
    screen
      .getByRole("button", { name: "Refresh" })
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    rerender(
      <TicketSummaryBlock
        api={api}
        connected={false}
        onConfigChange={onConfigChange}
      />,
    );
  });
  rerender(
    <TicketSummaryBlock api={api} connected onConfigChange={onConfigChange} />,
  );

  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  expect(fetcher.mock.calls[1]?.[0]).not.toContain("refresh=true");
});

it("does not carry a queued refresh across reader identity invalidation", async () => {
  const fetcher = vi.fn(async (_input: RequestInfo | URL) =>
    Response.json({ data: summary }),
  );
  const api = makeApi(fetcher);
  const onConfigChange = vi.fn();
  const { rerender } = render(
    <TicketSummaryBlock api={api} connected onConfigChange={onConfigChange} />,
  );
  await screen.findByRole("link", { name: /OPS-41/ });

  act(() => {
    screen
      .getByRole("button", { name: "Refresh" })
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    window.dispatchEvent(new Event("savia:identity-changed"));
  });
  rerender(
    <TicketSummaryBlock
      api={api}
      connected={false}
      onConfigChange={onConfigChange}
    />,
  );
  rerender(
    <TicketSummaryBlock api={api} connected onConfigChange={onConfigChange} />,
  );

  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  expect(fetcher.mock.calls[1]?.[0]).not.toContain("refresh=true");
});

it("does not render an earlier configuration response after config changes", async () => {
  let resolveFirst!: (response: Response) => void;
  const fetcher = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<Response>((done) => {
          resolveFirst = done;
        }),
    )
    .mockImplementation(async () =>
      Response.json({
        data: {
          ...summary,
          tickets: [
            {
              ...summary.tickets[0],
              key: "OPS-99",
              title: "New config result",
            },
          ],
        },
      }),
    );
  const api = makeApi(fetcher);
  const { rerender } = render(
    <TicketSummaryBlock
      api={api}
      connected
      config={{ project: "OLD" }}
      onConfigChange={() => {}}
    />,
  );
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  rerender(
    <TicketSummaryBlock
      api={api}
      connected
      config={{ project: "NEW" }}
      onConfigChange={() => {}}
    />,
  );
  expect(
    await screen.findByText(/OPS-99.*New config result/),
  ).toBeInTheDocument();
  await act(async () => resolveFirst(Response.json({ data: summary })));
  expect(
    screen.queryByText(/OPS-41.*Restore the release pipeline/),
  ).not.toBeInTheDocument();
});

it("rejects an invalid project key or empty statuses before saving config", () => {
  const onConfigChange = vi.fn();
  render(
    <TicketSummaryBlock
      api={makeApi(vi.fn(async () => Response.json({ data: summary })))}
      connected
      onConfigChange={onConfigChange}
    />,
  );
  fireEvent.click(screen.getByText("Configure summary"));
  fireEvent.change(screen.getByRole("textbox", { name: "Jira project key" }), {
    target: { value: "bad key" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Statuses" }), {
    target: { value: " , " },
  });
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Check the project key and add at least one status.",
  );
  expect(onConfigChange).not.toHaveBeenCalled();
});

it.each(["savia:identity-changed", "savia:session-cleared"])(
  "clears an already rendered personal summary on %s",
  async (eventName) => {
    render(
      <TicketSummaryBlock
        api={makeApi(vi.fn(async () => Response.json({ data: summary })))}
        connected
        onConfigChange={() => {}}
      />,
    );
    expect(
      await screen.findByRole("link", {
        name: /OPS-41.*Restore the release pipeline/,
      }),
    ).toBeInTheDocument();
    act(() => window.dispatchEvent(new Event(eventName)));
    expect(
      screen.queryByRole("link", { name: /OPS-41/ }),
    ).not.toBeInTheDocument();
  },
);

it("lets readers refresh without changing shared filters", async () => {
  const fetcher = vi.fn(async () => Response.json({ data: summary }));
  const changed = vi.fn();
  render(
    <TicketSummaryBlock
      api={makeApi(fetcher)}
      connected
      readOnly
      onConfigChange={changed}
    />,
  );
  await screen.findByRole("link", { name: /OPS-41/ });
  expect(screen.queryByText("Configure summary")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  expect(changed).not.toHaveBeenCalled();
});

it("offers an editable snapshot copy without persisting provider data", async () => {
  const onInsertSnapshot = vi.fn();
  render(
    <TicketSummaryBlock
      api={makeApi(vi.fn(async () => Response.json({ data: summary })))}
      connected
      onConfigChange={() => {}}
      onInsertSnapshot={onInsertSnapshot}
    />,
  );
  const action = await screen.findByRole("button", {
    name: "Insert snapshot as editable blocks",
  });
  expect(
    screen.getByText(
      /This copy is saved in the page and follows its sharing permissions/,
    ),
  ).toBeInTheDocument();
  fireEvent.click(action);
  expect(onInsertSnapshot).toHaveBeenCalledTimes(1);
  const blocks = onInsertSnapshot.mock.calls[0]?.[0] as Array<
    Record<string, unknown>
  >;
  expect(blocks[0]).toMatchObject({ type: "p" });
  const bullet = blocks.find((block) => block.type === "bullet") as {
    children: Array<Record<string, unknown>>;
  };
  expect(bullet).toBeDefined();
  const link = bullet.children.find((child) => child.type === "a") as Record<
    string,
    unknown
  >;
  expect(link.url).toBe("https://jira.example/browse/OPS-41");
  expect(JSON.stringify(blocks)).not.toContain("encrypted");
});

it("hides the snapshot copy in read-only mode", async () => {
  render(
    <TicketSummaryBlock
      api={makeApi(vi.fn(async () => Response.json({ data: summary })))}
      connected
      readOnly
      onConfigChange={() => {}}
      onInsertSnapshot={() => {}}
    />,
  );
  await screen.findByRole("link", { name: /OPS-41/ });
  expect(
    screen.queryByRole("button", {
      name: "Insert snapshot as editable blocks",
    }),
  ).not.toBeInTheDocument();
});

it("builds snapshot blocks with safe links only", () => {
  const blocks = buildTicketSnapshotBlocks(
    {
      ...summary,
      tickets: [
        {
          ...summary.tickets[0],
          url: "javascript:alert(1)",
          pullRequests: [],
        },
      ],
    } as never,
    "header",
  );
  expect(JSON.stringify(blocks)).not.toContain("javascript:");
  expect(
    blocks.some(
      (block) =>
        Array.isArray(block.children) &&
        (block.children as Array<Record<string, unknown>>).some(
          (child) => child.type === "a",
        ),
    ),
  ).toBe(false);
});
