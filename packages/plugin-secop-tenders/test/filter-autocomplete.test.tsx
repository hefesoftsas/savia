import { describe, expect, it } from "vitest";
import { filterAutocompleteOptions } from "../filter-autocomplete";

describe("filterAutocompleteOptions", () => {
  it("matches without case or accent differences while retaining distinct provider values", () => {
    expect(
      filterAutocompleteOptions(
        ["Bogotá D.C.", "Bogota D.C.", "Medellín", "Cali", "Bogotá D.C."],
        "BOGOTA",
      ),
    ).toEqual(["Bogotá D.C.", "Bogota D.C."]);
  });

  it("returns unique options in their original order for an empty query", () => {
    expect(filterAutocompleteOptions(["A", "B", "A"], "  ")).toEqual([
      "A",
      "B",
    ]);
  });
});
