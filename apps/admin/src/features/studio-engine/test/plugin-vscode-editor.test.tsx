import { fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PluginVscodeEditor } from "../plugin-vscode-editor";
import { projectFileUri } from "../plugin-vscode-protocol";

function messageFrom(iframe: HTMLIFrameElement, data: unknown) {
  fireEvent(
    window,
    new MessageEvent("message", {
      source: iframe.contentWindow,
      origin: location.origin,
      data,
    }),
  );
}

describe("extension editor bridge", () => {
  it("accepts sequenced edits from its own frame and acknowledges the latest controlled value", () => {
    const onChange = vi.fn();
    const props = {
      files: { "src/entry.tsx": "before" },
      activeFile: "src/entry.tsx",
      extensions: [],
      readOnly: false,
      onChange,
      onSearch: vi.fn(),
      onError: vi.fn(),
    };
    const view = render(<PluginVscodeEditor {...props} />);
    const iframe = view.container.querySelector("iframe")!;
    const postMessage = vi
      .spyOn(iframe.contentWindow!, "postMessage")
      .mockImplementation(() => {});

    messageFrom(iframe, { type: "savia-editor-ready" });
    messageFrom(iframe, {
      type: "savia-editor-change",
      path: "src/entry.tsx",
      value: "after",
      sequence: 4,
    });
    messageFrom(iframe, {
      type: "savia-editor-change",
      path: "src/entry.tsx",
      value: "stale duplicate",
      sequence: 4,
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("src/entry.tsx", "after");

    view.rerender(
      <PluginVscodeEditor {...props} files={{ "src/entry.tsx": "after" }} />,
    );
    const states = postMessage.mock.calls
      .map(([data]) => data as { type?: string; acknowledgements?: unknown })
      .filter((data) => data.type === "savia-editor-state");
    expect(states.at(-1)?.acknowledgements).toEqual({ "src/entry.tsx": 4 });

    postMessage.mockClear();
    view.rerender(
      <PluginVscodeEditor
        {...props}
        readOnly
        files={{ "src/entry.tsx": "after" }}
      />,
    );
    messageFrom(iframe, {
      type: "savia-editor-change",
      path: "src/entry.tsx",
      value: "locked edit",
      sequence: 5,
    });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("queues every format request until the iframe is ready and sends each once", () => {
    const props = {
      files: { "entry.tsx": "before" },
      activeFile: "entry.tsx",
      extensions: ["savia.formatter"],
      readOnly: false,
      onChange: vi.fn(),
      onSearch: vi.fn(),
      onError: vi.fn(),
    };
    const view = render(<PluginVscodeEditor {...props} formatRequest={0} />);
    const iframe = view.container.querySelector("iframe")!;
    const postMessage = vi
      .spyOn(iframe.contentWindow!, "postMessage")
      .mockImplementation(() => {});

    view.rerender(<PluginVscodeEditor {...props} formatRequest={2} />);
    expect(
      postMessage.mock.calls.filter(
        ([data]) => (data as { type?: string }).type === "savia-editor-format",
      ),
    ).toHaveLength(0);

    messageFrom(iframe, { type: "savia-editor-ready" });
    const formatMessages = () =>
      postMessage.mock.calls.filter(
        ([data]) => (data as { type?: string }).type === "savia-editor-format",
      );
    expect(formatMessages()).toHaveLength(2);
    view.rerender(<PluginVscodeEditor {...props} formatRequest={2} />);
    expect(formatMessages()).toHaveLength(2);
    view.rerender(<PluginVscodeEditor {...props} formatRequest={3} readOnly />);
    expect(formatMessages()).toHaveLength(2);
    view.rerender(<PluginVscodeEditor {...props} formatRequest={3} />);
    expect(formatMessages()).toHaveLength(3);
  });

  it("routes inline completions only for a writable entry file and replies with a result", async () => {
    const fetchCompletion = vi.fn().mockResolvedValue("completion");
    const props = {
      files: { "entry.tsx": "before", "src/app.tsx": "source" },
      activeFile: "entry.tsx",
      extensions: [],
      readOnly: false,
      onChange: vi.fn(),
      onSearch: vi.fn(),
      onError: vi.fn(),
      fetchCompletion,
    };
    const view = render(<PluginVscodeEditor {...props} />);
    const iframe = view.container.querySelector("iframe")!;
    const postMessage = vi
      .spyOn(iframe.contentWindow!, "postMessage")
      .mockImplementation(() => {});

    messageFrom(iframe, {
      type: "savia-editor-completion",
      requestId: "request-1",
      prefix: "const value = ",
      suffix: "",
    });
    await waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        {
          type: "savia-editor-completion-result",
          requestId: "request-1",
          value: "completion",
        },
        location.origin,
      ),
    );
    expect(fetchCompletion).toHaveBeenCalledWith("const value = ", "");

    fetchCompletion.mockClear();
    view.rerender(<PluginVscodeEditor {...props} activeFile="src/app.tsx" />);
    messageFrom(iframe, {
      type: "savia-editor-completion",
      requestId: "request-2",
      prefix: "source",
      suffix: "",
    });
    await waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        {
          type: "savia-editor-completion-result",
          requestId: "request-2",
          value: null,
        },
        location.origin,
      ),
    );
    expect(fetchCompletion).not.toHaveBeenCalled();
  });

  it("keeps proposal review hidden and prevents the hidden editor from writing", () => {
    const onChange = vi.fn();
    const props = {
      files: { "entry.tsx": "before" },
      activeFile: "entry.tsx",
      extensions: [],
      readOnly: true,
      hidden: true,
      onChange,
      onSearch: vi.fn(),
      onError: vi.fn(),
    };
    const view = render(<PluginVscodeEditor {...props} />);
    const iframe = view.container.querySelector("iframe")!;
    expect(iframe).toHaveAttribute("hidden");
    messageFrom(iframe, {
      type: "savia-editor-change",
      path: "entry.tsx",
      value: "unexpected edit",
      sequence: 1,
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("encodes file paths and rejects traversal outside the project", () => {
    expect(projectFileUri("src/a b.tsx")).toBe(
      "file:///workspace/src/a%20b.tsx",
    );
    for (const path of ["../entry.tsx", "/entry.tsx", "a/../b", "a\\b"])
      expect(() => projectFileUri(path)).toThrow("Invalid");
  });
});
