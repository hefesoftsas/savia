import { expect, it, vi } from "vitest";
import { createAssistantTaskRecord } from "./assistant-task-record";

const draft = {
  suggestion: {
    id: "R1",
    title: "Experience",
    description: "Verify two certificates",
    citationIds: ["S001"],
  },
  title: "Collect certificates",
  assignee: "José",
  dueDate: "2026-10-20",
  sourceReference: "Terms · page 4",
};
it("persists the reviewed task using backend CRUD and reuses the same requirement on retry", async () => {
  let saved: Record<string, unknown> | undefined;
  const request = vi.fn(
    async (_path: string, method?: string, input?: unknown) => {
      if (method === "POST") {
        saved = input as Record<string, unknown>;
        return { data: { id: "task1", ...saved } };
      }
      return {
        data: saved ? [{ id: "task1", ...saved }] : [],
        total: saved ? 1 : 0,
        page: 1,
        perPage: 2,
      };
    },
  );
  const options = {
    collection: "secop_application_tasks",
    pluginId: "procurement.secop",
    context: { dossierId: "CO1.REQ.1" },
    sourceUrl: "https://savia-preview.hefesoft.com/#/studio",
    request: request as never,
  };
  expect(await createAssistantTaskRecord(options, draft)).toEqual({
    id: "task1",
    created: true,
  });
  expect(saved).toMatchObject({
    name: "Collect certificates",
    assignee: "José",
    due_date: "2026-10-20",
    status: "open",
    source_reference: "Terms · page 4",
  });
  expect(await createAssistantTaskRecord(options, draft)).toEqual({
    id: "task1",
    created: false,
  });
  expect(request.mock.calls.filter((c) => c[1] === "POST")).toHaveLength(1);
});
it("validates required assignee and actual calendar date before writing", async () => {
  const request = vi.fn();
  for (const patch of [
    { assignee: " " },
    { dueDate: "2026-02-30" },
    { title: "" },
  ]) {
    await expect(
      createAssistantTaskRecord(
        {
          collection: "tasks",
          pluginId: "plugin",
          context: {},
          sourceUrl: "https://example.com",
          request,
        },
        { ...draft, ...patch },
      ),
    ).rejects.toThrow();
  }
  expect(request).not.toHaveBeenCalled();
});
