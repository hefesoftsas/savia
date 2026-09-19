import { it, expect, vi } from "vitest";
import type { PluginApi } from "@savia/crm-shared/plugin-api";
import {
  persistDocument,
  signaturePatch,
  resolveArtifact,
  loadDocumentFiles,
} from "../src/workflow";
function fixture(failUpload = false) {
  const record = { id: "doc-1", _version: 3 };
  const collection = {
    create: vi.fn(async () => record),
    update: vi.fn(async () => ({ ...record, _version: 4 })),
  };
  const files = {
    upload: vi.fn(async () => {
      if (failUpload) throw Error("upload failed");
      return { id: "file-1", version: 1 };
    }),
  };
  return {
    collection,
    files,
    savia: {
      collections: { collection: () => collection },
      files,
    } as unknown as PluginApi,
  };
}
it("persists native record before attachment and marks generated using current version", async () => {
  const f = fixture();
  await persistDocument(f.savia, { name: "Test", body: "Hello" });
  expect(f.collection.create.mock.invocationCallOrder[0]).toBeLessThan(
    f.files.upload.mock.invocationCallOrder[0],
  );
  expect(f.collection.update).toHaveBeenCalledWith(
    "doc-1",
    {
      stage: "generated",
      artifact_file_id: "file-1",
      artifact_file_version: 1,
    },
    { version: 3 },
  );
});
it("does not mark generated when upload fails", async () => {
  const f = fixture(true);
  await expect(
    persistDocument(f.savia, { name: "Test", body: "Hello" }),
  ).rejects.toThrow("upload failed");
  expect(f.collection.update).not.toHaveBeenCalled();
});
it("requires both signature date and safe evidence before claiming signed", () => {
  expect(signaturePatch({ reference: "r", state: "delivered" }).stage).toBe(
    "requested",
  );
  expect(
    signaturePatch({
      reference: "r",
      state: "delivered",
      signedAt: "2026-09-19T12:00:00Z",
      evidenceUrl: "https://example.com/evidence",
    }).stage,
  ).toBe("signed");
  expect(
    signaturePatch({
      reference: "r",
      state: "delivered",
      signedAt: "invalid",
      evidenceUrl: "https://example.com",
    }).stage,
  ).toBe("requested");
});
it("does not recursively interpolate braces inside already-rendered values", async () => {
  const f = fixture();
  await persistDocument(f.savia, {
    name: "Literal",
    body: "Customer supplied {{literal}}",
  });
  const call = f.files.upload.mock.calls[0] as unknown as [
    string,
    string,
    File,
  ];
  expect(await call[2].text()).toContain("Customer supplied {{literal}}");
});
it("does not report generated when the record version conflicts after upload", async () => {
  const f = fixture();
  f.collection.update.mockRejectedValueOnce(Error("Version conflict"));
  await expect(
    persistDocument(f.savia, { name: "Test", body: "Hello" }),
  ).rejects.toThrow("Version conflict");
  expect(f.files.upload).toHaveBeenCalledOnce();
});

it("pins the generated artifact and rejects a missing or changed canonical attachment", async () => {
  const file = {
    id: "pinned",
    version: 2,
    name: "documento.html",
    mime: "text/html",
    size: 30,
  };
  const f = {
    files: { list: vi.fn(async () => [file, { ...file, id: "newer" }]) },
  } as unknown as PluginApi;
  expect(
    (
      await resolveArtifact(f, {
        id: "doc",
        kind: "document",
        artifact_file_id: "pinned",
        artifact_file_version: 2,
      })
    ).id,
  ).toBe("pinned");
  await expect(
    resolveArtifact(f, {
      id: "doc",
      kind: "document",
      artifact_file_id: "different",
      artifact_file_version: 2,
    }),
  ).rejects.toThrow();
  await expect(
    resolveArtifact(f, {
      id: "doc",
      kind: "document",
      artifact_file_id: "pinned",
      artifact_file_version: 1,
    }),
  ).rejects.toThrow();
});
it("ignores an out-of-order attachment response after selection changes", async () => {
  let finishA: (files: never[]) => void = () => {};
  const api = {
    files: {
      list: vi.fn((_: string, id: string) =>
        id === "A"
          ? new Promise<never[]>((resolve) => {
              finishA = resolve;
            })
          : Promise.resolve([{ id: "B-file" }]),
      ),
    },
  } as unknown as PluginApi;
  const receive = vi.fn(),
    failure = vi.fn();
  const cancel = loadDocumentFiles(api, "A", receive, failure);
  cancel();
  loadDocumentFiles(api, "B", receive, failure);
  await Promise.resolve();
  finishA([]);
  await Promise.resolve();
  expect(receive).toHaveBeenCalledExactlyOnceWith([{ id: "B-file" }]);
  expect(failure).not.toHaveBeenCalled();
});
