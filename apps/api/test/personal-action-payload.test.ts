import { describe, expect, it } from "vitest";
import {
  PersonalActionPayloadCipher,
  PersonalActionPayloadUnavailableError,
} from "../src/assistant/personal-action-payload";

describe("PersonalActionPayloadCipher", () => {
  it("seals an action payload to its principal and action identifier", async () => {
    const cipher = new PersonalActionPayloadCipher("test-shared-secret");
    const payload = {
      provider: "gmail",
      to: ["recipient@example.com"],
      body: "Sensitive renewal details.",
    };
    const sealedPayload = await cipher.seal({
      actionId: "action-1",
      principalId: "principal-1",
      payload,
    });

    expect(sealedPayload).not.toContain(payload.body);
    await expect(
      cipher.unseal({
        actionId: "action-1",
        principalId: "principal-1",
        storedInput: { sealedPayload },
      }),
    ).resolves.toEqual(payload);
    await expect(
      cipher.unseal({
        actionId: "action-1",
        principalId: "other-principal",
        storedInput: { sealedPayload },
      }),
    ).rejects.toBeInstanceOf(PersonalActionPayloadUnavailableError);
  });
});
