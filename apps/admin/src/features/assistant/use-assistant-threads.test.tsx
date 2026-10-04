import { act, renderHook, waitFor, cleanup } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { PropsWithChildren } from "react";
import type { AppServices } from "@/app-services";
import { ApiClient } from "@/api/api-client";
import { AppServicesProvider } from "./assistant-context";
import { useAssistantThreads } from "./use-assistant-threads";
import type {
  AssistantThreadSummary,
  SyncedThread,
} from "./assistant-threads-client";
afterEach(cleanup);
function server() {
  const threads = new Map<string, SyncedThread>();
  const detailGets: string[] = [];
  let offline = false;
  let activeTenantId = 101;
  let nextListGate:
    | { wait: Promise<void>; started: () => void; release: () => void }
    | undefined;
  const device = () => {
    const apiClient = new ApiClient({
      baseUrl: "https://savia.test",
      tokenSource: { getAccessToken: async () => "user-token" },
      fetcher: async (input, init) => {
        if (offline) throw new Error("Offline");
        const url = new URL(String(input));
        const id = url.pathname.split("/").pop()!;
        if (init?.method === "PUT") {
          const body = JSON.parse(String(init.body));
          const current = threads.get(id);
          if ((current?.revision ?? 0) !== body.expectedRevision)
            return Response.json(
              { error: { code: "CONFLICT", message: "Changed elsewhere" } },
              { status: 409 },
            );
          const next = {
            ...body,
            id,
            userId: "owner",
            ...(body.context
              ? {
                  context: { ...body.context, tenantId: activeTenantId },
                }
              : {}),
            revision: (current?.revision ?? 0) + 1,
            createdAt: "2026-10-04T00:00:00Z",
            updatedAt: new Date().toISOString(),
          };
          threads.set(id, next);
          return Response.json(next);
        }
        if (url.pathname === "/api/assistant/threads") {
          const queryTenantId = activeTenantId;
          const gate = nextListGate;
          nextListGate = undefined;
          if (gate) {
            gate.started();
            await gate.wait;
          }
          const contextKind = url.searchParams.get("contextKind");
          const contextId = url.searchParams.get("contextId");
          const scopedThreads = [...threads.values()].filter((thread) =>
            contextKind && contextId
              ? thread.context?.kind === contextKind &&
                thread.context.id === contextId &&
                thread.context.tenantId === queryTenantId
              : true,
          );
          const summaries: AssistantThreadSummary[] = scopedThreads.map(
            ({ messages, ...thread }) => ({
              ...thread,
              messageCount: messages.length,
              preview:
                messages.at(-1)?.parts?.find((part) => part.type === "text")
                  ?.text ?? "",
            }),
          );
          return Response.json({ threads: summaries });
        }
        detailGets.push(id);
        const thread = threads.get(id);
        return thread
          ? Response.json(thread)
          : Response.json(
              { error: { code: "NOT_FOUND", message: "Not found" } },
              { status: 404 },
            );
      },
    });
    const services = {
      apiClient,
      authProvider: { getIdentity: async () => ({ id: "owner" }) },
    } as unknown as AppServices;
    return ({ children }: PropsWithChildren) => (
      <AppServicesProvider services={services}>{children}</AppServicesProvider>
    );
  };
  return {
    device,
    threads,
    detailGets,
    setActiveTenantId: (tenantId: number) => {
      activeTenantId = tenantId;
    },
    pauseNextList: () => {
      let markStarted!: () => void;
      let release!: () => void;
      const started = new Promise<void>((resolve) => (markStarted = resolve));
      const wait = new Promise<void>((resolve) => (release = resolve));
      nextListGate = { wait, started: markStarted, release };
      return { started, release };
    },
    disconnect: () => {
      offline = true;
    },
    reconnect: () => {
      offline = false;
    },
  };
}
const messages = [
  {
    id: "m1",
    role: "user" as const,
    parts: [{ type: "text", text: "What was decided?" }],
  },
];
function savedThread(
  id: string,
  title: string,
  messages: SyncedThread["messages"],
) {
  const now = "2026-10-04T00:00:00Z";
  return {
    id,
    userId: "owner",
    title,
    createdAt: now,
    updatedAt: now,
    messages,
    revision: 4,
  } satisfies SyncedThread;
}

it("fetches full messages only for a selected thread and reuses unchanged detail", async () => {
  localStorage.clear();
  const api = server();
  const first = savedThread("thread-1", "First", messages);
  const second = savedThread("thread-2", "Second", []);
  second.updatedAt = "2026-10-03T00:00:00Z";
  api.threads.set(first.id, first);
  api.threads.set(second.id, second);

  const view = renderHook(() => useAssistantThreads(true), {
    wrapper: api.device(),
  });
  await waitFor(() =>
    expect(view.result.current.activeThread?.id).toBe(first.id),
  );
  expect(api.detailGets).toEqual([first.id]);
  expect(
    view.result.current.threads.every((thread) => !("messages" in thread)),
  ).toBe(true);

  await act(async () => {
    await view.result.current.refresh();
  });
  expect(api.detailGets).toEqual([first.id]);

  act(() => view.result.current.select(second.id));
  await waitFor(() =>
    expect(view.result.current.activeThread?.id).toBe(second.id),
  );
  expect(api.detailGets).toEqual([first.id, second.id]);
});

