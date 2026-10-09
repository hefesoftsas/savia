import { describe, expect, it } from "vitest";
import { readKey } from "./query-keys";
import { createAdminQueryClient } from "./query-policy";

describe("createAdminQueryClient", () => {
  it("preserves the shared admin query and mutation defaults", () => {
    const client = createAdminQueryClient();
    const defaults = client.getDefaultOptions();

    expect(defaults.queries).toMatchObject({
      networkMode: "always",
      retry: 1,
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
    });
    expect(defaults.mutations).toMatchObject({
      networkMode: "always",
      retry: false,
    });
  });

  it("shares one in-flight read for identical scoped keys", async () => {
    const client = createAdminQueryClient();
    const queryKey = readKey(
      { sessionGeneration: 1, kind: "tenant", id: "tenant-2" },
      "records",
      { page: 1 },
    );
    let resolveRead: ((value: string[]) => void) | undefined;
    let calls = 0;
    const queryFn = () => {
      calls += 1;
      return new Promise<string[]>((resolve) => {
        resolveRead = resolve;
      });
    };

    const first = client.fetchQuery({ queryKey, queryFn });
    const second = client.fetchQuery({ queryKey: [...queryKey], queryFn });
    expect(calls).toBe(1);

    resolveRead?.([]);
    await expect(Promise.all([first, second])).resolves.toEqual([[], []]);
  });
});
