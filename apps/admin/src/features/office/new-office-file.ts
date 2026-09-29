import {
  OFFICE_FORMATS,
  type OfficeFormat,
  validateOfficePackage,
} from "@savia/studio-shared/office";

const MAX_NAME_LENGTH = 180;

export async function createBlankOfficeFile(
  format: OfficeFormat,
  name: string,
): Promise<File> {
  if (!Object.hasOwn(OFFICE_FORMATS, format))
    throw new Error("The selected Office format is not supported.");

  const cleanedName = name.trim();
  if (
    !cleanedName ||
    cleanedName.length > MAX_NAME_LENGTH ||
    /[\\/\u0000-\u001f\u007f]/.test(cleanedName)
  ) {
    throw new Error(
      "Enter a filename of 1 to 180 characters without slashes or control characters.",
    );
  }

  const officeExtension = /\.(docx|xlsx|pptx)$/i.exec(cleanedName);
  const stem = officeExtension
    ? cleanedName.slice(0, -officeExtension[0].length)
    : cleanedName;
  if (!stem.trim()) throw new Error("Enter a valid filename.");
  const filename = `${stem}.${format}`;

  let response: Response;
  try {
    response = await fetch(`/office/templates/blank.${format}`);
  } catch {
    throw new Error("The blank Office template could not be loaded.");
  }
  if (!response.ok)
    throw new Error("The blank Office template is unavailable.");

  const bytes = new Uint8Array(await response.arrayBuffer());
  await validateOfficePackage(bytes, format);
  return new File([bytes], filename, { type: OFFICE_FORMATS[format].mime });
}
