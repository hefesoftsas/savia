import { describe, expect, it, vi } from "vitest";
import {
  createWhatsappMediaInput,
  cleanupWhatsappMedia,
} from "../src/whatsapp/media-input";
import { defaultNativeConfiguration } from "../src/whatsapp/native";
import type {
  WhatsappAssistantBinding,
  WhatsappInboundInput,
} from "../src/whatsapp/inbound-contracts";
import type { EffectiveAssistantConfiguration } from "../src/assistant/configuration";
import type { WhatsappNangoClient } from "../src/whatsapp/contracts";
import type { CompanionService } from "../src/companion/service";
vi.mock("../src/whatsapp/media", () => ({ fetchWhatsappMedia: vi.fn() }));
import { fetchWhatsappMedia } from "../src/whatsapp/media";
const binding = {
  tenantId: 7,
  connectionId: "tenant-connection",
  native: { ...defaultNativeConfiguration, mediaUnderstanding: true },
} as WhatsappAssistantBinding;
const input: WhatsappInboundInput = {
  phoneNumberId: "123456789",
  wabaId: "987654321",
  messageId: "message",
  contactPhone: "573001234567",
  timestamp: "2026-10-05T12:00:00Z",
  text: "Contact sent audio",
  native: {
    kind: "media",
    mediaType: "audio",
    mediaId: "123456789",
    mimeType: "audio/ogg",
  },
};
const configuration = {} as EffectiveAssistantConfiguration;
function setup() {
  const bucket = {
    put: vi.fn(),
    list: vi.fn(),
    delete: vi.fn(),
  } as unknown as R2Bucket;
  const companion = {
    transcribeRecording: vi
      .fn()
      .mockResolvedValue({ text: "My plate is TESTCAR" }),
  } as unknown as CompanionService;
  return {
    bucket,
    companion,
    prepare: createWhatsappMediaInput(
      {} as WhatsappNangoClient,
      bucket,
      companion,
    ),
  };
}
describe("private WhatsApp media preparation", () => {
  it("includes choice IDs and context without treating them as action authorization", async () => {
    const s = setup();
    const result = await s.prepare(
      binding,
      {
        ...input,
        text: "Confirm",
        native: {
          kind: "choice",
          choiceType: "button",
          id: "quote",
          title: "Confirm",
          contextMessageId: "previous",
        },
      },
      configuration,
    );
    expect(result.text).toContain('"id":"quote"');
    expect(result.text).toContain("conversation context only");
    expect(s.bucket.put).not.toHaveBeenCalled();
  });
  it("does not download disabled media and explicitly tells the assistant it was not inspected", async () => {
    vi.mocked(fetchWhatsappMedia).mockClear();
    const s = setup();
    const result = await s.prepare(
      { ...binding, native: defaultNativeConfiguration },
      input,
      configuration,
    );
    expect(result.text).toContain("not inspected");
    expect(fetchWhatsappMedia).not.toHaveBeenCalled();
    expect(s.bucket.put).not.toHaveBeenCalled();
  });
  it("stores verified audio privately under tenant scope and reuses imported transcription", async () => {
    const data = new Uint8Array([1, 2, 3]);
    vi.mocked(fetchWhatsappMedia).mockResolvedValue({
      data,
      mimeType: "audio/ogg",
      sha256: "checksum",
    });
    const s = setup();
    expect((await s.prepare(binding, input, configuration)).text).toContain(
      "TESTCAR",
    );
    expect(s.bucket.put).toHaveBeenCalledWith(
      expect.stringMatching(
        /^whatsapp\/inbound\/\d{4}-\d{2}-\d{2}\/7\/[a-f0-9]{64}$/,
      ),
      data,
      expect.objectContaining({
        customMetadata: { tenantId: "7", sha256: "checksum" },
      }),
    );
    expect(s.companion.transcribeRecording).toHaveBeenCalledWith(
      configuration,
      { bytes: data, format: "ogg", source: "upload", durationSeconds: null },
    );
  });
  it("uses separate storage keys for a different tenant connection", async () => {
    vi.mocked(fetchWhatsappMedia).mockResolvedValue({
      data: new Uint8Array([1]),
      mimeType: "application/pdf",
      sha256: "checksum",
    });
    const s = setup();
    const first = await s.prepare(binding, input, configuration);
    await s.prepare(
      { ...binding, tenantId: 8, connectionId: "other-connection" },
      input,
      configuration,
    );
    const calls = vi.mocked(s.bucket.put).mock.calls;
    expect(calls[0][0]).not.toBe(calls[1][0]);
    expect(first.attachments?.[0].type).toBe("file");
  });
  it("deletes only date-prefixed media beyond seven days", async () => {
    const s = setup();
    vi.mocked(s.bucket.list).mockResolvedValue({
      objects: [
        { key: "whatsapp/inbound/2026-09-25/7/old" },
        {
          key: "whatsapp/inbound/2026-10-05/7/new",
          uploaded: new Date("2026-10-05T10:00:00Z"),
        },
        {
          key: "whatsapp/inbound/2026-09-25/7/rewritten",
          uploaded: new Date("2026-10-04T10:00:00Z"),
        },
        { key: "whatsapp/inbound/invalid" },
      ],
    } as R2Objects);
    await cleanupWhatsappMedia(s.bucket, Date.parse("2026-10-05T12:00:00Z"));
    expect(s.bucket.delete).toHaveBeenCalledWith([
      "whatsapp/inbound/2026-09-25/7/old",
    ]);
  });
});
