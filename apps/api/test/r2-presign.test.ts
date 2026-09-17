import { describe, expect, it } from "vitest";
import { presignR2Object } from "../src/lib/r2-presign";

describe("presignR2Object", () => {
  it("creates a five-minute PUT URL scoped to one private R2 object", async () => {
    const signedUrl = await presignR2Object(
      {
        accountId: "account-test",
        accessKeyId: "access-test",
        secretAccessKey: "secret-test",
        bucket: "savia-documents",
      },
      {
        method: "PUT",
        objectKey:
          "private/900004/customer-portfolio/customer-profiles/900012/file-id",
        contentType: "application/pdf",
      },
    );

    const url = new URL(signedUrl);
    expect(url.hostname).toBe("account-test.r2.cloudflarestorage.com");
    expect(url.pathname).toBe(
      "/savia-documents/private/900004/customer-portfolio/customer-profiles/900012/file-id",
    );
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[a-f0-9]{64}$/);
  });
});
