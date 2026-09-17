const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class PersonalActionPayloadUnavailableError extends Error {
  constructor() {
    super("The confirmed personal action payload is unavailable");
    this.name = "PersonalActionPayloadUnavailableError";
  }
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  try {
    const binary = atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new PersonalActionPayloadUnavailableError();
  }
}

function actionAad(
  actionId: string,
  principalId: string,
): Uint8Array<ArrayBuffer> {
  return encoder.encode(`savia/personal-action/v1/${principalId}/${actionId}`);
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new PersonalActionPayloadUnavailableError();
  return value as Record<string, unknown>;
}

export class PersonalActionPayloadCipher {
  private readonly cryptoKey: Promise<CryptoKey>;

  constructor(secret: string) {
    this.cryptoKey = crypto.subtle
      .digest("SHA-256", encoder.encode(`savia/personal-action/${secret}`))
      .then((keyMaterial) =>
        crypto.subtle.importKey(
          "raw",
          keyMaterial,
          { name: "AES-GCM" },
          false,
          ["encrypt", "decrypt"],
        ),
      );
  }

  async seal(input: {
    actionId: string;
    principalId: string;
    payload: Record<string, unknown>;
  }): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: actionAad(input.actionId, input.principalId),
      },
      await this.cryptoKey,
      encoder.encode(JSON.stringify(input.payload)),
    );
    return `${encodeBase64(iv)}.${encodeBase64(new Uint8Array(ciphertext))}`;
  }

  async unseal(input: {
    actionId: string;
    principalId: string;
    storedInput: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    const sealedPayload = input.storedInput.sealedPayload;
    if (typeof sealedPayload !== "string")
      throw new PersonalActionPayloadUnavailableError();
    const [iv, ciphertext, ...unexpected] = sealedPayload.split(".");
    if (!iv || !ciphertext || unexpected.length > 0)
      throw new PersonalActionPayloadUnavailableError();
    try {
      const cleartext = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: decodeBase64(iv),
          additionalData: actionAad(input.actionId, input.principalId),
        },
        await this.cryptoKey,
        decodeBase64(ciphertext),
      );
      return record(JSON.parse(decoder.decode(cleartext)));
    } catch (error) {
      if (error instanceof PersonalActionPayloadUnavailableError) throw error;
      throw new PersonalActionPayloadUnavailableError();
    }
  }
}
