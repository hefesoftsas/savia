import { readFile, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
export function matchesPinnedDigest(file, digest) {
  return (
    digest === file.importedSha256 ||
    file.adaptations?.some(
      (adaptation) =>
        adaptation.sha256 === digest &&
        typeof adaptation.reason === "string" &&
        adaptation.reason.trim().length > 0,
    ) === true
  );
}

export async function verifySource(directory = root) {
  const manifest = JSON.parse(
    await readFile(resolve(directory, "UPSTREAM.json"), "utf8"),
  );
  const issues = [];
  let nodes = 0;
  const categories = new Set();
  for (const file of manifest.files) {
    const path = resolve(directory, file.path);
    if (!path.startsWith(resolve(directory) + "/"))
      throw new Error("Invalid source manifest path");
    try {
      await access(path);
    } catch {
      issues.push(`Missing imported file: ${file.path}`);
      continue;
    }
    if (
      file.path.startsWith("packages/runtime/src/nodes/") &&
      file.path.endsWith(".ts") &&
      !file.path.endsWith(".test.ts")
    ) {
      nodes++;
      categories.add(file.path.split("/")[4]);
      const content = await readFile(path);
      const digest = createHash("sha256").update(content).digest("hex");
      if (!matchesPinnedDigest(file, digest))
        issues.push(
          `Node implementation differs from pinned source: ${file.path}`,
        );
    }
  }
  const license = await readFile(
    resolve(directory, manifest.licenseFile),
    "utf8",
  );
  if (
    !license.includes("Copyright (c) 2025 Dafthunk Team") ||
    !license.includes("Permission is hereby granted")
  )
    issues.push("Dafthunk MIT license notice is incomplete");
  if (nodes !== 526 || categories.size !== 48)
    issues.push(
      `Incomplete node catalog: ${nodes} implementation files, ${categories.size} categories`,
    );
  if (issues.length) throw new Error(issues.join("\n"));
  return {
    commit: manifest.commit,
    importedFiles: manifest.files.length,
    nodeImplementationFiles: nodes,
    categories: categories.size,
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  console.log(JSON.stringify(await verifySource(), null, 2));
}
