import { describe, expect, it } from "vitest";
import {
  CalendarCipher,
  CalendarCipherUnavailableError,
} from "../src/personal-calendars/cipher";

describe("CalendarCipher", () => {
  it("binds encrypted payloads to both principal and source IDs", async () => {
    const cipher = new CalendarCipher("a sufficiently long shared test secret");
    const sealed = await cipher.seal(
      "principal-a",
      "source-a",
      "secret feed content",
    );

    await expect(cipher.open("principal-a", "source-a", sealed)).resolves.toBe(
      "secret feed content",
    );
    await expect(
      cipher.open("principal-b", "source-a", sealed),
    ).rejects.toBeInstanceOf(CalendarCipherUnavailableError);
    await expect(
      cipher.open("principal-a", "source-b", sealed),
    ).rejects.toBeInstanceOf(CalendarCipherUnavailableError);
  });

  it("refuses to encrypt when the configured secret is absent", async () => {
    const cipher = new CalendarCipher(undefined);
    await expect(
      cipher.seal("principal-a", "source-a", "private"),
    ).rejects.toBeInstanceOf(CalendarCipherUnavailableError);
  });
});
