import {
  act,
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { PageEditor } from "./editor";
import { PagesClient } from "./client";
import { ApiClient } from "@/api/api-client";
import { IssueCard } from "./issue-card";
const api = new ApiClient({
  baseUrl: "https://savia.test",
  tokenSource: { getAccessToken: async () => null },
  fetcher: async () => Response.json({ error: {} }, { status: 403 }),
});
afterEach(cleanup);
it("pastes a connected Linear issue as a live preview without storing fetched metadata", async () => {
  const changed = vi.fn();
  const previewApi = new ApiClient({
    baseUrl: "https://savia.test",
    tokenSource: { getAccessToken: async () => null },
    fetcher: async () =>
      Response.json({
        data: {
          title: "Live issue title",
          identifier: "ENG-12",
          status: "Todo",
          assignee: null,
        },
      }),
  });
  render(
    <PageEditor
      pageId="one"
      api={previewApi}
      pages={new PagesClient(previewApi)}
      readOnly={false}
      initialValue={[{ type: "p", children: [{ text: "" }] }]}
      issueProviders={["linear"]}
      onChange={changed}
    />,
  );
  fireEvent.paste(screen.getByRole("textbox", { name: "Page content" }), {
    clipboardData: {
      getData: () => "https://linear.app/acme/issue/ENG-12/a-task",
    },
  });
  expect(
    await screen.findByRole("link", { name: "Live issue title" }),
  ).toHaveAttribute("href", "https://linear.app/acme/issue/ENG-12/a-task");
  expect(screen.getByText("Todo")).toBeInTheDocument();
  await waitFor(() => expect(changed).toHaveBeenCalled());
  expect(JSON.stringify(changed.mock.calls)).not.toContain("Live issue title");
});
it("pastes a connected GitHub pull request as a live preview", async () => {
  const changed = vi.fn();
  const previewApi = new ApiClient({
    baseUrl: "https://savia.test",
    tokenSource: { getAccessToken: async () => null },
    fetcher: async () =>
      Response.json({
        data: {
          title: "Support GitHub issues",
          identifier: "acme/savia#42",
          repository: "acme/savia",
          kind: "pull_request",
          status: "merged",
          assignee: "Alex Rivera",
        },
      }),
  });
  render(
    <PageEditor
      pageId="one"
      api={previewApi}
      pages={new PagesClient(previewApi)}
      readOnly={false}
      initialValue={[{ type: "p", children: [{ text: "" }] }]}
      issueProviders={["github"]}
      onChange={changed}
    />,
  );
  fireEvent.paste(screen.getByRole("textbox", { name: "Page content" }), {
    clipboardData: {
      getData: () => "https://github.com/acme/savia/pull/42",
    },
  });
  expect(
    await screen.findByRole("link", { name: "Support GitHub issues" }),
  ).toHaveAttribute("href", "https://github.com/acme/savia/pull/42");
  expect(screen.getByText("acme/savia")).toBeInTheDocument();
  expect(screen.getByText("#42")).toBeInTheDocument();
  expect(screen.getByText("merged")).toBeInTheDocument();
  expect(screen.getByText("Alex Rivera")).toBeInTheDocument();
  await waitFor(() => expect(changed).toHaveBeenCalled());
  expect(JSON.stringify(changed.mock.calls)).not.toContain(
    "Support GitHub issues",
  );
});
it.each([
  [
    "https://aihefesoft.atlassian.net/browse/KAN-2",
    "Jira",
    "En curso",
    "Alex Rivera",
  ],
  [
    "https://linear.app/acme/issue/ENG-12/a-task",
    "Linear",
    "In Progress",
    null,
  ],
])(
  "shows live status and assignment for %s",
  async (url, provider, status, assignee) => {
    const previewApi = new ApiClient({
      baseUrl: "https://savia.test",
      tokenSource: { getAccessToken: async () => null },
      fetcher: async () =>
        Response.json({
          data: {
            title: "Work in progress",
            identifier: "ENG-12",
            status,
            assignee,
          },
        }),
    });
    render(<IssueCard url={url} api={previewApi} />);
    expect(await screen.findByText(status)).toBeInTheDocument();
    expect(screen.getByText(assignee ?? "Unassigned")).toBeInTheDocument();
    expect(screen.getByText("Assigned to")).toBeInTheDocument();
    expect(
      screen.getByText(provider, { selector: "span" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Work in progress" }),
    ).toHaveAttribute("href", url);
  },
);
it("keeps the upload pending signal until the request settles, including a failed upload", async () => {
  let finish!: (response: Response) => void;
  const response = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  const uploadApi = new ApiClient({
    baseUrl: "https://savia.test",
    tokenSource: { getAccessToken: async () => null },
    fetcher: async () => response,
  });
  const pending = vi.fn();
  const { container } = render(
    <PageEditor
      pageId="one"
      api={uploadApi}
      pages={new PagesClient(uploadApi)}
      readOnly={false}
      initialValue={[]}
      onChange={() => {}}
      onPendingUpload={pending}
    />,
  );
  fireEvent.change(container.querySelector('input[type="file"]')!, {
    target: { files: [new File(["note"], "note.txt", { type: "text/plain" })] },
  });
  await waitFor(() => expect(pending).toHaveBeenLastCalledWith(true));
  finish(Response.json({ error: { code: "UNAVAILABLE" } }, { status: 503 }));
  await waitFor(() => expect(pending).toHaveBeenLastCalledWith(false));
  expect(screen.getByRole("alert")).toHaveTextContent("Could not load");
});
it("keeps original issue links usable when the reader cannot resolve a preview", async () => {
  render(
    <IssueCard url="https://linear.app/acme/issue/ENG-12/a-task" api={api} />,
  );
  await screen.findByText(/Preview unavailable/);
  expect(screen.getByRole("link", { name: "ENG-12" })).toHaveAttribute(
    "href",
    "https://linear.app/acme/issue/ENG-12/a-task",
  );
  expect(screen.queryByText("Secret title")).not.toBeInTheDocument();
});
it("renders stored hyperlinks as real clickable links and hides editing actions for readers", () => {
  render(
    <PageEditor
      pageId="one"
      api={api}
      pages={new PagesClient(api)}
      readOnly
      initialValue={[
        {
          type: "p",
          children: [
            { text: "See " },
            {
              type: "a",
              url: "https://example.com",
              children: [{ text: "reference" }],
            },
          ],
        },
      ]}
      onChange={() => {}}
    />,
  );
  expect(screen.getByRole("link", { name: "reference" })).toHaveAttribute(
    "href",
    "https://example.com",
  );
  expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
});
it("pastes a URL as a hyperlink rather than plain text", async () => {
  const changed = vi.fn();
  render(
    <PageEditor
      pageId="one"
      api={api}
      pages={new PagesClient(api)}
      readOnly={false}
      initialValue={[{ type: "p", children: [{ text: "" }] }]}
      onChange={changed}
    />,
  );
  const editable = screen.getByRole("textbox", { name: "Page content" });
  editable.focus();
  fireEvent.paste(editable, {
    clipboardData: {
      getData: (type: string) =>
        type === "text/plain" ? "https://example.com/reference" : "",
      types: ["text/plain"],
      files: [],
      items: [],
    },
  });
  await waitFor(() =>
    expect(
      screen.getByRole("link", { name: "https://example.com/reference" }),
    ).toHaveAttribute("href", "https://example.com/reference"),
  );
});

it("closes the slash menu after selecting a heading and returns focus for typing", async () => {
  const user = userEvent.setup();
  render(
    <PageEditor
      pageId="one"
      api={api}
      pages={new PagesClient(api)}
      readOnly={false}
      initialValue={[{ type: "p", children: [{ text: "" }] }]}
      onChange={() => {}}
    />,
  );
  const editable = screen.getByRole("textbox", { name: "Page content" });
  await user.click(editable);
  const emptyText = editable.querySelector(
    "[data-slate-zero-width]",
  )?.firstChild;
  if (!emptyText) throw new Error("Expected an empty editor text node");
  const caret = document.createRange();
  caret.setStart(emptyText, 0);
  caret.collapse(true);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(caret);
  fireEvent(document, new Event("selectionchange"));
  await user.keyboard("/");
  const heading = await screen.findByRole("option", { name: "Title 2" });
  expect(
    screen.getByRole("textbox", { name: "Search blocks and inserts…" }),
  ).toHaveFocus();
  await user.click(heading);
  await waitFor(() =>
    expect(
      screen.queryByRole("option", { name: "Title 2" }),
    ).not.toBeInTheDocument(),
  );
  await waitFor(() => expect(editable).toHaveFocus());
  await user.type(editable, "Hello");
  await waitFor(() => expect(editable).toHaveTextContent("Hello"));
});

it("returns focus to the editor when Escape closes the slash menu", async () => {
  render(
    <PageEditor
      pageId="one"
      api={api}
      pages={new PagesClient(api)}
      readOnly={false}
      initialValue={[{ type: "p", children: [{ text: "" }] }]}
      onChange={() => {}}
    />,
  );
  const editable = screen.getByRole("textbox", { name: "Page content" });
  editable.focus();
  fireEvent.keyDown(editable, { key: "/" });
  const heading = await screen.findByRole("option", { name: "Title 2" });
  fireEvent.keyDown(heading, { key: "Escape" });
  await waitFor(() =>
    expect(
      screen.queryByRole("option", { name: "Title 2" }),
    ).not.toBeInTheDocument(),
  );
  await waitFor(() => expect(editable).toHaveFocus());
});

it("anchors the first slash menu to its block when the DOM range reports zero bounds", async () => {
  const user = userEvent.setup();
  const { container } = render(
    <PageEditor
      pageId="one"
      api={api}
      pages={new PagesClient(api)}
      readOnly={false}
      initialValue={[{ type: "p", children: [{ text: "" }] }]}
      onChange={() => {}}
    />,
  );
  const editable = screen.getByRole("textbox", { name: "Page content" });
  const block = editable.querySelector("p")!;
  const rect = (left: number, top: number, width: number, height: number) =>
    ({
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
      x: left,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect;
  vi.spyOn(block, "getBoundingClientRect").mockReturnValue(
    rect(37, 119, 240, 20),
  );
  const rangeDescriptor = Object.getOwnPropertyDescriptor(
    Range.prototype,
    "getBoundingClientRect",
  );
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => rect(0, 0, 0, 0),
  });
  try {
    await user.click(editable);
    await user.keyboard("/");
    await screen.findByRole("textbox", { name: "Search blocks and inserts…" });
    const anchor = container.querySelector<HTMLElement>(
      ".page-editor-slash-anchor",
    )!;
    expect(anchor.style.left).toBe("37px");
    expect(anchor.style.top).toBe("139px");
  } finally {
    if (rangeDescriptor)
      Object.defineProperty(
        Range.prototype,
        "getBoundingClientRect",
        rangeDescriptor,
      );
    else Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
  }
});

it.each([
  {
    contentTop: 100,
    selectionTop: 108,
    selectionBottom: 128,
    expectedTop: -36,
  },
  { contentTop: 10, selectionTop: 12, selectionBottom: 32, expectedTop: 30 },
  { contentTop: 10, selectionTop: 12, selectionBottom: 1000, expectedTop: 714 },
])(
  "keeps formatting tools visible for selection bounds $selectionTop–$selectionBottom",
  async ({ contentTop, selectionTop, selectionBottom, expectedTop }) => {
    const { container } = render(
      <PageEditor
        pageId="one"
        api={api}
        pages={new PagesClient(api)}
        readOnly={false}
        initialValue={[{ type: "p", children: [{ text: "Select this text" }] }]}
        onChange={() => {}}
      />,
    );
    const content = container.querySelector<HTMLElement>(
      ".page-editor-content",
    )!;
    vi.spyOn(content.parentElement!, "getBoundingClientRect").mockReturnValue({
      left: 100,
      top: contentTop,
    } as DOMRect);
    act(() => screen.getByRole("textbox", { name: "Page content" }).focus());
    const text = screen.getByText("Select this text").firstChild!;
    Object.defineProperty(text.parentElement!, "isContentEditable", {
      value: true,
      configurable: true,
    });
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 6);
    Object.defineProperty(range, "getBoundingClientRect", {
      value: () => ({
        left: 100,
        width: 60,
        top: selectionTop,
        bottom: selectionBottom,
      }),
    });
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    fireEvent.mouseMove(text.parentElement!);
    fireEvent(document, new Event("selectionchange"));
    const toolbar = await screen.findByRole("toolbar", { name: "Formatting" });
    expect(toolbar.style.top).toBe(`${expectedTop}px`);
    expect(
      screen.queryByRole("toolbar", { name: "Block actions" }),
    ).not.toBeInTheDocument();
  },
);

it("preserves the selected text range when applying compact formatting tools", async () => {
  const changed = vi.fn();
  const { container } = render(
    <PageEditor
      pageId="one"
      api={api}
      pages={new PagesClient(api)}
      readOnly={false}
      initialValue={[
        { type: "p", children: [{ text: "Keep this selection" }] },
      ]}
      onChange={changed}
    />,
  );
  act(() => screen.getByRole("textbox", { name: "Page content" }).focus());
  const walker = document.createTreeWalker(
    container.querySelector(".page-editor-content")!,
    NodeFilter.SHOW_TEXT,
  );
  let text = walker.nextNode();
  while (text && text.textContent !== "Keep this selection")
    text = walker.nextNode();
  expect(text).toBeDefined();
  // jsdom omits isContentEditable, which Slate uses to accept native selections.
  Object.defineProperty(text!.parentElement!, "isContentEditable", {
    value: true,
    configurable: true,
  });
  const range = document.createRange();
  range.setStart(text!, 5);
  range.setEnd(text!, 9);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  fireEvent(document, new Event("selectionchange"));
  const bold = await screen.findByRole("button", { name: "Bold" });
  fireEvent.mouseDown(bold);
  expect(window.getSelection()?.toString()).toBe("this");
  expect(changed).not.toHaveBeenCalled();
});

it("filters insert commands and exposes issue commands only for connected providers", async () => {
  const user = userEvent.setup();
  const renderEditor = (issueProviders?: Array<"jira" | "linear" | "github">) =>
    render(
      <PageEditor
        pageId="one"
        api={api}
        pages={new PagesClient(api)}
        readOnly={false}
        initialValue={[{ type: "p", children: [{ text: "" }] }]}
        onChange={() => {}}
        issueProviders={issueProviders}
      />,
    );
  const firstRender = renderEditor();
  const editable = screen.getByRole("textbox", { name: "Page content" });
  await user.click(editable);
  fireEvent.keyDown(editable, { key: "/" });
  const search = await screen.findByRole("textbox", {
    name: "Search blocks and inserts…",
  });
  expect(
    screen.queryByRole("button", { name: "Jira issue" }),
  ).not.toBeInTheDocument();
  await user.type(search, "titulo");
  expect(screen.getByRole("option", { name: "Title 2" })).toBeInTheDocument();
  await user.clear(search);
  await user.type(search, "list");
  expect(screen.getByRole("option", { name: "List" })).toBeInTheDocument();
  expect(
    screen.queryByRole("option", { name: "Collection" }),
  ).not.toBeInTheDocument();
  firstRender.unmount();

  const linearRender = renderEditor(["linear"]);
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Page content" }), {
    key: "/",
  });
  expect(
    await screen.findByRole("option", { name: "Linear issue" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("option", { name: "Jira issue" }),
  ).not.toBeInTheDocument();
  linearRender.unmount();

  renderEditor(["github"]);
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Page content" }), {
    key: "/",
  });
  expect(
    await screen.findByRole("option", { name: "GitHub issue or pull request" }),
  ).toBeInTheDocument();
});

