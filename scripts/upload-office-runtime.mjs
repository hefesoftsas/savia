import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliDecompressSync } from "node:zlib";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function buildOfficeRuntimeUploadPlan({
  environment,
  bucket,
  accountId,
  apiToken,
  root,
  manifest,
  inventory,
}) {
  if (environment !== "preview")
    throw new Error("Office runtime uploads are preview deployment only");
  if (bucket !== "savia-documents-preview")
    throw new Error("Office runtime uploads require savia-documents-preview");
  if (!accountId || !apiToken)
    throw new Error("Cloudflare account credentials are required");
  if (!root || !manifest || !Array.isArray(inventory))
    throw new Error("Office runtime package inventory is required");
  if (
    typeof manifest.build !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(manifest.build) ||
    !manifest.files ||
    typeof manifest.files !== "object" ||
    Array.isArray(manifest.files)
  )
    throw new Error("Invalid pinned Office runtime manifest");

  const names = Object.keys(manifest.files);
  if (names.length !== 5 || inventory.length !== names.length)
    throw new Error(
      "Office runtime inventory does not match the pinned assets",
    );

  const uploadDirectory = resolve(
    root,
    ".cache",
    "office-runtime",
    manifest.build,
    "upload",
  );
  const environmentValues = {
    ...process.env,
    CLOUDFLARE_ACCOUNT_ID: accountId,
    CLOUDFLARE_API_TOKEN: apiToken,
    SAVIA_DEPLOY_ENVIRONMENT: environment,
  };
  const plan = [];
  const seen = new Set();

  for (let index = 0; index < names.length; index += 1) {
    const name = names[index];
    const asset = manifest.files[name];
    const entry = inventory[index];
    const expectedFile = join(uploadDirectory, name + ".br");
    const expectedKey = `office-runtime/${manifest.build}/${name}`;
    if (!asset || typeof asset !== "object")
      throw new Error(`Invalid manifest entry for ${name}`);
    if (seen.has(entry?.key))
      throw new Error("Duplicate Office runtime inventory key");
    seen.add(entry?.key);
    if (entry?.file !== expectedFile)
      throw new Error(
        `Office runtime inventory has unexpected runtime asset path: ${name}`,
      );
    if (entry?.key !== expectedKey)
      throw new Error(
        `Office runtime inventory has unexpected runtime object key: ${name}`,
      );
    if (entry.contentType !== asset.type)
      throw new Error(
        `Office runtime inventory content type mismatch: ${name}`,
      );
    if (entry.contentEncoding !== "br")
      throw new Error(
        `Office runtime inventory content encoding mismatch: ${name}`,
      );
    if (!Number.isInteger(entry.size) || entry.size <= 0)
      throw new Error(
        `Office runtime inventory compressed size is invalid: ${name}`,
      );
    if (
      !Number.isInteger(asset.size) ||
      asset.size <= 0 ||
      typeof asset.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(asset.sha256)
    )
      throw new Error(`Invalid pinned Office runtime metadata: ${name}`);

    let compressed;
    let bytes;
    try {
      compressed = await readFile(expectedFile);
      bytes = brotliDecompressSync(compressed);
    } catch {
      throw new Error(`Office runtime package is missing or invalid: ${name}`);
    }
    if (compressed.length !== entry.size)
      throw new Error(
        `Office runtime inventory compressed size mismatch: ${name}`,
      );
    if (
      bytes.length !== asset.size ||
      createHash("sha256").update(bytes).digest("hex") !== asset.sha256
    )
      throw new Error(`Office runtime package checksum mismatch: ${name}`);

    const objectPath = `${bucket}/${expectedKey}`;
    plan.push({
      objectPath,
      executable: "pnpm",
      args: [
        "--filter",
        "@savia/api",
        "exec",
        "wrangler",
        "r2",
        "object",
        "put",
        objectPath,
        "--file",
        expectedFile,
        "--content-type",
        asset.type,
        "--content-encoding",
        "br",
        "--remote",
      ],
      options: { cwd: root, env: environmentValues },
    });
  }

  return plan;
}

async function main() {
  const environment = process.env.SAVIA_DEPLOY_ENVIRONMENT;
  const bucket = process.env.SAVIA_DOCUMENTS_BUCKET;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  const manifest = JSON.parse(
    await readFile(
      join(workspaceRoot, "apps/admin/office-runtime.json"),
      "utf8",
    ),
  );
  const packageDirectory = join(
    workspaceRoot,
    ".cache/office-runtime",
    manifest.build,
    "upload",
  );
  const inventory = JSON.parse(
    await readFile(join(packageDirectory, "objects.json"), "utf8"),
  );
  const plan = await buildOfficeRuntimeUploadPlan({
    environment,
    bucket,
    accountId,
    apiToken,
    root: workspaceRoot,
    manifest,
    inventory,
  });

  for (const command of plan) {
    try {
      execFileSync(command.executable, command.args, {
        ...command.options,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      throw new Error(`Office runtime upload failed for ${command.objectPath}`);
    }
    console.log(`Uploaded ${command.objectPath}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
