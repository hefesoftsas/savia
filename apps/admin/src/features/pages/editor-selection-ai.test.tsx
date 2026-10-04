import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ApiClient } from "@/api/api-client";
import { PageEditor } from "./editor";
import { PagesClient } from "./client";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./selection-ai-request", () => ({ requestSelectionAI: request }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  request.mockReset();
  vi.restoreAllMocks();
  window.getSelection()?.removeAllRanges();
});

async function openAI(
  readOnly = false,
  employees: unknown[] = [],
  launch = true,
  fetcher?: typeof fetch,
) {
  const api = new ApiClient({
    baseUrl: "https://savia.test",
    tokenSource: { getAccessToken: async () => null },
    fetcher: fetcher ?? (async () => Response.json({ data: employees })),
  });
  const changed = vi.fn();
  const { container } = render(
    <PageEditor
      pageId="one"
      api={api}
      pages={new PagesClient(api)}
      readOnly={readOnly}
      initialValue={[
        { type: "p", children: [{ text: "Keep this selection" }] },
      ]}
      onChange={changed}
    />,
  );
  const content = container.querySelector<HTMLElement>(".page-editor-content")!;
  act(() => content.focus());
  const text = screen.getByText("Keep this selection").firstChild!;
  Object.defineProperty(text.parentElement!, "isContentEditable", {
    value: true,
    configurable: true,
  });
  const range = document.createRange();
  range.setStart(text, 5);
  range.setEnd(text, 9);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  fireEvent.mouseMove(text.parentElement!);
  fireEvent(document, new Event("selectionchange"));
  if (!readOnly && launch)
    fireEvent.click(await screen.findByRole("button", { name: "Ask AI" }));
  return { changed, container, content };
}

it("previews a response without changing the document and replaces only the saved selection", async () => {
  request.mockResolvedValue("better");
  const { changed, content } = await openAI();
  const dialog = await screen.findByRole("dialog", { name: "Ask AI" });
  expect(within(dialog).getByText("this")).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "Summarize" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Generate" }));
  await within(dialog).findByText("better");
  expect(content.textContent).toBe("Keep this selection");
  expect(changed).not.toHaveBeenCalled();
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Replace selection" }),
  );
  await waitFor(() =>
    expect(content.textContent).toBe("Keep better selection"),
  );
});

