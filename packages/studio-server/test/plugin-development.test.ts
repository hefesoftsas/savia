import { expect, it, vi } from "vitest";
import { handlePluginDevelopment } from "../../../scripts/plugin-development/handler";

const key = "local-development-test-key";
function request(
  path: string,
  headers: Record<string, string> = {},
  method = "POST",
) {
  return new Request(`http://127.0.0.1:8787${path}`, { method, headers });
}
it("rejects remote, unconfigured, browser-origin and unauthorized access before touching storage", async () => {
  const prepare = vi.fn();
  const DB = { prepare } as unknown as D1Database;
  for (const [req, secret, status] of [
    [new Request("https://preview.test/__dev/plugins/install"), key, 404],
    [request("/__dev/plugins/install"), undefined, 404],
    [request("/__dev/plugins/install"), key, 401],
    [
      request("/__dev/plugins/install", {
        authorization: `Bearer ${key}`,
        origin: "null",
      }),
      key,
      401,
    ],
  ] as const)
    expect(
      (await handlePluginDevelopment(req, { DB, SAVIA_PLUGIN_DEV_KEY: secret }))
        .status,
    ).toBe(status);
  expect(prepare).not.toHaveBeenCalled();
});
it("exposes a local authenticated health check and validates tenant before upload", async () => {
  const first = vi.fn().mockResolvedValue(null),
    bind = vi.fn(() => ({ first })),
    prepare = vi.fn(() => ({ bind }));
  const env = {
    DB: { prepare } as unknown as D1Database,
    SAVIA_PLUGIN_DEV_KEY: key,
  };
  const headers = { authorization: `Bearer ${key}` };
  expect(
    await (
      await handlePluginDevelopment(
        request("/__dev/plugins/health", headers, "GET"),
        env,
      )
    ).json(),
  ).toEqual({ development: true });
  expect(
    (
      await handlePluginDevelopment(
        request("/__dev/plugins/install?tenant=../0", headers),
        env,
      )
    ).status,
  ).toBe(400);
  expect(prepare).not.toHaveBeenCalled();
  expect(
    (
      await handlePluginDevelopment(
        request("/__dev/plugins/install?tenant=0", headers),
        env,
      )
    ).status,
  ).toBe(404);
  expect(bind).toHaveBeenCalledWith(0);
});
