import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { join } from "node:path";

export async function prepareVscodeDownload({
  manifestPath,
  artifactsDir,
  downloadsDir,
}) {
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version ?? "")) {
    throw new Error("VS Code extension manifest has an invalid version.");
  }

  const filename = `savia-plugin-authoring-${manifest.version}.vsix`;
  const artifact = join(artifactsDir, filename);
  const checksumFile = `${artifact}.sha256`;
  const artifactBytes = await fs.readFile(artifact);
  const expectedChecksum = createHash("sha256")
    .update(artifactBytes)
    .digest("hex");
  const recordedChecksum = (await fs.readFile(checksumFile, "utf8")).trim();

  if (recordedChecksum !== `${expectedChecksum} ${filename}`) {
    throw new Error(`VSIX checksum is missing or invalid for ${filename}.`);
  }

  await fs.mkdir(downloadsDir, { recursive: true });
  for (const entry of await fs.readdir(downloadsDir)) {
    if (/^savia-plugin-authoring-.*\.vsix(?:\.sha256)?$/.test(entry)) {
      await fs.rm(join(downloadsDir, entry));
    }
  }
  await fs.copyFile(artifact, join(downloadsDir, filename));
  await fs.copyFile(checksumFile, join(downloadsDir, `${filename}.sha256`));
  return { filename, checksum: expectedChecksum };
}
