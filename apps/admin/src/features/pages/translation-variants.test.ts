import { describe, expect, it } from "vitest";
import { translationVariants } from "./translation-variants";

describe("translationVariants", () => {
  it("recognizes bold headings and same-line translations", () => {
    expect(
      translationVariants(
        "1. **Regular translation:** Hello\n2. **Professional but friendly translation:** Hello there\n3. **Concise professional but friendly translation:** Hi",
      ),
    ).toEqual(["Hello", "Hello there", "Hi"]);
  });
  it("preserves multiline text and Markdown within each translation", () => {
    expect(
      translationVariants(
        "### 1. Regular translation\nHello\n\n**World**\n### 2. Professional but friendly translation\nGood morning\n### 3. Concise professional but friendly translation\nHi",
      ),
    ).toEqual(["Hello\n\n**World**", "Good morning", "Hi"]);
  });
  it("does not interpret arbitrary numbered responses, incomplete variants, or prose as translations", () => {
    for (const value of [
      "1. First\n2. Second\n3. Third",
      "1. Regular translation\nHello",
      "Here are the translations:\n1. Regular translation\nHello\n2. Professional but friendly translation\nHello\n3. Concise professional but friendly translation\nHi",
    ])
      expect(translationVariants(value)).toBeNull();
  });
});
