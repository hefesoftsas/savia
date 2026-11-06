import { describe, expect, it } from "vitest";
import {
  isStudioLocation,
  STUDIO_LEGACY_PATH,
  STUDIO_PATH,
} from "./studio-route";

describe("studio route", () => {
  it("uses /studio as the canonical path with /crm as legacy alias", () => {
    expect(STUDIO_PATH).toBe("/studio");
    expect(STUDIO_LEGACY_PATH).toBe("/crm");
    expect(isStudioLocation("/studio")).toBe(true);
    expect(isStudioLocation("/crm")).toBe(true);
  });

  it("does not match unrelated paths", () => {
    expect(isStudioLocation("/")).toBe(false);
    expect(isStudioLocation("/my-day")).toBe(false);
    expect(isStudioLocation("/crm-connections")).toBe(false);
    expect(isStudioLocation("/my-integrations")).toBe(false);
  });
});
