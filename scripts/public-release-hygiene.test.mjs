import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
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

// This exact third-party Lottie build contains math terms that resemble private
// identifiers and registration values. Any changed build is scanned as usual.
// The exact generated native lockfile also contains a public numeric crate name
// resembling a restricted identifier; changed lockfiles are scanned normally.
const approvedVendorHashes = new Map([
  [
    "apps/companion/src-tauri/Cargo.lock",
    "1790dbecfd68b70cc1e587870154078223a5d08fc3c6eda7ee99cf290e8cbf4b",
  ],
  [
    "apps/admin/public/login/lottie-light.min.js",
    "9588432bec30c8ef8200bac4a67d8aaad881047bc2a6c9fa624d90ec96402410",
  ],
]);

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
// GitHub Actions uses a reserved strategy expansion keyword that also matches
// one of the restricted names. Ignore only its YAML key and expression access;
// prose, values, paths, and every other private identifier remain scanned.
function searchableWorkflowContent(file, content) {
  if (!/^\.github\/workflows\/[^/]+\.ya?ml$/.test(file)) return content;
  const keyword = String.fromCharCode(109, 97, 116, 114, 105, 120);
  return content
    .replace(new RegExp(`(^[ \t]*)${keyword}(?=:[ \t]*(?:#.*)?$)`, "gm"), "$1")
    .replace(/\$\{\{[\s\S]*?\}\}/g, (expression) =>
      expression.replace(
        new RegExp(`\\b${keyword}(?=\\.[A-Za-z_]\\w*)`, "g"),
        "",
      ),
    );
}

const workflowKeyword = String.fromCharCode(109, 97, 116, 114, 105, 120);
const workflowPath = ".github/workflows/example.yml";
assert.equal(
  searchableWorkflowContent(
    workflowPath,
    `    ${workflowKeyword}:\n      include: []\nname: \${{ ${workflowKeyword}.id }}\n`,
  ).includes(workflowKeyword),
  false,
  "reserved workflow syntax must not be mistaken for private data",
);
for (const [file, content] of [
  [workflowPath, `name: ${workflowKeyword}`],
  [workflowPath, `# ${workflowKeyword}`],
  ["docs/example.md", `    ${workflowKeyword}:`],
]) {
  assert.ok(searchableWorkflowContent(file, content).includes(workflowKeyword));
}

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

  const approvedHash = approvedVendorHashes.get(file);
  if (
    approvedHash &&
    createHash("sha256").update(bytes).digest("hex") === approvedHash
  )
    continue;

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
    privateIdentifiers.some((value) =>
      searchableWorkflowContent(file, content).toLowerCase().includes(value),
    )
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
