import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { insurancePortfolioExtensionManifest } from "../src/manifest";

describe("release manifest", () => {
  it("keeps the ZIP manifest identical to the release-bundled manifest", () => {
    const zipManifest = JSON.parse(
      readFileSync(new URL("../savia-extension.json", import.meta.url), "utf8"),
    );

    expect(zipManifest).toEqual(insurancePortfolioExtensionManifest);
  });
});