it("supports keyboard navigation and selection in the command picker", async () => {
  const user = userEvent.setup();
  render(
    <PageEditor
      pageId="one"
      api={api}
      pages={new PagesClient(api)}
      readOnly={false}
      initialValue={[{ type: "p", children: [{ text: "" }] }]}
      onChange={() => {}}
    />,
  );
  const editable = screen.getByRole("textbox", { name: "Page content" });
  await user.click(editable);
  await user.keyboard("/");
  const search = await screen.findByRole("textbox", {
    name: "Search blocks and inserts…",
  });
  await user.type(search, "quote");
  await user.keyboard("{ArrowDown}");
  const quote = screen.getByRole("option", { name: "Quote" });
  expect(quote).toHaveFocus();
  await user.keyboard("{Enter}");
  await waitFor(() =>
    expect(
      screen.queryByRole("option", { name: "Quote" }),
    ).not.toBeInTheDocument(),
  );
  expect(editable.querySelector("blockquote")).toBeInTheDocument();
});

it("renders disconnected issue elements as original links without preview requests", () => {
  render(
    <PageEditor
      pageId="one"
      api={api}
      pages={new PagesClient(api)}
      readOnly
      initialValue={[
        {
          type: "issue",
          url: "https://linear.app/acme/issue/ENG-12/a-task",
          children: [{ text: "" }],
        },
      ]}
      onChange={() => {}}
    />,
  );
  expect(screen.getByRole("link", { name: "ENG-12" })).toHaveAttribute(
    "href",
    "https://linear.app/acme/issue/ENG-12/a-task",
  );
  expect(screen.queryByText(/Preview unavailable/)).not.toBeInTheDocument();
});