it("inserts the response below the selected block without replacing source text", async () => {
  request.mockResolvedValue("First line\nSecond line");
  const { content } = await openAI();
  const dialog = await screen.findByRole("dialog", { name: "Ask AI" });
  fireEvent.change(within(dialog).getByLabelText("Instruction"), {
    target: { value: "Explain" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Generate" }));
  await within(dialog).findByRole("button", { name: "Insert below" });
  await waitFor(() =>
    expect(
      within(dialog).getByRole("button", { name: "Insert below" }),
    ).toBeEnabled(),
  );
  fireEvent.click(within(dialog).getByRole("button", { name: "Insert below" }));
  await waitFor(() =>
    expect(content.textContent).toBe(
      "Keep this selectionFirst lineSecond line",
    ),
  );
});

it("keeps source text on failure and offers retry", async () => {
  request.mockRejectedValue(new Error("Unavailable"));
  const { changed, content } = await openAI();
  const dialog = await screen.findByRole("dialog", { name: "Ask AI" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Explain" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Generate" }));
  expect(await within(dialog).findByRole("alert")).toBeInTheDocument();
  expect(content.textContent).toBe("Keep this selection");
  expect(changed).not.toHaveBeenCalled();
  expect(
    within(dialog).getByRole("button", { name: "Generate" }),
  ).toBeEnabled();
  expect(
    within(dialog).queryByRole("button", { name: "Replace selection" }),
  ).not.toBeInTheDocument();
});

it("does not expose AI editing to readers", async () => {
  await openAI(true);
  expect(
    screen.queryByRole("button", { name: "Ask AI" }),
  ).not.toBeInTheDocument();
});

it("replaces with the chosen translation without inserting headings or other versions", async () => {
  request.mockResolvedValue(
    "1. Regular translation\nHello\n\n2. Professional but friendly translation\nHello there\n\n3. Concise professional but friendly translation\nHi",
  );
  const { content } = await openAI();
  const dialog = await screen.findByRole("dialog", { name: "Ask AI" });
  fireEvent.change(within(dialog).getByLabelText("Instruction"), {
    target: { value: "Translate" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Generate" }));
  fireEvent.click(
    await within(dialog).findByRole("radio", {
      name: "Concise professional but friendly translation",
    }),
  );
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Replace selection" }),
  );
  await waitFor(() => expect(content.textContent).toBe("Keep Hi selection"));
});

it("copies only the chosen translation", async () => {
  request.mockResolvedValue(
    "1. Regular translation\nHello\n\n2. Professional but friendly translation\nHello there\n\n3. Concise professional but friendly translation\nHi",
  );
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal(
    "navigator",
    Object.assign(Object.create(navigator), { clipboard: { writeText } }),
  );
  try {
    const { content } = await openAI();
    const dialog = await screen.findByRole("dialog", { name: "Ask AI" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Explain" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Generate" }));
    fireEvent.click(
      await within(dialog).findByRole("radio", {
        name: "Professional but friendly translation",
      }),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Copy" }));
    await within(dialog).findByRole("button", { name: "Copied" });
    expect(writeText).toHaveBeenCalledWith("Hello there");
    expect(content.textContent).toBe("Keep this selection");
  } finally {
    vi.unstubAllGlobals();
  }
});

it("keeps the expanded selection toolbar inside a narrow viewport", async () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return {
        left: 0,
        top: 0,
        width: this.classList.contains("page-editor-selection-tools")
          ? 240
          : 320,
        height: 36,
        right: 320,
        bottom: 36,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      };
    },
  );
  const originalWidth = window.innerWidth;
  window.innerWidth = 320;
  try {
    await openAI(false, [], false);
    const toolbar = await screen.findByRole("toolbar", { name: "Formatting" });
    expect(Number.parseFloat(toolbar.style.left)).toBeGreaterThanOrEqual(128);
    expect(Number.parseFloat(toolbar.style.left) + 120).toBeLessThanOrEqual(
      312,
    );
  } finally {
    window.innerWidth = originalWidth;
  }
});

it("cancels generation and ignores a response that arrives after cancellation", async () => {
  let resolve!: (value: string) => void;
  let signal!: AbortSignal;
  request.mockImplementation((_api, options) => {
    signal = options.signal;
    return new Promise<string>((done) => {
      resolve = done;
    });
  });
  const { changed, content } = await openAI();
  const dialog = await screen.findByRole("dialog", { name: "Ask AI" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Explain" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Generate" }));
  fireEvent.click(
    await within(dialog).findByRole("button", { name: "Cancel" }),
  );
  expect(signal.aborted).toBe(true);
  await act(async () => {
    resolve("Late result");
  });
  expect(within(dialog).queryByText("Late result")).not.toBeInTheDocument();
  expect(content.textContent).toBe("Keep this selection");
  expect(changed).not.toHaveBeenCalled();
  expect(
    within(dialog).getByRole("button", { name: "Generate" }),
  ).toBeEnabled();
});

it("uses the explicitly selected active employee and excludes inactive employees", async () => {
  request.mockImplementation((_api, options) =>
    Promise.resolve(
      options.employeeId === "sales" ? "Sales response" : "Default response",
    ),
  );
  await openAI(false, [
    { id: "sales", name: "Laura", handle: "ventas", status: "active" },
    {
      id: "disabled",
      name: "Inactive",
      handle: "inactive",
      status: "inactive",
    },
  ]);
  const dialog = await screen.findByRole("dialog", { name: "Ask AI" });
  expect(
    await within(dialog).findByRole("option", { name: "Laura (@ventas)" }),
  ).toBeInTheDocument();
  expect(
    within(dialog).queryByRole("option", { name: "Inactive (@inactive)" }),
  ).not.toBeInTheDocument();
  fireEvent.change(within(dialog).getByLabelText("Assistant"), {
    target: { value: "sales" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Explain" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Generate" }));
  expect(await within(dialog).findByText("Sales response")).toBeInTheDocument();
});

