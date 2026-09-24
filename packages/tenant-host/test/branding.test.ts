import { expect, it } from "vitest";
import {
  brandingForeground,
  defaultTenantBranding,
  parseTenantBranding,
} from "../src/branding";
it("only accepts the public identity and owned asset URL shape", () => {
  const value = defaultTenantBranding("Agency");
  expect(value.loginAnimationUrl).toBeNull();
  expect(parseTenantBranding(JSON.stringify(value))).toEqual(value);
  expect(parseTenantBranding({ ...value, secret: "hidden" })).toBeNull();
  expect(
    parseTenantBranding({ ...value, primaryColor: "red;display:none" }),
  ).toBeNull();
  expect(
    parseTenantBranding({
      ...value,
      logoUrl: "https://external.example/track",
    }),
  ).toBeNull();
  expect(
    parseTenantBranding({
      ...value,
      logoUrl:
        "/api/public/tenant-branding/assets/1/12345678-1234-4234-8234-123456789012",
    }),
  ).not.toBeNull();
});
it("accepts owned login animation URLs and defaults legacy records", () => {
  const value = defaultTenantBranding("Agency");
  const animation =
    "/api/public/tenant-branding/assets/1/12345678-1234-4234-8234-123456789012";
  expect(
    parseTenantBranding({ ...value, loginAnimationUrl: animation }),
  ).toEqual({ ...value, loginAnimationUrl: animation });
  const { loginAnimationUrl, ...legacy } = value;
  expect(parseTenantBranding(legacy)).toEqual(value);
  expect(
    parseTenantBranding({
      ...value,
      loginAnimationUrl: "https://evil.example/a.json",
    }),
  ).toBeNull();
  expect(
    parseTenantBranding({
      ...value,
      loginAnimationUrl: "/api/public/tenant-branding/assets/1/not-owned",
    }),
  ).toBeNull();
});
it("chooses contrast for both light and dark brand colors", () => {
  expect(brandingForeground("#ffffff")).toBe("#000000");
  expect(brandingForeground("#000000")).toBe("#ffffff");
  expect(brandingForeground("#ffff00")).toBe("#000000");
});
