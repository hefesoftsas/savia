import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OFFICE_FORMATS, type OfficeFormat } from "@savia/studio-shared/office";
import { createBlankOfficeFile } from "./new-office-file";

const formats: OfficeFormat[] = ["docx", "xlsx", "pptx"];

afterEach(() => vi.unstubAllGlobals());

describe("createBlankOfficeFile", () => {
  it.each(formats)("creates a valid blank %s attachment", async (format) => {
    const bytes = readFileSync(`public/office/templates/blank.${format}`);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(bytes, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const file = await createBlankOfficeFile(
      format,
      `  New file.${format.toUpperCase()}  `,
    );

    expect(file.name).toBe(`New file.${format}`);
    expect(file.type).toBe(OFFICE_FORMATS[format].mime);
    expect(Buffer.from(await file.arrayBuffer())).toEqual(bytes);
    expect(fetchMock).toHaveBeenCalledWith(`/office/templates/blank.${format}`);
  });

  it("normalizes a known Office extension and preserves other dots", async () => {
    const bytes = readFileSync("public/office/templates/blank.docx");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(bytes, { status: 200 })),
    );

    const file = await createBlankOfficeFile("docx", "Forecast v1.2.xlsx");

    expect(file.name).toBe("Forecast v1.2.docx");
  });

  it("rejects a format outside the supported Office types", async () => {
    await expect(
      createBlankOfficeFile("xls" as OfficeFormat, "Forecast"),
    ).rejects.toThrow(/format|formato/i);
  });

  it.each(["", "   ", "/report", "folder\\report", "a".repeat(250)])(
    "rejects an invalid filename (%s)",
    async (name) => {
      await expect(createBlankOfficeFile("docx", name)).rejects.toThrow();
    },
  );

  it("reports a missing template clearly", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 404 })),
    );

    await expect(createBlankOfficeFile("xlsx", "Sheet")).rejects.toThrow(
      /template|plantilla/i,
    );
  });
});
