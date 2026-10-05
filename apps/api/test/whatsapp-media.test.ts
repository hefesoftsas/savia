import { describe, expect, it, vi } from "vitest";
import type { WhatsappAssistantBinding } from "../src/whatsapp/inbound-contracts";
import type { NativeInbound } from "../src/whatsapp/native-input";
import { fetchWhatsappMedia, uploadWhatsappMedia } from "../src/whatsapp/media";

const binding: WhatsappAssistantBinding = {
  connectionId: "connection",
  tenantId: 7,
  employeeId: "employee",
  enabled: true,
  allowedContacts: ["573001234567"],
  updatedBy: "owner",
  ownerPrincipalId: "owner",
  connection: {
    id: "connection",
    agencyId: 7,
    provider: "whatsapp",
    status: "connected",
    phoneNumberId: "123456789",
    wabaId: "987654321",
    displayPhoneNumber: null,
    externalAccountLabel: null,
    lastValidatedAt: null,
    createdAt: "",
    updatedAt: "",
    nangoConnectionId: "tenant-connection",
    nangoIntegrationId: "whatsapp-business",
  },
};

const media: Extract<NativeInbound, { kind: "media" }> = {
  kind: "media",
  mediaType: "image",
  mediaId: "123456789012345",
  mimeType: "image/jpeg",
};
const attachmentUrl =
  "https://lookaside.fbsbx.com/whatsapp_business/attachments/abc?token=opaque";

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return btoa(String.fromCharCode(...digest));
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function jpegBytes() {
  return new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02, 0xff, 0xd9]);
}

async function downloadNango(
  options: {
    url?: string;
    metadata?: Record<string, unknown>;
    download?: Response;
  } = {},
) {
  const bytes = jpegBytes();
  const metadata = {
    url: options.url ?? attachmentUrl,
    file_size: bytes.byteLength,
    mime_type: "image/jpeg",
    sha256: await sha256(bytes),
    ...options.metadata,
  };
  const proxy = vi
    .fn()
    .mockResolvedValueOnce(Response.json(metadata))
    .mockResolvedValueOnce(
      options.download ??
        new Response(bytes, {
          headers: {
            "content-type": "image/jpeg",
            "content-length": String(bytes.byteLength),
          },
        }),
    );
  return { proxy, bytes, metadata, nango: { proxy } };
}

