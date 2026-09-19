import { expect, it } from "vitest";
import {
  brandingForeground,
  defaultTenantBranding,
  parseTenantBranding,
} from "../src/branding";
it("only accepts the public identity and owned asset URL shape", () => {
  const value = defaultTenantBranding("Agency");
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
it("chooses contrast for both light and dark brand colors", () => {
  expect(brandingForeground("#ffffff")).toBe("#000000");
  expect(brandingForeground("#000000")).toBe("#ffffff");
  expect(brandingForeground("#ffff00")).toBe("#000000");
});
