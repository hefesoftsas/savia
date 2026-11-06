import { describe, expect, it } from "vitest";

import { normalizeSubject } from "./support-utils";

describe("normalizeSubject", () => {
  it("removes reply prefixes across long whitespace runs", () => {
    const subject = `Re${"\t".repeat(100_000)}:  FWD: Subject`;

    expect(normalizeSubject(subject)).toBe("Subject");
  });

  it("keeps numbered and repeated mail-client prefixes working", () => {
    expect(normalizeSubject("Fwd [2]: fw: Re: Subject")).toBe("Subject");
  });
});
