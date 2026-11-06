import { localizedOperationError } from "./capture-errors";
import { native } from "./client";

export type SavedCredential = { origin: string; token: string };

export async function saveCredential(saved: SavedCredential): Promise<void> {
  try {
    await native<void>("credential_save", saved);
    // A successful write is not enough: verify with a fresh native keychain
    // entry before telling the user the credential is remembered.
    const stored = await native<SavedCredential | null>("credential_load");
    if (stored?.origin !== saved.origin || stored.token !== saved.token) {
      throw new Error("Credential read-back did not match");
    }
  } catch {
    throw localizedOperationError(
      "Unable to save the credential on this device.",
    );
  }
}

export async function loadCredential(): Promise<SavedCredential | null> {
  try {
    return await native<SavedCredential | null>("credential_load");
  } catch {
    throw localizedOperationError(
      "Unable to read the saved credential. Check access to the system keychain and try again.",
    );
  }
}
