import test from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, pbkdf2Sync, randomBytes } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { transformCheckpoint } from "./retire-vector-state.mjs";
import {
  verifyRetiredVectorState,
  verifyPassphraseCheckpointEquality,
} from "./verify-retired-vector-secrets.mjs";

const passphrase = "test-only-passphrase";
const targetUrn =
  "urn:pulumi:preview::savia-cloudflare::pulumi-nodejs:dynamic/vectorize:Index::pages-search";
const stackUrn =
  "urn:pulumi:preview::savia-cloudflare::pulumi:pulumi:Stack::savia-cloudflare-preview";
const providerUrn =
  "urn:pulumi:preview::savia-cloudflare::pulumi:providers:pulumi-nodejs::default";
const runtimeUrn =
  "urn:pulumi:preview::savia-cloudflare::pulumi-nodejs:dynamic/runtime:RuntimeRelease::runtime";
const sig = "4dabf18193072939515e22adb298388d";
const indexName = "savia-pages-search-preview";

function crypter(salt) {
  const key = pbkdf2Sync(passphrase, salt, 1_000_000, 32, "sha256");
  return (plaintext) => {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
      cipher.getAuthTag(),
    ]);
    return `v1:${nonce.toString("base64")}:${encrypted.toString("base64")}`;
  };
}

function secret(ciphertext) {
  return { [sig]: "1b47061264138c4ac30d75fd1eb44270", ciphertext };
}

function fixture({ salt = randomBytes(8), credential = "same-secret" } = {}) {
  const encrypt = crypter(salt);
  const targetEntry = {
    kind: "vectorize",
    name: indexName,
    cloudId: indexName,
  };
  const workerEntry = {
    kind: "worker",
    name: "savia-preview",
    cloudId: "worker-id",
  };
  const manifest = JSON.stringify({
    version: 1,
    resources: [workerEntry, targetEntry],
  });
  const encryptedSalt = encrypt("pulumi");
  const provider = {
    urn: providerUrn,
    type: "pulumi:providers:pulumi-nodejs",
    inputs: {
      "savia-cloudflare:pagesSearchIndex": indexName,
      "savia-cloudflare:adoptionManifest": manifest,
      apiToken: secret(encrypt(credential)),
    },
    outputs: {
      "savia-cloudflare:pagesSearchIndex": indexName,
      "savia-cloudflare:adoptionManifest": manifest,
      apiToken: secret(encrypt(credential)),
    },
  };
  const runtime = {
    urn: runtimeUrn,
    type: "pulumi-nodejs:dynamic/runtime:RuntimeRelease",
    id: "account/preview",
    dependencies: [targetUrn],
    propertyDependencies: { vectorizeIndex: [targetUrn] },
    inputs: {
      adoptionManifest: { version: 1, resources: [workerEntry, targetEntry] },
    },
    outputs: {
      adoptionManifest: { version: 1, resources: [workerEntry, targetEntry] },
      accessKey: secret(encrypt(credential)),
    },
  };
  const root = {
    urn: stackUrn,
    type: "pulumi:pulumi:Stack",
    outputs: {
      vectorizeIndex: indexName,
      environmentInventory: { resources: [workerEntry, targetEntry] },
    },
  };
  const before = {
    version: 3,
    deployment: {
      manifest: { time: "stable-metadata" },
      secrets_providers: {
        type: "passphrase",
        state: { salt: `v1:${salt.toString("base64")}:${encryptedSalt}` },
      },
      resources: [
        root,
        provider,
        runtime,
        {
          urn: targetUrn,
          type: "pulumi-nodejs:dynamic/vectorize:Index",
          id: `account/${indexName}`,
          protect: true,
          inputs: { name: indexName },
          outputs: { name: indexName },
        },
      ],
    },
  };
  return { before, encrypt };
}

function reencryptCheckpoint(checkpoint, encrypt) {
  const copy = structuredClone(checkpoint);
  const visit = (value) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== "object") return;
    if (typeof value.ciphertext === "string") {
      // The fixture's secure marker is a real Pulumi secret wrapper.
      // Re-encrypting the decrypted value simulates CLI import nonce rotation.
      value.ciphertext = encrypt("same-secret");
    }
    Object.values(value).forEach(visit);
  };
  visit(copy);
  return copy;
}

test("accepts Pulumi passphrase ciphertext re-encrypted with fresh nonces", () => {
  const { before, encrypt } = fixture();
  const rawBefore = { version: 3, checkpoint: { latest: before.deployment } };
  const candidate = transformCheckpoint(rawBefore).checkpoint;
  const after = reencryptCheckpoint(candidate, encrypt);
  assert.equal(
    verifyRetiredVectorState(rawBefore, after, passphrase).verified,
    true,
  );
});

