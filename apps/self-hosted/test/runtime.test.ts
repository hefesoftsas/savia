import { expect, it } from "vitest";
import { loadConfiguration } from "../src/config";
import { createRateLimiter } from "../src/rate-limit";

const environment = {
  SAVIA_PUBLIC_ORIGIN: "http://localhost:8080",
  SAVIA_AUTH_SECRET: "a".repeat(64),
  SAVIA_ENCRYPTION_KEY: "b".repeat(64),
  SAVIA_CAPTCHA_SECRET: "c".repeat(64),
  S3_ENDPOINT: "http://storage:8333",
  S3_PUBLIC_ENDPOINT: "http://localhost:8333",
  S3_ACCESS_KEY_ID: "local-access",
  S3_SECRET_ACCESS_KEY: "s".repeat(40),
};
it("requires explicit secrets and a valid public origin", () => {
  expect(() => loadConfiguration({})).toThrow(/SAVIA_PUBLIC_ORIGIN/);
  expect(() =>
    loadConfiguration({ ...environment, SAVIA_AUTH_SECRET: "short" }),
  ).toThrow(/SAVIA_AUTH_SECRET/);
  expect(() =>
    loadConfiguration({
      ...environment,
      SAVIA_PUBLIC_ORIGIN: "https://user:pass@host",
    }),
  ).toThrow(/origin/i);
  expect(loadConfiguration(environment).publicOrigin).toBe(
    "http://localhost:8080",
  );
});
it("limits requests per principal with bounded expiry without external services", async () => {
  let now = 0;
  const limiter = createRateLimiter({
    limit: 2,
    periodMs: 1000,
    now: () => now,
  });
  expect(await limiter.limit({ key: "a" })).toEqual({ success: true });
  expect(await limiter.limit({ key: "a" })).toEqual({ success: true });
  expect(await limiter.limit({ key: "a" })).toEqual({ success: false });
  expect(await limiter.limit({ key: "b" })).toEqual({ success: true });
  now = 1001;
  expect(await limiter.limit({ key: "a" })).toEqual({ success: true });
});
it("imports shared API and auth handlers in Node without Worker-only modules", async () => {
  const api = await import("../../api/src/runtime");
  const auth = await import("../../auth/src/index");
  expect(api.createApiRuntime).toBeTypeOf("function");
  expect(auth.createAuthHandler).toBeTypeOf("function");
});

it("rejects invalid or mixed-content public object storage origins", () => {
  expect(() =>
    loadConfiguration({
      ...environment,
      S3_PUBLIC_ENDPOINT: "ftp://files.example.com",
    }),
  ).toThrow(/S3_PUBLIC_ENDPOINT/);
  expect(() =>
    loadConfiguration({
      ...environment,
      S3_ENDPOINT: "http://user:pass@storage",
    }),
  ).toThrow(/S3_ENDPOINT/);
  expect(() =>
    loadConfiguration({
      ...environment,
      SAVIA_PUBLIC_ORIGIN: "https://savia.example.com",
    }),
  ).toThrow(/HTTPS/);
});
