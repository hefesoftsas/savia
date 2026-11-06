const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export class CalendarCipherUnavailableError extends Error {
  constructor() {
    super("Personal calendar encryption is unavailable");
    this.name = "CalendarCipherUnavailableError";
  }
}

function encode(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
}

function decode(value: string): Uint8Array<ArrayBuffer> {
  try {
    return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  } catch {
    throw new CalendarCipherUnavailableError();
  }
}

export class CalendarCipher {
  private readonly key: Promise<CryptoKey> | undefined;

  constructor(secret?: string) {
    const trimmed = secret?.trim();
    if (trimmed) {
      this.key = crypto.subtle
        .digest(
          "SHA-256",
          encoder.encode(`savia/personal-calendars/v1/${trimmed}`),
        )
        .then((material) =>
          crypto.subtle.importKey("raw", material, { name: "AES-GCM" }, false, [
            "encrypt",
            "decrypt",
          ]),
        );
    }
  }

  ensureAvailable(): void {
    if (!this.key) throw new CalendarCipherUnavailableError();
  }

  async seal(
    principalId: string,
    sourceId: string,
    value: string,
  ): Promise<string> {
    if (!this.key) throw new CalendarCipherUnavailableError();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: this.aad(principalId, sourceId) },
      await this.key,
      encoder.encode(value),
    );
    return `${encode(iv)}.${encode(new Uint8Array(ciphertext))}`;
  }

  async open(
    principalId: string,
    sourceId: string,
    sealed: string,
  ): Promise<string> {
    if (!this.key) throw new CalendarCipherUnavailableError();
    try {
      const [iv, ciphertext, ...rest] = sealed.split(".");
      if (!iv || !ciphertext || rest.length)
        throw new Error("invalid envelope");
      const plaintext = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: decode(iv),
          additionalData: this.aad(principalId, sourceId),
        },
        await this.key,
        decode(ciphertext),
      );
      return decoder.decode(plaintext);
    } catch {
      throw new CalendarCipherUnavailableError();
    }
  }

  private aad(principalId: string, sourceId: string): Uint8Array<ArrayBuffer> {
    return encoder.encode(
      `savia/personal-calendars/v1/${principalId}/${sourceId}`,
    );
  }
}
