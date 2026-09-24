import { it, expect } from "vitest";
import { officeEditorUrl } from "../../office/office-api";
it("allows only tenant and platform API bases, never external URLs", () => {
  expect(officeEditorUrl("/v1/dynamic-crm/12", "file-1")).toBe(
    "/office/?base=%2Fv1%2Fdynamic-crm%2F12&file=file-1",
  );
  expect(officeEditorUrl("/v1/studio/12", "file-1")).toBe(
    "/office/?base=%2Fv1%2Fstudio%2F12&file=file-1",
  );
  expect(officeEditorUrl("/v1/data-domains/platform", "file-1")).toContain(
    "/office/",
  );
  for (const base of [
    "https://evil.test",
    "//evil.test",
    "/v1/data-domains/../../auth",
    "/api/auth",
    "",
  ])
    expect(officeEditorUrl(base, "file-1")).toBeNull();
});
