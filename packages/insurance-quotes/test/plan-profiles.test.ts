import { describe, expect, it } from "vitest";
import { defaultProfiles, publicPlanHighlights } from "../src/plan-profiles";

describe("public plan highlights", () => {
  it("exposes static catalog bullets without live provider data", () => {
    expect(publicPlanHighlights("sbs-producto-8")).toContain(
      "Responsabilidad Civil: $3.000 Millones",
    );
    expect(publicPlanHighlights("no-such-flow")).toEqual([
      "Póliza todo riesgo autos",
    ]);
  });

  it("returns a copy so callers cannot mutate the catalog", () => {
    const highlights = publicPlanHighlights("sbs-producto-8");
    highlights.push("mutated");
    expect(publicPlanHighlights("sbs-producto-8")).not.toContain("mutated");
  });

  it("keeps every profile usable as public bullets", () => {
    for (const [id, profile] of Object.entries(defaultProfiles)) {
      expect(publicPlanHighlights(id)).toEqual(profile.highlights);
      for (const bullet of publicPlanHighlights(id)) {
        expect(bullet.length).toBeGreaterThan(0);
        expect(JSON.stringify(bullet)).not.toMatch(
          /password|secret|credential|documento/i,
        );
      }
    }
  });
});
