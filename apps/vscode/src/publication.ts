import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  pluginDigestSchema,
  pluginDevelopmentOriginSchema,
  pluginPublicationRequestSchema,
  pluginPublicationReceiptSchema,
  type PluginPublicationReceipt,
} from "@savia/studio-shared/plugin-development";
import { buildLocalProject, requireTrusted, type BuildOptions } from "./build";
import { PluginDevelopmentClient, type ConnectionProfile } from "./client";
import { readProjectDescriptor } from "./project";
import {
  resolveProjectRoot,
  readProjectFile,
  assertNoSymlinks,
  type ProjectRoot,
} from "./filesystem";
import { writeMetadata } from "./metadata";
import type { AuthoringBundles } from "@savia/plugin-authoring";
export const publicationAttemptSchema = z
  .object({
    schemaVersion: z.literal(1),
    origin: pluginDevelopmentOriginSchema,
    tenantId: z.number().int().positive(),
    sha256: pluginDigestSchema,
    input: pluginPublicationRequestSchema,
    state: z.enum(["prepared", "confirmed", "uncertain", "rejected"]),
    createdAt: z.string().max(64),
    receipt: pluginPublicationReceiptSchema.optional(),
  })
  .strict();
export type PublicationAttempt = z.infer<typeof publicationAttemptSchema>;
export type PublicationGuard = { isTrusted(): boolean; isCurrent(): boolean };
function assertPublication(guard: PublicationGuard) {
  requireTrusted(guard.isTrusted());
  if (!guard.isCurrent())
    throw new Error(
      "The selected connection changed. Retry in the selected connection.",
    );
}
export async function preparePublication(
  root: ProjectRoot,
  profile: ConnectionProfile,
  bundles: AuthoringBundles,
  selection: { destination: "tenant" | "shared"; version: string },
  options: BuildOptions,
) {
  const build = await buildLocalProject(root, profile, bundles, {
    ...options,
    version: selection.version,
  });
  if (!build) return undefined;
  const input = pluginPublicationRequestSchema.parse({
    mode: "create",
    destination: selection.destination,
    pluginId: build.descriptor.pluginId,
    version: selection.version,
    sourceVersion: build.descriptor.sourceVersion,
    sourceSha256: build.descriptor.sourceSha256,
    expectedHead: build.descriptor.expectedHead,
  });
  return { ...build, input };
}
export type PreparedPublication = NonNullable<
  Awaited<ReturnType<typeof preparePublication>>
>;
async function saveAttempt(root: ProjectRoot, attempt: PublicationAttempt) {
  await writeMetadata(
    root,
    `.savia/receipts/${attempt.sha256}.json`,
    JSON.stringify(publicationAttemptSchema.parse(attempt), null, 2) + "\n",
  );
}
export async function publishPrepared(
  publication: PreparedPublication,
  client: PluginDevelopmentClient,
  guard: PublicationGuard,
) {
  assertPublication(guard);
  if (
    client.profile.origin !== publication.profile.origin ||
    client.profile.tenantId !== publication.profile.tenantId
  )
    throw new Error("The selected connection does not match this artifact.");
  await readProjectDescriptor(publication.root, publication.profile);
  const attempt: PublicationAttempt = {
    schemaVersion: 1,
    origin: publication.profile.origin,
    tenantId: publication.profile.tenantId,
    sha256: publication.sha256,
    input: publication.input,
    state: "prepared",
    createdAt: new Date().toISOString(),
  };
  await writeMetadata(
    publication.root,
    `.savia/artifacts/${publication.sha256}.zip`,
    publication.zipBytes,
    true,
  );
  await saveAttempt(publication.root, attempt);
  assertPublication(guard);
  let receipt: PluginPublicationReceipt;
  try {
    receipt = await client.publish(publication.input, publication.zipBytes);
    assertPublication(guard);
  } catch (error) {
    attempt.state =
      typeof error === "object" &&
      error &&
      "status" in error &&
      [400, 401, 403, 404, 409, 413, 422].includes(Number(error.status))
        ? "rejected"
        : "uncertain";
    await saveAttempt(publication.root, attempt).catch(() => undefined);
    throw error;
  }
  attempt.state = "confirmed";
  attempt.receipt = receipt;
  let receiptSaved = true;
  try {
    await saveAttempt(publication.root, attempt);
  } catch {
    receiptSaved = false;
  }
  return {
    receipt,
    attempt,
    receiptSaved,
    artifactPath: `.savia/artifacts/${publication.sha256}.zip`,
  };
}
export async function listPublicationAttempts(
  rootUri: ProjectRoot,
  profile: ConnectionProfile,
) {
  const descriptor = await readProjectDescriptor(rootUri, profile);
  const { path: root } = await resolveProjectRoot(rootUri);
  const directory = await assertNoSymlinks(root, ".savia/receipts");
  let names: string[];
  try {
    names = await fs.readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  if (names.length > 1000)
    throw new Error("Publication history exceeds its local limit.");
  const attempts: PublicationAttempt[] = [];
  for (const name of names) {
    if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
    const attempt = publicationAttemptSchema.parse(
      JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          await readProjectFile(root, `.savia/receipts/${name}`, 64 * 1024),
        ),
      ),
    );
    if (
      attempt.sha256 + ".json" !== name ||
      attempt.origin !== profile.origin ||
      attempt.tenantId !== profile.tenantId ||
      attempt.input.pluginId !== descriptor.pluginId
    )
      throw new Error(
        "Publication receipt does not match the selected connection.",
      );
    attempts.push(attempt);
  }
  return attempts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function recoverPublication(
  rootUri: ProjectRoot,
  profile: ConnectionProfile,
  sha256: string,
  client: PluginDevelopmentClient,
  guard: PublicationGuard,
) {
  assertPublication(guard);
  pluginDigestSchema.parse(sha256);
  const attempt = (await listPublicationAttempts(rootUri, profile)).find(
    (row) => row.sha256 === sha256,
  );
  if (!attempt)
    throw new Error("The retained publication receipt is unavailable.");
  const { path: root } = await resolveProjectRoot(rootUri);
  const zipBytes = await readProjectFile(
    root,
    `.savia/artifacts/${sha256}.zip`,
    6 * 1024 * 1024,
  );
  if (createHash("sha256").update(zipBytes).digest("hex") !== sha256)
    throw new Error("The retained artifact has a different digest.");
  if (
    client.profile.origin !== profile.origin ||
    client.profile.tenantId !== profile.tenantId
  )
    throw new Error("The selected connection does not match this artifact.");
  assertPublication(guard);
  const metadata = {
    ...attempt.input,
    mode:
      attempt.input.destination === "shared" && attempt.receipt
        ? ("retry-shared" as const)
        : ("create" as const),
  };
  const receipt: PluginPublicationReceipt = await client.publish(
    metadata,
    zipBytes,
  );
  assertPublication(guard);
  attempt.state = "confirmed";
  attempt.receipt = receipt;
  let receiptSaved = true;
  try {
    await saveAttempt(rootUri, attempt);
  } catch {
    receiptSaved = false;
  }
  return {
    receiptSaved,
    receipt,
    attempt,
    artifactPath: `.savia/artifacts/${sha256}.zip`,
  };
}
