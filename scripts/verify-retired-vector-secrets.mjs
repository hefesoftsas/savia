import { createDecipheriv, pbkdf2Sync } from "node:crypto";
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  TARGET_URN,
  transformCheckpoint,
  validateImportedCheckpoint,
} from "./retire-vector-state.mjs";

// Match the pinned Pulumi v3.268.0 passphrase format:
// https://github.com/pulumi/pulumi/blob/v3.268.0/sdk/go/common/resource/config/crypt.go
// https://github.com/pulumi/pulumi/blob/v3.268.0/pkg/secrets/passphrase/manager.go
const PULUMI_SECRET_SIG = "4dabf18193072939515e22adb298388d";
const PULUMI_SECRET_MARKER = "1b47061264138c4ac30d75fd1eb44270";

function providerState(checkpoint) {
  return (
    checkpoint?.deployment?.secrets_providers ??
    checkpoint?.checkpoint?.latest?.secrets_providers ??
    checkpoint?.secrets_providers
  );
}

function decodeBase64(value) {
  if (
    typeof value !== "string" ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
      value,
    )
  )
    throw new Error("could not verify passphrase ciphertext: invalid encoding");
  return Buffer.from(value, "base64");
}

function parseCiphertext(value) {
  if (typeof value !== "string")
    throw new Error(
      "could not verify passphrase ciphertext: unsupported shape",
    );
  const parts = value.split(":");
  if (parts.length !== 3 || parts[0] !== "v1")
    throw new Error(
      "could not verify passphrase ciphertext: unsupported version",
    );
  const nonce = decodeBase64(parts[1]);
  const payload = decodeBase64(parts[2]);
  if (nonce.length !== 12 || payload.length < 16)
    throw new Error(
      "could not verify passphrase ciphertext: invalid dimensions",
    );
  return { nonce, payload };
}

function decryptValue(value, key) {
  const { nonce, payload } = parseCiphertext(value);
  const body = payload.subarray(0, payload.length - 16);
  const tag = payload.subarray(payload.length - 16);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString(
      "utf8",
    );
  } catch {
    throw new Error(
      "could not verify passphrase ciphertext: authentication failed",
    );
  }
}

function saltAndKey(checkpoint, passphrase) {
  if (typeof passphrase !== "string" || passphrase.length === 0)
    throw new Error("PULUMI_CONFIG_PASSPHRASE is required");
  const state = providerState(checkpoint);
  if (state?.type !== "passphrase" || typeof state?.state?.salt !== "string")
    throw new Error(
      "unsupported secrets provider; expected Pulumi passphrase provider",
    );
  const parts = state.state.salt.split(":");
  if (parts.length !== 5 || parts[0] !== "v1" || parts[2] !== "v1")
    throw new Error("unsupported passphrase salt format");
  const salt = decodeBase64(parts[1]);
  if (salt.length !== 8) throw new Error("unsupported passphrase salt format");
  const key = pbkdf2Sync(passphrase, salt, 1_000_000, 32, "sha256");
  if (decryptValue(parts.slice(2).join(":"), key) !== "pulumi")
    throw new Error(
      "could not verify passphrase ciphertext: provider check failed",
    );
  return key;
}

function decryptSecretWrappers(checkpoint, key) {
  const copy = structuredClone(checkpoint);
  let count = 0;
  function visit(value) {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    if (Object.hasOwn(value, "ciphertext")) {
      if (
        Object.keys(value).length !== 2 ||
        value[PULUMI_SECRET_SIG] !== PULUMI_SECRET_MARKER ||
        typeof value.ciphertext !== "string"
      )
        throw new Error(
          "could not verify passphrase ciphertext: unsupported secret wrapper",
        );
      value.ciphertext = decryptValue(value.ciphertext, key);
      count += 1;
      return;
    }
    if (Object.hasOwn(value, PULUMI_SECRET_SIG))
      throw new Error(
        "could not verify passphrase ciphertext: plaintext secret wrapper is forbidden",
      );
    Object.values(value).forEach(visit);
  }
  visit(copy);
  if (count === 0)
    throw new Error(
      "checkpoint contains no supported Pulumi passphrase secrets",
    );
  return { checkpoint: copy, count };
}

export function verifyRetiredVectorState(
  beforeCheckpoint,
  importedCheckpoint,
  passphrase,
  { targetUrn = TARGET_URN } = {},
) {
  const { checkpoint: transformed } = transformCheckpoint(beforeCheckpoint, {
    targetUrn,
  });
  if (!importedCheckpoint || typeof importedCheckpoint !== "object")
    throw new Error("imported checkpoint is required");
  const beforeState = providerState(transformed);
  const afterState = providerState(importedCheckpoint);
  if (
    beforeState?.type !== "passphrase" ||
    afterState?.type !== "passphrase" ||
    !isDeepStrictEqual(beforeState, afterState)
  )
    throw new Error("imported checkpoint changed the secrets provider state");

  const key = saltAndKey(transformed, passphrase);
  // Verify the imported checkpoint uses the same salt and correctly decrypts too.
  const importedKey = saltAndKey(importedCheckpoint, passphrase);
  if (!key.equals(importedKey))
    throw new Error("imported checkpoint changed the secrets provider state");
  const candidatePlain = decryptSecretWrappers(transformed, key);
  const importedPlain = decryptSecretWrappers(importedCheckpoint, importedKey);
  validateImportedCheckpoint(
    candidatePlain.checkpoint,
    importedPlain.checkpoint,
    { targetUrn },
  );
  return {
    verified: true,
    decryptedSecretCount: candidatePlain.count,
    importedSecretCount: importedPlain.count,
  };
}

export function verifyPassphraseCheckpointEquality(
  beforeCheckpoint,
  importedCheckpoint,
  passphrase,
) {
  const leftState = providerState(beforeCheckpoint);
  const rightState = providerState(importedCheckpoint);
  if (
    leftState?.type !== "passphrase" ||
    rightState?.type !== "passphrase" ||
    !isDeepStrictEqual(leftState, rightState)
  )
    throw new Error("imported checkpoint changed the secrets provider state");
  const leftKey = saltAndKey(beforeCheckpoint, passphrase);
  const rightKey = saltAndKey(importedCheckpoint, passphrase);
  if (!leftKey.equals(rightKey))
    throw new Error("imported checkpoint changed the secrets provider state");
  const left = decryptSecretWrappers(beforeCheckpoint, leftKey);
  const right = decryptSecretWrappers(importedCheckpoint, rightKey);
  validateImportedCheckpoint(left.checkpoint, right.checkpoint);
  return {
    verified: true,
    decryptedSecretCount: left.count,
    importedSecretCount: right.count,
  };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function parseArgs(argv) {
  if (
    argv.length !== 5 ||
    argv[0] !== "verify-import-secrets" ||
    argv[1] !== "--before" ||
    argv[3] !== "--after"
  )
    throw new Error(
      "usage: verify-import-secrets --before <path> --after <path>",
    );
  return { beforePath: argv[2], afterPath: argv[4] };
}

function main() {
  try {
    const { beforePath, afterPath } = parseArgs(process.argv.slice(2));
    const result = verifyRetiredVectorState(
      readJson(beforePath),
      readJson(afterPath),
      process.env.PULUMI_CONFIG_PASSPHRASE,
    );
    process.stdout.write(
      `Imported checkpoint verified: ${result.decryptedSecretCount} secrets match after decryption.\n`,
    );
  } catch {
    process.stderr.write("Imported checkpoint secret verification failed.\n");
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main();
}