describe("WhatsApp media download", () => {
  it("gets attachment metadata by tenant phone number, downloads through the fixed Meta host, and verifies the media", async () => {
    const fixture = await downloadNango();
    const result = await fetchWhatsappMedia(fixture.nango, binding, media);

    expect(result).toEqual({
      data: fixture.bytes,
      mimeType: "image/jpeg",
      sha256: await sha256Hex(fixture.bytes),
    });
    expect(fixture.proxy.mock.calls.map(([request]) => request)).toEqual([
      {
        connection: binding.connection,
        method: "GET",
        path: "/v21.0/123456789012345?phone_number_id=123456789",
      },
      {
        connection: binding.connection,
        method: "GET",
        baseUrl: "https://lookaside.fbsbx.com",
        path: "/whatsapp_business/attachments/abc?token=opaque",
      },
    ]);
  });

  it.each([
    "https://attacker.example/whatsapp_business/attachments/abc",
    "https://lookaside.fbsbx.com.evil/whatsapp_business/attachments/abc",
    "https://user@lookaside.fbsbx.com/whatsapp_business/attachments/abc",
    "https://lookaside.fbsbx.com:444/whatsapp_business/attachments/abc",
    "https://lookaside.fbsbx.com/other/abc",
    "https://lookaside.fbsbx.com/whatsapp_business/attachments/../secret",
  ])(
    "rejects unsafe Meta media URL %s before attempting a download",
    async (url) => {
      const fixture = await downloadNango({ url });
      await expect(
        fetchWhatsappMedia(fixture.nango, binding, media),
      ).rejects.toThrow();
      expect(fixture.proxy).toHaveBeenCalledTimes(1);
    },
  );

  it("rejects redirects and mismatched response MIME before returning bytes", async () => {
    const redirect = await downloadNango({
      download: new Response(null, {
        status: 302,
        headers: { location: "https://attacker.example/file" },
      }),
    });
    await expect(
      fetchWhatsappMedia(redirect.nango, binding, media),
    ).rejects.toThrow();
    expect(redirect.proxy).toHaveBeenCalledTimes(2);

    const wrongMime = await downloadNango({
      download: new Response(jpegBytes(), {
        headers: { "content-type": "image/png" },
      }),
    });
    await expect(
      fetchWhatsappMedia(wrongMime.nango, binding, media),
    ).rejects.toThrow();
  });

  it("cancels a stalled attachment stream after a bounded read timeout", async () => {
    vi.useFakeTimers();
    try {
      const stalled = new Response(
        new ReadableStream<Uint8Array>({
          pull: () => new Promise<void>(() => undefined),
        }),
        { headers: { "content-type": "image/jpeg" } },
      );
      const fixture = await downloadNango({ download: stalled });
      const result = fetchWhatsappMedia(fixture.nango, binding, media).then(
        () => "resolved",
        () => "rejected",
      );
      const deadline = new Promise<string>((resolve) => {
        setTimeout(() => resolve("timeout"), 20_000);
      });
      await vi.advanceTimersByTimeAsync(20_000);
      await expect(Promise.race([result, deadline])).resolves.toBe("rejected");
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects oversized metadata, oversized streamed bodies, and file-size mismatches", async () => {
    const oversizedMetadata = await downloadNango({
      metadata: { file_size: 8 * 1024 * 1024 + 1 },
    });
    await expect(
      fetchWhatsappMedia(oversizedMetadata.nango, binding, media),
    ).rejects.toThrow();
    expect(oversizedMetadata.proxy).toHaveBeenCalledTimes(1);

    const large = new Uint8Array(8 * 1024 * 1024 + 1);
    large.set([0xff, 0xd8, 0xff]);
    const oversizedStream = await downloadNango({
      metadata: { file_size: 8 * 1024 * 1024 },
      download: new Response(large, {
        headers: { "content-type": "image/jpeg" },
      }),
    });
    await expect(
      fetchWhatsappMedia(oversizedStream.nango, binding, media),
    ).rejects.toThrow();

    const wrongSize = await downloadNango({ metadata: { file_size: 100 } });
    await expect(
      fetchWhatsappMedia(wrongSize.nango, binding, media),
    ).rejects.toThrow();
  });

  it("rejects mismatched checksums, MIME declarations, and unknown file signatures", async () => {
    const wrongHash = await downloadNango({
      metadata: { sha256: "00".repeat(32) },
    });
    await expect(
      fetchWhatsappMedia(wrongHash.nango, binding, media),
    ).rejects.toThrow();

    const wrongIncomingMime = await downloadNango();
    await expect(
      fetchWhatsappMedia(wrongIncomingMime.nango, binding, {
        ...media,
        mimeType: "image/png",
      }),
    ).rejects.toThrow();
    expect(wrongIncomingMime.proxy).toHaveBeenCalledTimes(1);

    const invalidSignature = await downloadNango({
      download: new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "image/jpeg" },
      }),
    });
    await expect(
      fetchWhatsappMedia(invalidSignature.nango, binding, media),
    ).rejects.toThrow();
  });

  it("returns a sanitized filename from verified media metadata", async () => {
    const fixture = await downloadNango({
      metadata: { filename: "../vehicle.jpg" },
    });
    const result = await fetchWhatsappMedia(fixture.nango, binding, {
      ...media,
      filename: "photo.jpg",
    });
    expect(result.filename).toBe("vehicle.jpg");
  });
});

describe("WhatsApp media upload", () => {
  it("uploads bounded bytes as multipart data through the tenant Graph media endpoint", async () => {
    const proxy = vi
      .fn()
      .mockResolvedValue(Response.json({ id: "123456789012345" }));
    const bytes = jpegBytes();
    const id = await uploadWhatsappMedia(
      { proxy },
      binding,
      bytes,
      "image/jpeg",
      "photo.jpg",
    );
    expect(id).toBe("123456789012345");
    expect(proxy).toHaveBeenCalledTimes(1);
    const request = proxy.mock.calls[0][0];
    expect(request.connection).toBe(binding.connection);
    expect(request.path).toBe("/v21.0/123456789/media");
    expect(request.method).toBe("POST");
    expect(request.body).toBeInstanceOf(FormData);
    const form = request.body as FormData;
    expect(form.get("messaging_product")).toBe("whatsapp");
    expect(form.get("type")).toBe("image/jpeg");
    expect((form.get("file") as File).name).toBe("photo.jpg");
    expect(await (form.get("file") as File).arrayBuffer()).toEqual(
      bytes.buffer,
    );
  });

  it("rejects unsupported/oversized files and provider failures without retrying", async () => {
    const proxy = vi
      .fn()
      .mockResolvedValue(new Response("failure", { status: 500 }));
    await expect(
      uploadWhatsappMedia(
        { proxy },
        binding,
        jpegBytes(),
        "application/octet-stream",
        "x.bin",
      ),
    ).rejects.toThrow();
    await expect(
      uploadWhatsappMedia(
        { proxy },
        binding,
        new Uint8Array(8 * 1024 * 1024 + 1),
        "image/jpeg",
        "big.jpg",
      ),
    ).rejects.toThrow();
    expect(proxy).not.toHaveBeenCalled();

    await expect(
      uploadWhatsappMedia(
        { proxy },
        binding,
        jpegBytes(),
        "image/jpeg",
        "photo.jpg",
      ),
    ).rejects.toThrow();
    expect(proxy).toHaveBeenCalledTimes(1);
  });
});
