import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@/api/api-client";
import { useIssueProviders } from "./use-issue-providers";

function fixture() {
  let status = "connected";
  let availability = "enabled";
  let githubAvailability = "enabled";
  const get = vi.fn(async (path: string) => ({
    data: path.endsWith("/providers")
      ? [
          { id: "jira", attributes: { availability } },
          { id: "linear", attributes: { availability: "enabled" } },
          { id: "github", attributes: { availability: githubAvailability } },
        ]
      : [
          { id: "connection-1", attributes: { provider: "jira", status } },
          { id: "connection-2", attributes: { provider: "github", status } },
        ],
  }));
  return {
    api: { get } as unknown as ApiClient,
    get,
    setStatus: (value: string) => {
      status = value;
    },
    setAvailability: (value: string) => {
      availability = value;
    },
    setGithubAvailability: (value: string) => {
      githubAvailability = value;
    },
  };
}

describe("page issue provider visibility", () => {
  it("only offers an enabled provider with the current reader's active connection", async () => {
    const source = fixture();
    const { result } = renderHook(() => useIssueProviders(source.api));
    expect(result.current).toEqual([]);
    await waitFor(() => expect(result.current).toEqual(["jira", "github"]));
  });

  it.each(["pending", "reconnect_required", "disconnected", "failed"])(
    "does not offer a %s connection",
    async (status) => {
      const source = fixture();
      source.setStatus(status);
      const { result } = renderHook(() => useIssueProviders(source.api));
      await act(async () => {});
      expect(result.current).toEqual([]);
    },
  );

  it("hides Jira but keeps GitHub when only Jira server configuration is unavailable", async () => {
    const source = fixture();
    source.setAvailability("unavailable");
    const { result } = renderHook(() => useIssueProviders(source.api));
    await act(async () => {});
    expect(result.current).toEqual(["github"]);
  });

  it("hides GitHub if its server configuration is unavailable", async () => {
    const source = fixture();
    source.setGithubAvailability("unavailable");
    const { result } = renderHook(() => useIssueProviders(source.api));
    await act(async () => {});
    expect(result.current).toEqual(["jira"]);
  });

  it("rechecks after disconnect and on returning to the app", async () => {
    const source = fixture();
    const { result } = renderHook(() => useIssueProviders(source.api));
    await waitFor(() => expect(result.current).toEqual(["jira", "github"]));
    source.setStatus("disconnected");
    await act(async () =>
      window.dispatchEvent(new Event("savia:personal-integrations-changed")),
    );
    expect(result.current).toEqual([]);
    source.setStatus("connected");
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(result.current).toEqual(["jira", "github"]);
  });

  it("fails closed when refreshing connections fails", async () => {
    const source = fixture();
    const { result } = renderHook(() => useIssueProviders(source.api));
    await waitFor(() => expect(result.current).toEqual(["jira", "github"]));
    source.get.mockRejectedValue(new Error("Unavailable"));
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(result.current).toEqual([]);
  });

  it("does not apply an old request after the session is cleared", async () => {
    const resolves: Array<(value: unknown) => void> = [];
    const get = vi.fn(
      () =>
        new Promise((done) => {
          resolves.push(done);
        }),
    );
    const api = { get } as unknown as ApiClient;
    const { result } = renderHook(() => useIssueProviders(api));
    await act(async () =>
      window.dispatchEvent(new Event("savia:session-cleared")),
    );
    await act(async () => {
      resolves[0]({
        data: [{ id: "jira", attributes: { availability: "enabled" } }],
      });
      resolves[1]({
        data: [
          { id: "c1", attributes: { provider: "jira", status: "connected" } },
        ],
      });
    });
    expect(result.current).toEqual([]);
  });

  it("preserves active providers during background revalidation without wiping to empty", async () => {
    let resolvePending: ((value: any) => void) | undefined;
    const source = fixture();
    const { result } = renderHook(() => useIssueProviders(source.api));
    await waitFor(() => expect(result.current).toEqual(["jira", "github"]));

    source.get.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePending = resolve;
        }),
    );

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    // While inflight, active providers MUST NOT be wiped out to []
    expect(result.current).toEqual(["jira", "github"]);

    // Now resolve
    await act(async () => {
      resolvePending!({
        data: [{ id: "jira", attributes: { availability: "enabled" } }],
      });
    });
  });
});
