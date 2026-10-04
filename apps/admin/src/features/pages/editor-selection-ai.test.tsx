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
) {
  const api = new ApiClient({
    baseUrl: "https://savia.test",
    tokenSource: { getAccessToken: async () => null },
    fetcher: async () => Response.json({ data: employees }),
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