it("keeps a disconnected GitHub issue as a public link without requesting a preview", () => {
  render(
    <PageEditor
      pageId="one"
      api={api}
      pages={new PagesClient(api)}
      readOnly
      initialValue={[
        {
          type: "issue",
          url: "https://github.com/acme/savia/issues/42",
          children: [{ text: "" }],
        },
      ]}
      onChange={() => {}}
    />,
  );
  expect(screen.getByRole("link", { name: "acme/savia#42" })).toHaveAttribute(
    "href",
    "https://github.com/acme/savia/issues/42",
  );
  expect(screen.queryByText(/Preview unavailable/)).not.toBeInTheDocument();
});

it("keeps issue insertion scoped to the connected provider", async () => {
  const user = userEvent.setup();
  const changed = vi.fn();
  render(
    <PageEditor
      pageId="one"
      api={api}
      pages={new PagesClient(api)}
      readOnly={false}
      initialValue={[{ type: "p", children: [{ text: "" }] }]}
      onChange={changed}
      issueProviders={["jira"]}
    />,
  );
  await user.click(screen.getByRole("textbox", { name: "Page content" }));
  await user.keyboard("/");
  await user.click(await screen.findByRole("option", { name: "Jira issue" }));
  expect(
    await screen.findByText(
      "Paste a link to an issue from a connected Jira site.",
    ),
  ).toBeInTheDocument();
  await user.type(
    screen.getByRole("textbox", { name: "Link" }),
    "https://linear.app/acme/issue/ENG-12/a-task",
  );
  await user.click(screen.getByRole("button", { name: "Insert" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Enter a valid Jira Cloud, Linear, or GitHub HTTPS link.",
  );
  expect(changed).not.toHaveBeenCalled();
  await user.keyboard("{Escape}");
  await waitFor(() =>
    expect(screen.getByRole("textbox", { name: "Page content" })).toHaveFocus(),
  );
});

it("inserts an editable code block, preserves multiline paste, and changes its language", async () => {
  const user = userEvent.setup();
  const changed = vi.fn();
  render(
    <PageEditor
      pageId="one"
      api={api}
      pages={new PagesClient(api)}
      readOnly={false}
      initialValue={[{ type: "p", children: [{ text: "" }] }]}
      onChange={changed}
    />,
  );
  const editable = screen.getByRole("textbox", { name: "Page content" });
  await user.click(editable);
  await user.keyboard("/");
  await user.click(await screen.findByRole("option", { name: "Code" }));
  const language = await screen.findByRole("combobox", {
    name: "Code language",
  });
  await user.selectOptions(language, "typescript");
  const code = document.querySelector(".page-code-block code")!;
  fireEvent.paste(code, {
    clipboardData: {
      getData: (type: string) =>
        type === "text/plain" ? "const first = 1;\n  const second = 2;" : "",
      types: ["text/plain"],
      files: [],
      items: [],
    },
  });
  await waitFor(() =>
    expect(code.textContent).toBe("const first = 1;\n  const second = 2;"),
  );
  const value = changed.mock.calls.at(-1)?.[0] as Array<{
    type: string;
    language?: string;
    children: Array<{ text?: string }>;
  }>;
  expect(value[0]).toMatchObject({
    type: "code_block",
    language: "typescript",
  });
  expect(value[0].children.map((child) => child.text ?? "").join("")).toBe(
    "const first = 1;\n  const second = 2;",
  );
  expect(value[1].type).toBe("p");
});

it("updates todo state and keeps its checkbox disabled for readers", async () => {
  const changed = vi.fn();
  const initialValue = [
    { type: "todo", checked: false, children: [{ text: "Ship the page" }] },
  ];
  const { rerender } = render(
    <PageEditor
      pageId="one"
      api={api}
      pages={new PagesClient(api)}
      readOnly={false}
      initialValue={initialValue}
      onChange={changed}
    />,
  );
  const checkbox = screen.getByRole("checkbox", { name: "Mark task complete" });
  await userEvent.click(checkbox);
  await waitFor(() =>
    expect(changed.mock.calls.at(-1)?.[0][0]).toMatchObject({
      type: "todo",
      checked: true,
    }),
  );
  rerender(
    <PageEditor
      pageId="one"
      api={api}
      pages={new PagesClient(api)}
      readOnly
      initialValue={initialValue}
      onChange={changed}
    />,
  );
  expect(
    screen.getByRole("checkbox", { name: "Mark task complete" }),
  ).toBeDisabled();
});

it("adds rows and columns while keeping the table rectangular", async () => {
  const user = userEvent.setup();
  const changed = vi.fn();
  render(
    <PageEditor
      pageId="one"
      api={api}
      pages={new PagesClient(api)}
      readOnly={false}
      initialValue={[{ type: "p", children: [{ text: "" }] }]}
      onChange={changed}
    />,
  );
  const editable = screen.getByRole("textbox", { name: "Page content" });
  await user.click(editable);
  await user.keyboard("/");
  await user.click(await screen.findByRole("option", { name: "Table" }));
  const table = document.querySelector(".page-table-block table")!;
  expect(table.querySelectorAll("tr")).toHaveLength(2);
  await user.click(screen.getByRole("button", { name: "Add row" }));
  await user.click(screen.getByRole("button", { name: "Add column" }));
  await waitFor(() => expect(table.querySelectorAll("tr")).toHaveLength(3));
  expect(
    Array.from(table.querySelectorAll("tr")).map(
      (row) => row.querySelectorAll("td").length,
    ),
  ).toEqual([3, 3, 3]);
  const value = changed.mock.calls.at(-1)?.[0] as Array<{
    type: string;
    children: Array<{ children: unknown[] }>;
  }>;
  expect(value[0].type).toBe("table");
  expect(value[0].children).toHaveLength(3);
});

it("reorders whole blocks by dragging and deletes the hovered block", async () => {
  const changed = vi.fn();
  render(
    <PageEditor
      pageId="drag-test"
      api={api}
      pages={new PagesClient(api)}
      readOnly={false}
      initialValue={[
        { type: "p", children: [{ text: "First block" }] },
        { type: "p", children: [{ text: "Second block" }] },
        { type: "p", children: [{ text: "Third block" }] },
      ]}
      onChange={changed}
    />,
  );
  fireEvent.mouseMove(screen.getByText("Third block"));
  const dataTransfer = { setData: vi.fn(), effectAllowed: "", dropEffect: "" };
  fireEvent.dragStart(screen.getByRole("button", { name: "Move block" }), {
    dataTransfer,
  });
  fireEvent.dragOver(screen.getByText("First block"), {
    dataTransfer,
    clientY: -1,
  });
  fireEvent.drop(screen.getByText("First block"), {
    dataTransfer,
    clientY: -1,
  });
  await waitFor(() => expect(changed).toHaveBeenCalled());
  expect(
    changed.mock.lastCall?.[0].map(
      (node: { children: { text: string }[] }) => node.children[0].text,
    ),
  ).toEqual(["Third block", "First block", "Second block"]);
  fireEvent.mouseMove(screen.getByText("Third block"));
  fireEvent.dragStart(screen.getByRole("button", { name: "Move block" }), {
    dataTransfer,
  });
  fireEvent(
    screen.getByText("Second block"),
    Object.assign(new MouseEvent("drop", { bubbles: true, clientY: 1 }), {
      dataTransfer,
    }),
  );
  await waitFor(() =>
    expect(
      changed.mock.lastCall?.[0].map(
        (node: { children: { text: string }[] }) => node.children[0].text,
      ),
    ).toEqual(["First block", "Second block", "Third block"]),
  );
  fireEvent.mouseMove(screen.getByText("First block"));
  fireEvent.click(screen.getByRole("button", { name: "Delete block" }));
  await waitFor(() =>
    expect(screen.queryByText("First block")).not.toBeInTheDocument(),
  );
  expect(screen.getByText("Third block")).toBeInTheDocument();
});

it("keeps a writable paragraph after deleting the last block and hides controls for readers", async () => {
  const { unmount } = render(
    <PageEditor
      pageId="delete-test"
      api={api}
      pages={new PagesClient(api)}
      readOnly={false}
      initialValue={[{ type: "p", children: [{ text: "Only block" }] }]}
      onChange={() => {}}
    />,
  );
  fireEvent.mouseMove(screen.getByText("Only block"));
  fireEvent.click(screen.getByRole("button", { name: "Delete block" }));
  expect(screen.queryByText("Only block")).not.toBeInTheDocument();
  expect(
    screen.getByRole("textbox", { name: "Page content" }).querySelector("p"),
  ).toBeInTheDocument();
  unmount();
  render(
    <PageEditor
      pageId="read-test"
      api={api}
      pages={new PagesClient(api)}
      readOnly
      initialValue={[{ type: "p", children: [{ text: "Read only" }] }]}
      onChange={() => {}}
    />,
  );
  fireEvent.mouseMove(screen.getByText("Read only"));
  expect(
    screen.queryByRole("button", { name: "Delete block" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Move block" }),
  ).not.toBeInTheDocument();
});

it("converts a code fence on Enter and exits code with Control Enter", async () => {
  const user = userEvent.setup();
  const changed = vi.fn();
  render(
    <PageEditor
      pageId="typing-code"
      api={api}
      pages={new PagesClient(api)}
      readOnly={false}
      initialValue={[{ type: "p", children: [{ text: "```ts" }] }]}
      onChange={changed}
    />,
  );
  const editable = screen.getByRole("textbox", { name: "Page content" });
  await user.click(editable);
  const text = screen.getByText("```ts").firstChild!;
  Object.defineProperty(text.parentElement!, "isContentEditable", {
    value: true,
    configurable: true,
  });
  const caret = document.createRange();
  caret.setStart(text, 5);
  caret.collapse(true);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(caret);
  await act(async () => {
    fireEvent(document, new Event("selectionchange"));
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
  fireEvent.keyDown(editable, { key: "Enter" });
  expect(
    await screen.findByRole("combobox", { name: "Code language" }),
  ).toHaveValue("typescript");
  fireEvent.paste(editable, {
    clipboardData: { getData: () => "const x = 1;\n  x++;" },
  });
  await waitFor(() =>
    expect(document.querySelector(".page-code-block code")?.textContent).toBe(
      "const x = 1;\n  x++;",
    ),
  );
  fireEvent.keyDown(editable, { key: "Enter", ctrlKey: true });
  await waitFor(() => expect(changed.mock.lastCall?.[0].at(-1).type).toBe("p"));
});
it("pastes fenced code into a blank paragraph and continues with normal text", async () => {
  render(
    <PageEditor
      pageId="paste-code"
      api={api}
      pages={new PagesClient(api)}
      readOnly={false}
      initialValue={[]}
      onChange={() => {}}
    />,
  );
  fireEvent.paste(screen.getByRole("textbox", { name: "Page content" }), {
    clipboardData: { getData: () => '```python\n  print("hello")\n```' },
  });
  await waitFor(() =>
    expect(document.querySelector(".page-code-block code")?.textContent).toBe(
      '  print("hello")',
    ),
  );
  expect(screen.getByRole("combobox", { name: "Code language" })).toHaveValue(
    "python",
  );
});

it("keeps block actions reachable across pointer gaps and pinned during keyboard focus", async () => {
  render(
    <PageEditor
      pageId="hover-actions"
      api={api}
      pages={new PagesClient(api)}
      readOnly={false}
      initialValue={[
        { type: "p", children: [{ text: "First target" }] },
        { type: "p", children: [{ text: "Neighbor" }] },
      ]}
      onChange={() => {}}
    />,
  );
  vi.useFakeTimers();
  try {
    const shell = document.querySelector(".page-editor-shell")!;
    fireEvent.mouseMove(screen.getByText("First target"));
    fireEvent.mouseLeave(shell);
    act(() => vi.advanceTimersByTime(200));
    const toolbar = screen.getByRole("toolbar", { name: "Block actions" });
    fireEvent.mouseEnter(toolbar);
    act(() => vi.advanceTimersByTime(500));
    expect(toolbar).toBeInTheDocument();
    const remove = screen.getByRole("button", { name: "Delete block" });
    act(() => remove.focus());
    fireEvent.mouseLeave(shell);
    act(() => vi.advanceTimersByTime(500));
    fireEvent.mouseMove(screen.getByText("Neighbor"));
    vi.useRealTimers();
    fireEvent.click(remove);
    expect(screen.queryByText("First target")).not.toBeInTheDocument();
    expect(screen.getByText("Neighbor")).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole("textbox", { name: "Page content" }),
      ).toHaveFocus(),
    );
    fireEvent.mouseMove(screen.getByText("Neighbor"));
    fireEvent.mouseLeave(shell);
    await waitFor(() =>
      expect(
        screen.queryByRole("toolbar", { name: "Block actions" }),
      ).not.toBeInTheDocument(),
    );
  } finally {
    vi.useRealTimers();
  }
});

it("inserts editable paragraphs between blocks and returns keyboard focus", async () => {
  const changed = vi.fn();
  render(
    <PageEditor
      pageId="between"
      api={api}
      pages={new PagesClient(api)}
      readOnly={false}
      initialValue={[
        { type: "p", children: [{ text: "Before" }] },
        { type: "p", children: [{ text: "After" }] },
      ]}
      onChange={changed}
    />,
  );
  fireEvent.mouseMove(screen.getByText("Before"));
  fireEvent.click(screen.getByRole("button", { name: "Write below" }));
  await waitFor(() =>
    expect(screen.getByRole("textbox", { name: "Page content" })).toHaveFocus(),
  );
  expect(
    changed.mock.lastCall?.[0].map(
      (node: { children: { text: string }[] }) => node.children[0].text,
    ),
  ).toEqual(["Before", "", "After"]);
  fireEvent.mouseMove(screen.getByText("Before"));
  fireEvent.click(screen.getByRole("button", { name: "Write above" }));
  await waitFor(() =>
    expect(changed.mock.lastCall?.[0][0].children[0].text).toBe(""),
  );
});

it("targets a deeply positioned block in a large document without enumerating DOM siblings", async () => {
  render(
    <PageEditor
      pageId="large-document"
      api={api}
      pages={new PagesClient(api)}
      readOnly={false}
      initialValue={Array.from({ length: 1000 }, (_, index) => ({
        type: "p",
        children: [{ text: `Large document block ${index}` }],
      }))}
      onChange={() => {}}
    />,
  );
  const textbox = screen.getByRole("textbox", { name: "Page content" });
  const childrenRead = vi.spyOn(textbox, "children", "get");
  fireEvent.mouseMove(screen.getByText("Large document block 900"));
  expect(screen.getByRole("button", { name: "Delete block" })).toBeVisible();
  expect(childrenRead).not.toHaveBeenCalled();
  childrenRead.mockRestore();
  fireEvent.click(screen.getByRole("button", { name: "Delete block" }));
  await waitFor(() =>
    expect(
      screen.queryByText("Large document block 900"),
    ).not.toBeInTheDocument(),
  );
  expect(screen.getByText("Large document block 899")).toBeInTheDocument();
  expect(screen.getByText("Large document block 901")).toBeInTheDocument();
});

it("inserts My tickets from the Jira slash command without persisting ticket data", async () => {
  const changed = vi.fn();
  const user = userEvent.setup();
  render(
    <PageEditor
      pageId="tickets"
      api={api}
      pages={new PagesClient(api)}
      readOnly={false}
      initialValue={[{ type: "p", children: [{ text: "" }] }]}
      issueProviders={["jira"]}
      onChange={changed}
    />,
  );
  const editable = screen.getByRole("textbox", { name: "Page content" });
  await user.click(editable);
  await user.keyboard("/");
  await user.type(
    screen.getByRole("textbox", { name: "Search blocks and inserts…" }),
    "mis-tickets",
  );
  await user.click(await screen.findByRole("option", { name: "My tickets" }));
  await waitFor(() => expect(changed).toHaveBeenCalled());
  const value = changed.mock.calls.at(-1)?.[0] as Array<
    Record<string, unknown>
  >;
  expect(value[0]).toMatchObject({
    type: "ticket_summary",
    ticketSummaryConfig: {},
  });
  expect(value[1]).toMatchObject({ type: "p", children: [{ text: "" }] });
  expect(JSON.stringify(value)).not.toContain("tickets");
  await waitFor(() => expect(editable).toHaveFocus());
});

it("hides My tickets command when Jira is disconnected", async () => {
  const user = userEvent.setup();
  render(
    <PageEditor
      pageId="tickets-disconnected"
      api={api}
      pages={new PagesClient(api)}
      readOnly={false}
      initialValue={[{ type: "p", children: [{ text: "" }] }]}
      onChange={() => {}}
    />,
  );
  await user.click(screen.getByRole("textbox", { name: "Page content" }));
  await user.keyboard("/");
  expect(
    screen.queryByRole("option", { name: "My tickets" }),
  ).not.toBeInTheDocument();
});

it("inserts a loaded ticket snapshot as editable blocks below the live card", async () => {
  const changed = vi.fn();
  const user = userEvent.setup();
  const snapshotApi = new ApiClient({
    baseUrl: "https://savia.test",
    tokenSource: { getAccessToken: async () => null },
    fetcher: async (input: RequestInfo | URL) =>
      String(input).includes("/v1/personal-integrations/ticket-summary")
        ? Response.json({
            data: {
              updatedAt: "2026-06-03T12:00:00.000Z",
              tickets: [
                {
                  key: "OPS-41",
                  title: "Restore the release pipeline",
                  url: "https://jira.example/browse/OPS-41",
                  status: "In Code Review",
                  comments: { total: 1, latest: null },
                  pullRequests: [],
                  prLookup: "complete",
                },
              ],
              partial: false,
              warnings: [],
            },
          })
        : Response.json({ error: {} }, { status: 403 }),
  });
  render(
    <PageEditor
      pageId="tickets-snapshot"
      api={snapshotApi}
      pages={new PagesClient(snapshotApi)}
      readOnly={false}
      initialValue={[
        {
          type: "ticket_summary",
          ticketSummaryConfig: {},
          children: [{ text: "" }],
        },
        { type: "p", children: [{ text: "" }] },
      ]}
      issueProviders={["jira"]}
      onChange={changed}
    />,
  );
  await user.click(
    await screen.findByRole("button", {
      name: "Insert snapshot as editable blocks",
    }),
  );
  await waitFor(() => expect(changed).toHaveBeenCalled());
  const value = changed.mock.calls.at(-1)?.[0] as Array<
    Record<string, unknown>
  >;
  expect(value[0]).toMatchObject({ type: "ticket_summary" });
  expect(
    value.some(
      (node) =>
        node.type === "bullet" && JSON.stringify(node).includes("OPS-41"),
    ),
  ).toBe(true);
});
