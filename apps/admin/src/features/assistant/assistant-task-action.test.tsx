import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  PluginAssistantProvider,
  PluginAssistantResponse,
} from "@savia/studio-shared/plugin-assistant";
import { AssistantTaskAction } from "./assistant-task-action";

const suggestion = {
  id: "experience-requirement",
  title: "Prepare experience certificates",
  description: "Submit two certificates for comparable contracts.",
  citationIds: ["source-1", "source-2"],
};

const message: PluginAssistantResponse["messages"][number] = {
  id: "answer-1",
  role: "assistant",
  text: "Two certificates are missing.",
  citations: [
    {
      id: "source-1",
      label: "Tender terms, p. 4",
      excerpt: "Two certificates required.",
    },
    { id: "source-2", label: "Annex A", excerpt: "Comparable contracts only." },
  ],
  taskSuggestions: [suggestion],
};

function provider(
  createTask: NonNullable<PluginAssistantProvider["createTask"]>,
  overrides: Partial<PluginAssistantProvider> = {},
): PluginAssistantProvider {
  return {
    title: "Tender",
    actionId: "assistant-chat",
    context: { dossierId: "tender-1" },
    taskCollection: "secop_application_tasks",
    sessionId: "session-1",
    invoke: vi.fn(),
    createTask,
    close: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  window.history.replaceState(
    null,
    "",
    "/#/studio?tenantId=12&object=opportunities",
  );
});

describe("assistant task action", () => {
  it("requires explicit selection and review before creating a task", async () => {
    window.history.replaceState(
      null,
      "",
      "/#/studio?tenantId=12&plugin=secop-tenders&object=opportunities",
    );
    const createTask = vi
      .fn()
      .mockResolvedValue({ id: "task-1", created: true });
    const currentProvider = provider(createTask, {
      taskCollection: "Assistant_Tasks",
    });
    render(
      <AssistantTaskAction provider={currentProvider} message={message} />,
    );

    expect(createTask).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));
    const form = screen.getByRole("form", { name: "Create task" });
    expect(
      screen.getByRole("combobox", {
        name: "Requirement to prepare or verify",
      }),
    ).toHaveValue("");
    fireEvent.submit(form);
    expect(createTask).not.toHaveBeenCalled();

    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search requirements" }),
      {
        target: { value: "certificates" },
      },
    );
    fireEvent.change(
      screen.getByRole("combobox", {
        name: "Requirement to prepare or verify",
      }),
      {
        target: { value: suggestion.id },
      },
    );
    expect(screen.getByText(suggestion.description)).toBeVisible();
    expect(
      screen.getByText(/OCR extraction and company evidence/i),
    ).toBeVisible();

    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
      target: { value: "Collect two contracts" },
    });
    fireEvent.change(
      screen.getByRole("textbox", { name: "Responsible person" }),
      {
        target: { value: "Ana Pérez" },
      },
    );
    fireEvent.change(screen.getByLabelText("Due date"), {
      target: { value: "2026-11-05" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save task" }));

    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(1));
    expect(createTask).toHaveBeenCalledWith({
      suggestion,
      title: "Collect two contracts",
      assignee: "Ana Pérez",
      dueDate: "2026-11-05",
      sourceReference:
        "Tender terms, p. 4\nTwo certificates required.\n\nAnnex A\nComparable contracts only.",
    });
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Task created.",
    );
    expect(screen.getByRole("link", { name: "View tasks" })).toHaveAttribute(
      "href",
      "#/studio?tenantId=12&object=Assistant_Tasks&view=records",
    );
  });

  it("keeps the reviewed draft after a create failure and allows retry", async () => {
    const createTask = vi
      .fn()
      .mockRejectedValueOnce(new Error("Save failed"))
      .mockResolvedValueOnce({ id: "task-1", created: false });
    render(
      <AssistantTaskAction provider={provider(createTask)} message={message} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));
    fireEvent.change(
      screen.getByRole("combobox", {
        name: "Requirement to prepare or verify",
      }),
      {
        target: { value: suggestion.id },
      },
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "Responsible person" }),
      {
        target: { value: "Ana Pérez" },
      },
    );
    fireEvent.change(screen.getByLabelText("Due date"), {
      target: { value: "2026-11-05" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save task" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not save the task. Try again.",
    );
    expect(
      screen.getByRole("textbox", { name: "Responsible person" }),
    ).toHaveValue("Ana Pérez");
    expect(screen.getByLabelText("Due date")).toHaveValue("2026-11-05");

    fireEvent.click(screen.getByRole("button", { name: "Save task" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "This task already existed.",
    );
    expect(createTask).toHaveBeenCalledTimes(2);
  });

  it("hides without provider write capability or suggestions", () => {
    const noWrite = provider(vi.fn());
    delete noWrite.createTask;
    const { rerender } = render(
      <AssistantTaskAction provider={noWrite} message={message} />,
    );
    expect(screen.queryByRole("button", { name: "Create task" })).toBeNull();

    rerender(
      <AssistantTaskAction
        provider={provider(vi.fn())}
        message={{ ...message, taskSuggestions: [] }}
      />,
    );
    expect(screen.queryByRole("button", { name: "Create task" })).toBeNull();
  });

  it("disables creation for stale answers and removes an open draft if the answer becomes stale", () => {
    const createTask = vi
      .fn()
      .mockResolvedValue({ id: "task-1", created: true });
    const currentProvider = provider(createTask);
    const { rerender } = render(
      <AssistantTaskAction provider={currentProvider} message={message} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));
    expect(screen.getByRole("form", { name: "Create task" })).toBeVisible();

    rerender(
      <AssistantTaskAction
        provider={currentProvider}
        message={{ ...message, stale: true }}
      />,
    );
    const createButton = screen.getByRole("button", { name: "Create task" });
    expect(createButton).toBeDisabled();
    expect(screen.queryByRole("form", { name: "Create task" })).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(
      "This answer uses an earlier source version. Refresh the answer before creating a task.",
    );
    fireEvent.click(createButton);
    expect(createTask).not.toHaveBeenCalled();
  });

  it("discards the draft when provider context changes and ignores its late result", async () => {
    let resolveCreate!: (value: { id: string; created: boolean }) => void;
    const createTask = vi.fn(
      () =>
        new Promise<{ id: string; created: boolean }>(
          (resolve) => (resolveCreate = resolve),
        ),
    );
    const currentProvider = provider(createTask);
    const { rerender } = render(
      <AssistantTaskAction provider={currentProvider} message={message} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));
    fireEvent.change(
      screen.getByRole("combobox", {
        name: "Requirement to prepare or verify",
      }),
      {
        target: { value: suggestion.id },
      },
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "Responsible person" }),
      {
        target: { value: "Ana Pérez" },
      },
    );
    fireEvent.change(screen.getByLabelText("Due date"), {
      target: { value: "2026-11-05" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save task" }));
    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(1));

    rerender(
      <AssistantTaskAction
        provider={provider(vi.fn(), {
          sessionId: "session-2",
          context: { dossierId: "tender-2" },
        })}
        message={{ ...message, id: "answer-2" }}
      />,
    );
    expect(screen.queryByRole("status")).toBeNull();
    expect(
      screen.queryByRole("textbox", { name: "Responsible person" }),
    ).toBeNull();
    resolveCreate({ id: "task-1", created: true });
    await Promise.resolve();
    expect(screen.queryByText("Task created.")).toBeNull();
  });
});
