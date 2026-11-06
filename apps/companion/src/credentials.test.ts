import { beforeEach, describe, expect, it, vi } from "vitest";
import { operationErrorMessage } from "./capture-errors";
import { native } from "./client";
import { loadCredential, saveCredential } from "./credentials";

vi.mock("./client", () => ({ native: vi.fn() }));
const invoke = vi.mocked(native);
const saved = {
  origin: "https://savia.example",
  token: "savia_pat_test_credential",
};

beforeEach(() => {
  invoke.mockReset();
});

describe("remembered credentials", () => {
  it("does not report a successful save when a fresh read cannot find the key", async () => {
    invoke.mockImplementation(async (command) => {
      if (command === "credential_save") return undefined;
      if (command === "credential_load") return null;
      throw new Error("Unexpected command");
    });
    const error = await saveCredential(saved).catch((error) => error);
    expect(operationErrorMessage(error).key).toBe(
      "Unable to save the credential on this device.",
    );
  });

  it("rejects a save that reads back a different credential", async () => {
    invoke.mockImplementation(async (command) => {
      if (command === "credential_save") return undefined;
      return { ...saved, token: "savia_pat_previous" };
    });
    await expect(saveCredential(saved)).rejects.toThrow();
  });

  it("confirms a credential only after the keychain reads it back", async () => {
    let stored: unknown = null;
    invoke.mockImplementation(async (command, args) => {
      if (command === "credential_save") {
        stored = args;
        return undefined;
      }
      if (command === "credential_load") return stored;
      throw new Error("Unexpected command");
    });
    await expect(saveCredential(saved)).resolves.toBeUndefined();
    await expect(loadCredential()).resolves.toEqual(saved);
  });

  it("reports read failures without disclosing native error details", async () => {
    invoke.mockRejectedValue(new Error(`Keychain denied ${saved.token}`));
    const error = await loadCredential().catch((error) => error);
    expect(operationErrorMessage(error).key).toBe(
      "Unable to read the saved credential. Check access to the system keychain and try again.",
    );
    expect(String(error)).not.toContain(saved.token);
  });

  it("treats an empty keychain as first-time setup", async () => {
    invoke.mockResolvedValue(null);
    await expect(loadCredential()).resolves.toBeNull();
  });

  it("reports write failures without disclosing native error details", async () => {
    invoke.mockRejectedValue(new Error(`Keychain denied ${saved.token}`));
    const error = await saveCredential(saved).catch((error) => error);
    expect(operationErrorMessage(error).key).toBe(
      "Unable to save the credential on this device.",
    );
    expect(String(error)).not.toContain(saved.token);
  });
});
