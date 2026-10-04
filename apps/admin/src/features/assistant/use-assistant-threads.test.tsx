import { act, renderHook, waitFor, cleanup } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { PropsWithChildren } from "react";
import type { AppServices } from "@/app-services";
import { ApiClient } from "@/api/api-client";
import { AppServicesProvider } from "./assistant-context";
import { useAssistantThreads } from "./use-assistant-threads";
import type { SyncedThread } from "./assistant-threads-client";
afterEach(cleanup);
function server() {
  const threads = new Map<string, SyncedThread>();
  let offline = false;
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
            revision: (current?.revision ?? 0) + 1,
            createdAt: "2026-10-04T00:00:00Z",
            updatedAt: new Date().toISOString(),
          };
          threads.set(id, next);
          return Response.json(next);
        }
        return Response.json({ threads: [...threads.values()] });
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