it("keeps the current thread on a remote revision conflict until explicit reload", async () => {
  localStorage.clear();
  const api = server();
  const current = savedThread("thread-1", "First", messages);
  api.threads.set(current.id, current);
  const view = renderHook(() => useAssistantThreads(true), {
    wrapper: api.device(),
  });
  await waitFor(() =>
    expect(view.result.current.activeThread?.messages).toEqual(messages),
  );

  const remoteMessages = [
    {
      id: "m2",
      role: "user" as const,
      parts: [{ type: "text", text: "Updated from another device" }],
    },
  ];
  api.threads.set(current.id, {
    ...current,
    messages: remoteMessages,
    revision: current.revision + 1,
  });
  await act(async () => {
    await view.result.current.refresh();
  });

  expect(view.result.current.conflict).toBe(true);
  expect(view.result.current.activeThread?.messages).toEqual(messages);
  expect(api.detailGets).toEqual([current.id]);

  await act(async () => {
    await view.result.current.refresh(true);
  });
  expect(view.result.current.activeThread?.messages).toEqual(remoteMessages);
  expect(api.detailGets).toEqual([current.id, current.id]);
});

it("ignores an in-flight old-workspace list after the active tenant changes", async () => {
  localStorage.clear();
  const api = server();
  const context = {
    kind: "recording" as const,
    id: "recording-1",
    title: "Planning",
  };
  const first = {
    ...savedThread("thread-tenant-a", "Tenant A", messages),
    context: { ...context, tenantId: 101 },
  };
  const second = {
    ...savedThread("thread-tenant-b", "Tenant B", []),
    context: { ...context, tenantId: 202 },
  };
  api.threads.set(first.id, first);
  api.threads.set(second.id, second);

  const view = renderHook(() => useAssistantThreads(true, context), {
    wrapper: api.device(),
  });
  await waitFor(() =>
    expect(view.result.current.activeThread?.id).toBe(first.id),
  );

  const gate = api.pauseNextList();
  act(() => void view.result.current.refresh());
  await gate.started;
  api.setActiveTenantId(202);
  act(() => window.dispatchEvent(new Event("savia:active-tenant-changed")));
  gate.release();

  await waitFor(() =>
    expect(view.result.current.activeThread?.id).toBe(second.id),
  );
  expect(api.detailGets).toEqual([first.id, second.id]);
});

it("restores a recording conversation on a different device", async () => {
  const api = server();
  const context = {
    kind: "recording" as const,
    id: "recording-1",
    title: "Planning",
  };
  const first = renderHook(() => useAssistantThreads(true, context), {
    wrapper: api.device(),
  });
  await waitFor(() => expect(first.result.current.activeThread).not.toBeNull());
  const id = first.result.current.activeThread!.id;
  await act(async () => {
    await first.result.current.save(id, messages);
  });
  first.unmount();
  const second = renderHook(() => useAssistantThreads(true, context), {
    wrapper: api.device(),
  });
  await waitFor(() =>
    expect(second.result.current.activeThread?.messages).toEqual(messages),
  );
  expect(second.result.current.activeThread?.id).toBe(id);
});
it("rejects a stale device save and leaves the remote messages intact", async () => {
  const api = server();
  const first = renderHook(() => useAssistantThreads(true), {
    wrapper: api.device(),
  });
  await waitFor(() => expect(first.result.current.activeThread).not.toBeNull());
  const second = renderHook(() => useAssistantThreads(true), {
    wrapper: api.device(),
  });
  await waitFor(() =>
    expect(second.result.current.activeThread).not.toBeNull(),
  );
  const id = first.result.current.activeThread!.id;
  await act(async () => {
    await first.result.current.save(id, messages);
  });
  await act(async () => {
    await expect(second.result.current.save(id, [])).rejects.toMatchObject({
      status: 409,
    });
  });
  expect(second.result.current.conflict).toBe(true);
  expect(api.threads.get(id)?.messages).toEqual(messages);
});
it("retries an unsaved question after reconnecting", async () => {
  const api = server();
  const view = renderHook(() => useAssistantThreads(true), {
    wrapper: api.device(),
  });
  await waitFor(() => expect(view.result.current.activeThread).not.toBeNull());
  const id = view.result.current.activeThread!.id;
  api.disconnect();
  await act(async () => {
    await expect(view.result.current.save(id, messages)).rejects.toThrow(
      "Offline",
    );
  });
  expect(view.result.current.error).toBeTruthy();
  api.reconnect();
  await act(async () => {
    await view.result.current.retry();
  });
  expect(api.threads.get(id)?.messages).toEqual(messages);
  expect(view.result.current.error).toBeNull();
});

it("loads the latest revision after conflict and clears the unsaved status", async () => {
  const api = server();
  const first = renderHook(() => useAssistantThreads(true), {
    wrapper: api.device(),
  });
  await waitFor(() => expect(first.result.current.activeThread).not.toBeNull());
  const second = renderHook(() => useAssistantThreads(true), {
    wrapper: api.device(),
  });
  await waitFor(() =>
    expect(second.result.current.activeThread).not.toBeNull(),
  );
  const id = first.result.current.activeThread!.id;
  await act(async () => {
    await first.result.current.save(id, messages);
  });
  await act(async () => {
    await expect(second.result.current.save(id, [])).rejects.toMatchObject({
      status: 409,
    });
  });
  await act(async () => {
    await second.result.current.refresh(true);
  });
  expect(second.result.current.activeThread?.messages).toEqual(messages);
  expect(second.result.current.saving).toBe(false);
  expect(second.result.current.error).toBeNull();
});
