import { expect, it } from "vitest";
import {
  createPublicLinkToken,
  isPublicLinkActive,
  normalizePublicLinkExpiry,
  publicLinkUrl,
} from "../src/public-links/lifecycle";

it("uses opaque lowercase 256-bit tokens for public links", () => {
  const token = createPublicLinkToken();

  expect(token).toMatch(/^[a-f0-9]{64}$/);
});

it("normalizes expiry timestamps and applies one active-link policy", () => {
  const now = Date.parse("2026-10-07T12:00:00.000Z");

  expect(normalizePublicLinkExpiry("2026-10-08T14:00:00+02:00", now)).toBe(
    "2026-10-08T12:00:00.000Z",
  );
  expect(isPublicLinkActive(null, null, now)).toBe(true);
  expect(isPublicLinkActive("2026-10-08T12:00:00.000Z", null, now)).toBe(true);
  expect(isPublicLinkActive("2026-10-07T11:59:59.999Z", null, now)).toBe(false);
  expect(
    isPublicLinkActive("2026-10-08T12:00:00.000Z", "2026-10-07T11:00:00Z", now),
  ).toBe(false);
  expect(() => normalizePublicLinkExpiry("not-a-date", now)).toThrow();
  expect(() =>
    normalizePublicLinkExpiry("2026-10-07T12:00:00.000Z", now),
  ).toThrow();
});

it("builds public-link URLs only from a clean origin and path", () => {
  expect(
    publicLinkUrl(
      "https://savia.example.test",
      "/public/quotes/" + "a".repeat(64),
    ),
  ).toBe(`https://savia.example.test/public/quotes/${"a".repeat(64)}`);
  expect(() =>
    publicLinkUrl("https://savia.example.test/private", "/public/forms/token"),
  ).toThrow();
  expect(() =>
    publicLinkUrl("https://savia.example.test", "//evil.example/path"),
  ).toThrow();
});
