import { describe, expect, it } from "vitest";

import { toSchemaName } from "./schema-fields";

describe("toSchemaName", () => {
  it("trims long underscore runs without losing the identifier", () => {
    const name = `${"_".repeat(100_000)}safe${"_".repeat(100_000)}`;

    expect(toSchemaName(name)).toBe("safe");
  });

  it("uses the fallback when a name contains only underscores", () => {
    expect(toSchemaName("_".repeat(100_000))).toBe("schema");
  });

  it("collapses invalid runs while preserving valid underscores", () => {
    expect(toSchemaName(" My ___ schema! ")).toBe("My_____schema");
  });
});
