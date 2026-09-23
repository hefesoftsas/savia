import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const trackedFiles = execFileSync("git", ["ls-files", "-z"], {
  cwd: root,
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);

const dumpExtensions =
  /\.(?:dump|bak|backup|sqlite|sqlite3|db|sql\.gz|dump\.gz|tar\.gz)$/i;
const vehicleRegistration = /\b(?:[A-Z]{3}\d{2}[A-Z0-9]|[A-Z]{4}\d{2})\b/g;
const technicalIdentifiers = new Set(["AES128", "SHA256"]);

// Character codes keep disallowed identifiers out of the public search index.
const privateIdentifiers = [
  [109, 97, 116, 114, 105, 120],
  [105, 108, 97, 111, 115],
  [115, 105, 110, 101, 114, 103, 105, 97, 115],
  [115, 121, 110, 101, 114, 103, 105, 97, 115],
  [108, 117, 105, 115, 97],
  [100, 117, 113, 117, 101],
  [97, 108, 101, 106, 97, 110, 100, 114, 111],
].map((codes) => String.fromCharCode(...codes));
const privateIdentifierFiles = [];
const dumpFiles = trackedFiles.filter((file) => dumpExtensions.test(file));
const registrationFiles = [];
const privateKeyFiles = [];
const localConfigFiles = trackedFiles.filter((file) =>
  /(?:^|\/)(?:\.env(?!\.example$)|\.dev\.vars|infra\/secrets\/|\.wrangler\/)|wrangler\.(?:production|preview)\.jsonc$/.test(
    file,
  ),
);

for (const file of trackedFiles) {
  let bytes;
  try {
    bytes = readFileSync(new URL(`../${file}`, import.meta.url));
  } catch {
    continue;
  }

  const pathHasPrivateIdentifier = privateIdentifiers.some((value) =>
    file.toLowerCase().includes(value),
  );

  // Binary media has arbitrary byte sequences and is not source text to scan.
  if (bytes.includes(0)) {
    if (pathHasPrivateIdentifier) privateIdentifierFiles.push(file);
    continue;
  }

  const content = bytes.toString("utf8");

  if (
    /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/.test(content)
  )
    privateKeyFiles.push(file);

  if (
    pathHasPrivateIdentifier ||
    privateIdentifiers.some((value) => content.toLowerCase().includes(value))
  ) {
    privateIdentifierFiles.push(file);
  }

  const matches = [...content.matchAll(vehicleRegistration)]
    .map((match) => match[0])
    .filter((value) => !technicalIdentifiers.has(value));
  if (matches.length) registrationFiles.push(file);
}

assert.deepEqual(dumpFiles, [], "tracked dump files must not be published");
assert.deepEqual(
  registrationFiles,
  [],
  "tracked source must not retain literal vehicle registration values",
);

assert.deepEqual(privateKeyFiles, [], "private keys must not be published");
assert.deepEqual(
  localConfigFiles,
  [],
  "local configuration must not be published",
);

assert.deepEqual(
  privateIdentifierFiles,
  [],
  "private identifiers must not be published",
);