it("copies a completed response without editing the page", async () => {
  request.mockResolvedValue("Copy this response");
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal(
    "navigator",
    Object.assign(Object.create(navigator), { clipboard: { writeText } }),
  );
  try {
    const { changed, content } = await openAI();
    const dialog = await screen.findByRole("dialog", { name: "Ask AI" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Explain" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Generate" }));
    fireEvent.click(
      await within(dialog).findByRole("button", { name: "Copy" }),
    );
    expect(
      await within(dialog).findByRole("button", { name: "Copied" }),
    ).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith("Copy this response");
    expect(content.textContent).toBe("Keep this selection");
    expect(changed).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});

it("creates a collectionless translator explicitly and invokes its three-version prompt", async () => {
  request.mockResolvedValue(
    "1. Regular translation\nHello\n2. Professional but friendly translation\nHello there\n3. Concise professional but friendly translation\nHi",
  );
  const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST")
      return Response.json({
        data: {
          id: "translator",
          name: "Translator",
          handle: "traductor",
          status: "active",
        },
      });
    return Response.json({ data: [] });
  });
  const { content } = await openAI(false, [], true, fetcher);
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(
    await within(dialog).findByRole("button", { name: "Create translator" }),
  );
  await waitFor(() =>
    expect(within(dialog).getByLabelText("Assistant")).toHaveValue(
      "translator",
    ),
  );
  const post = fetcher.mock.calls.find((call) => call[1]?.method === "POST")!;
  expect(JSON.parse(String(post[1]?.body))).toMatchObject({
    handle: "traductor",
    allowedCollections: [],
  });
  expect(content.textContent).toBe("Keep this selection");
  fireEvent.click(within(dialog).getByRole("button", { name: "Generate" }));
  await within(dialog).findByRole("radio", { name: "Regular translation" });
  expect(request.mock.calls[0][1]).toMatchObject({
    employeeId: "translator",
    instruction: expect.stringContaining("three versions"),
  });
});

it("does not offer a duplicate translator when its handle already exists", async () => {
  await openAI(false, [
    {
      id: "existing",
      handle: "traductor",
      name: "Translator",
      status: "inactive",
    },
  ]);
  const dialog = await screen.findByRole("dialog");
  await waitFor(() =>
    expect(within(dialog).getByLabelText("Assistant")).toBeEnabled(),
  );
  expect(
    within(dialog).queryByRole("button", { name: "Create translator" }),
  ).not.toBeInTheDocument();
});

it.each([
  "Which meaning of banco did you intend?",
  "Here are the translations:\n1. Regular translation\nHello\n2. Professional but friendly translation\nHello there\n3. Concise professional but friendly translation\nHi",
])(
  "keeps translator clarification or unrecognized output visible without apply controls: %s",
  async (result) => {
    request.mockResolvedValue(result);
    const { content } = await openAI(false, [
      {
        id: "translator",
        handle: "traductor",
        name: "Translator",
        status: "active",
      },
    ]);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() =>
      expect(within(dialog).getByLabelText("Assistant")).toBeEnabled(),
    );
    fireEvent.change(within(dialog).getByLabelText("Assistant"), {
      target: { value: "translator" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Generate" }));
    expect(
      (await within(dialog).findByRole("region", { name: "Response" }))
        .textContent,
    ).toContain(result);
    expect(
      within(dialog).queryByRole("button", { name: "Replace selection" }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: "Insert below" }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: "Copy" }),
    ).not.toBeInTheDocument();
    expect(content.textContent).toBe("Keep this selection");
  },
);

it("explains how to reactivate an existing inactive translator", async () => {
  await openAI(false, [
    {
      id: "existing",
      handle: "traductor",
      name: "Translator",
      status: "inactive",
    },
  ]);
  const dialog = await screen.findByRole("dialog");
  expect(
    await within(dialog).findByText(
      "The translator is inactive. Activate it in AI employees to use it here.",
    ),
  ).toBeVisible();
});

it("keeps ordinary responses about translation styles applicable", async () => {
  request.mockResolvedValue(
    "A Regular translation preserves the original meaning.",
  );
  const { content } = await openAI();
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Explain" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Generate" }));
  fireEvent.click(
    await within(dialog).findByRole("button", { name: "Replace selection" }),
  );
  await waitFor(() =>
    expect(content.textContent).toBe(
      "Keep A Regular translation preserves the original meaning. selection",
    ),
  );
});
