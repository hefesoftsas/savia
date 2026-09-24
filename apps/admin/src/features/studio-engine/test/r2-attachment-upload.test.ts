// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import {
  uploadR2Attachments,
  uploadTemporaryR2Attachment,
} from "../r2-attachment-upload";

afterEach(() => vi.unstubAllGlobals());

it("uploads each pending R2 attachment with its configured field", async () => {
  const fetcher = vi.fn(async () => Response.json({ data: { id: "file-1" } }));
  vi.stubGlobal("fetch", fetcher);
  const file = new File(["contract"], "contract.pdf", {
    type: "application/pdf",
  });

  await uploadR2Attachments("contracts", "record-1", [
    { field: "contract", files: [file] },
  ]);

  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(String(fetcher.mock.calls[0]?.[0])).toBe(
    "/api/files/contracts/record-1",
  );
  const init = fetcher.mock.calls[0]?.[1] as RequestInit;
  const body = init.body as FormData;
  expect(init.method).toBe("POST");
  expect(body.get("field")).toBe("contract");
  expect(body.get("file")).toBe(file);
});

it("uploads a selected attachment before a record exists", async () => {
  const fetcher = vi.fn(async () =>
    Response.json({
      data: {
        id: "temporary-file-1",
        name: "contract.pdf",
        mime: "application/pdf",
        size: 8,
        field: "contract",
        version: 1,
        expiresAt: "2026-09-10T00:00:00.000Z",
      },
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  const file = new File(["contract"], "contract.pdf", {
    type: "application/pdf",
  });

  const attachment = await uploadTemporaryR2Attachment(
    "contracts",
    "contract",
    file,
  );

  expect(attachment).toMatchObject({
    id: "temporary-file-1",
    field: "contract",
    version: 1,
  });
  expect(String(fetcher.mock.calls[0]?.[0])).toBe(
    "/api/file-drafts/contracts",
  );
  const init = fetcher.mock.calls[0]?.[1] as RequestInit;
  const body = init.body as FormData;
  expect(init.method).toBe("POST");
  expect(body.get("field")).toBe("contract");
  expect(body.get("file")).toBe(file);
});

it("reports completed files before a later upload fails so only the failed file stays queued", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ data: { id: "file-1" } }))
    .mockResolvedValueOnce(
      Response.json({ error: "R2 no está disponible" }, { status: 503 }),
    );
  vi.stubGlobal("fetch", fetcher);
  const onStatus = vi.fn();
  const first = new File(["first"], "first.pdf", { type: "application/pdf" });
  const second = new File(["second"], "second.pdf", { type: "application/pdf" });

  await expect(
    uploadR2Attachments(
      "contracts",
      "record-1",
      [{ field: "contract", files: [first, second] }],
      onStatus,
    ),
  ).rejects.toThrow("R2 no está disponible");

  expect(onStatus).toHaveBeenCalledWith({
    field: "contract",
    file: first,
    status: "uploaded",
  });
  expect(onStatus).toHaveBeenNthCalledWith(1, {
    field: "contract",
    file: first,
    status: "uploading",
  });
  expect(onStatus).toHaveBeenNthCalledWith(3, {
    field: "contract",
    file: second,
    status: "uploading",
  });
  expect(onStatus).not.toHaveBeenCalledWith({
    field: "contract",
    file: second,
    status: "uploaded",
  });
});