test("rejects wrong passphrase, changed plaintext, provider, or metadata", () => {
  const { before, encrypt } = fixture();
  const transformed = transformCheckpoint(before).checkpoint;
  assert.throws(
    () => verifyRetiredVectorState(before, transformed, "wrong-passphrase"),
    /could not verify passphrase ciphertext/,
  );

  const changed = structuredClone(transformed);
  const runtime = changed.deployment.resources.find(
    (resource) => resource.urn === runtimeUrn,
  );
  runtime.outputs.accessKey.ciphertext = encrypt("changed");
  assert.throws(
    () => verifyRetiredVectorState(before, changed, passphrase),
    /differs from candidate/,
  );

  const wrongProvider = structuredClone(transformed);
  wrongProvider.deployment.secrets_providers.type = "cloud";
  assert.throws(
    () => verifyRetiredVectorState(before, wrongProvider, passphrase),
    /secrets provider state/,
  );

  const wrongMetadata = structuredClone(transformed);
  wrongMetadata.deployment.manifest.time = "changed";
  assert.throws(
    () => verifyRetiredVectorState(before, wrongMetadata, passphrase),
    /deployment metadata/,
  );
});

test("verifies a locally generated Pulumi CLI re-encryption round trip", (t) => {
  const cli = process.env.PULUMI_BIN ?? "pulumi";
  const available = spawnSync(cli, ["version"], { encoding: "utf8" });
  if (available.status !== 0) return t.skip("Pulumi CLI is not installed");
  const root = mkdtempSync(join(tmpdir(), "pulumi-secret-verification-"));
  const project = join(root, "project");
  const home = join(root, "pulumi-home");
  const backend = join(root, "backend");
  const passphraseValue = "test-only-pulumi-passphrase";
  const env = {
    ...process.env,
    PULUMI_HOME: home,
    PULUMI_CONFIG_PASSPHRASE: passphraseValue,
    PULUMI_SKIP_UPDATE_CHECK: "true",
    PULUMI_BACKEND_URL: `file://${backend}`,
  };
  const run = (args) =>
    execFileSync(cli, args, { cwd: project, env, stdio: "pipe" });

  try {
    mkdirSync(project);
    mkdirSync(home);
    mkdirSync(backend);
    writeFileSync(
      join(project, "Pulumi.yaml"),
      "name: secret-roundtrip\nruntime: nodejs\n",
    );
    run(["login", `file://${backend}`]);
    run([
      "stack",
      "init",
      "preview",
      "--secrets-provider=passphrase",
      "--non-interactive",
    ]);
    const beforePath = join(root, "before.json");
    const afterPath = join(root, "after.json");
    const initialPath = join(root, "initial.json");
    run(["stack", "export", "--file", initialPath]);
    const initial = JSON.parse(readFileSync(initialPath, "utf8"));
    initial.deployment.resources = [
      {
        urn: "urn:pulumi:preview::secret-roundtrip::pulumi:pulumi:Stack::secret-roundtrip-preview",
        type: "pulumi:pulumi:Stack",
        outputs: {
          secretValue: {
            [sig]: "1b47061264138c4ac30d75fd1eb44270",
            plaintext: JSON.stringify("cli-generated-synthetic-secret"),
          },
        },
      },
    ];
    writeFileSync(beforePath, JSON.stringify(initial));
    run(["stack", "import", "--file", beforePath, "--non-interactive"]);
    run(["stack", "export", "--file", beforePath]);
    run(["stack", "import", "--file", beforePath, "--non-interactive"]);
    run(["stack", "export", "--file", afterPath]);

    const before = JSON.parse(readFileSync(beforePath, "utf8"));
    const after = JSON.parse(readFileSync(afterPath, "utf8"));
    assert.equal(
      verifyPassphraseCheckpointEquality(before, after, passphraseValue)
        .verified,
      true,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects malformed ciphertext and provider salt without revealing values", () => {
  const { before } = fixture();
  const transformed = transformCheckpoint(before).checkpoint;
  const malformed = structuredClone(transformed);
  malformed.deployment.resources.find(
    (resource) => resource.urn === providerUrn,
  ).inputs.apiToken.ciphertext = "private-material-must-not-appear";
  assert.throws(
    () => verifyRetiredVectorState(before, malformed, passphrase),
    (error) =>
      !error.message.includes("private-material") &&
      /ciphertext/.test(error.message),
  );

  const plaintextSecret = structuredClone(transformed);
  const plaintextToken = plaintextSecret.deployment.resources.find(
    (resource) => resource.urn === providerUrn,
  ).inputs.apiToken;
  plaintextToken.plaintext = JSON.stringify("downgraded-secret");
  delete plaintextToken.ciphertext;
  assert.throws(
    () => verifyRetiredVectorState(before, plaintextSecret, passphrase),
    /plaintext secret wrapper is forbidden/,
  );

  const badSalt = structuredClone(before);
  badSalt.deployment.secrets_providers.state.salt = "not-a-supported-salt";
  const badSaltCandidate = transformCheckpoint(badSalt).checkpoint;
  assert.throws(
    () => verifyRetiredVectorState(badSalt, badSaltCandidate, passphrase),
    /unsupported passphrase salt/,
  );
});
