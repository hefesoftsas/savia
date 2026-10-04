import { describe, expect, it } from "vitest";
import { createTranslationEmployeeTemplate } from "./translation-employee-template";

describe("Spanish to English translator template", () => {
  it("creates an active text-only employee with the requested translation styles", () => {
    const template = createTranslationEmployeeTemplate();

    expect(template).toMatchObject({
      name: "Traductor español → inglés",
      handle: "traductor",
      allowedCollections: [],
      model: null,
      status: "active",
    });
    expect(template.systemPrompt).toContain("1. Regular translation");
    expect(template.systemPrompt).toContain(
      "2. Professional but friendly translation",
    );
    expect(template.systemPrompt).toContain(
      "3. Concise professional but friendly translation",
    );
    expect(template.systemPrompt).toMatch(/three versions every time/i);
    expect(template.systemPrompt).toMatch(/return all three versions/i);
    expect(template.systemPrompt).toMatch(/filler/i);
    expect(template.systemPrompt).toMatch(/ask.*clarification/i);
  });

  it("returns fresh scope arrays for separate drafts", () => {
    const first = createTranslationEmployeeTemplate();
    const second = createTranslationEmployeeTemplate();

    first.allowedCollections?.push("customers");

    expect(second.allowedCollections).toEqual([]);
  });
});
