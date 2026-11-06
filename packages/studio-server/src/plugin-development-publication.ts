import {
  pluginPublicationRequestSchema,
  pluginPublicationReceiptSchema,
  type PluginPublicationRequest,
  type PluginPublicationReceipt,
} from "@savia/studio-shared/plugin-development";
import {
  canonicalJson,
  compareSolutionVersions,
} from "@savia/studio-shared/solution-package";
import {
  parsePluginStoreZip,
  persistParsedStoreArtifact,
  type PluginStoreOptions,
} from "./plugin-store";
import {
  assertPluginDevelopmentScope,
  readPublicationSnapshot,
  resolvePublishedPluginFiles,
  pluginSourceDigest,
  authoredPluginEntryPath,
  type PluginDevelopmentScope,
  type PublicationSnapshot,
} from "./plugin-development-snapshot";
import {
  getPluginRegistryState,
  publishPluginRegistryRelease,
  PluginRegistryPublishError,
} from "./plugin-registry";
import { guard } from "./services";
import { fail } from "./context";
import { decodePluginFilesJson } from "./plugin-file-storage";

function publicationGuards(
  db: D1Database,
  scope: PluginDevelopmentScope,
  pluginId: string,
  snapshot: PublicationSnapshot,
  sourceVersion: string,
) {
  const guards = [
    guard(
      db,
      "SELECT count(*)=? FROM plugin_store_artifacts WHERE tenant_id=? AND id=?",
      [snapshot.artifacts.length, scope.tenantId, pluginId],
    ),
  ];
  for (const artifact of snapshot.artifacts)
    guards.push(
      guard(
        db,
        "SELECT EXISTS(SELECT 1 FROM plugin_store_artifacts WHERE tenant_id=? AND id=? AND version=? AND sha256=?)",
        [scope.tenantId, pluginId, artifact.version, artifact.sha256],
      ),
    );
  const source = snapshot.sources.find((row) => row.version === sourceVersion);
  if (!source) fail("The selected source changed or was removed.", 409);
  guards.push(
    guard(
      db,
      "SELECT EXISTS(SELECT 1 FROM plugin_store_sources WHERE tenant_id=? AND id=? AND version=? AND files=?)",
      [scope.tenantId, pluginId, source.version, source.files],
    ),
  );
  return { start: guards.map((g) => g.start), end: guards.map((g) => g.end) };
}
export async function publishPluginDevelopment(
  db: D1Database,
  scope: PluginDevelopmentScope,
  request: PluginPublicationRequest,
  zipBytes: Uint8Array,
  options: PluginStoreOptions,
): Promise<PluginPublicationReceipt> {
  const input = pluginPublicationRequestSchema.parse(request);
  await assertPluginDevelopmentScope(scope, input.pluginId);
  const registry = options.pluginRegistry;
  if (input.destination === "shared" && !registry?.publishToken)
    fail("The shared plugin publisher is not configured.", 403);
  const parsed = await parsePluginStoreZip(zipBytes);
  if (
    parsed.manifest.id !== input.pluginId ||
    parsed.manifest.version !== input.version
  )
    fail("The ZIP does not match the publication coordinate.", 422);
  if (!parsed.sourceFiles)
    fail("Native publication requires authored source files.", 422);
  authoredPluginEntryPath(parsed.sourceFiles);
  const snapshot = await readPublicationSnapshot(
    db,
    scope.tenantId,
    input.pluginId,
    input.sourceVersion,
  );
  const source = snapshot.sources.find(
    (row) => row.version === input.sourceVersion,
  );
  if (!snapshot.head || !snapshot.selectedArtifact || !source)
    fail("The selected source changed or was removed.", 409);
  const base = await resolvePublishedPluginFiles(
    snapshot.selectedArtifact,
    source.files,
  );
  if (
    base.authoringKind !== "authored" ||
    (await pluginSourceDigest(base.files)) !== input.sourceSha256
  )
    fail("The selected source changed or was removed.", 409);
  const existing = snapshot.artifacts.find(
    (row) => row.version === input.version,
  );
  const existingSource = snapshot.sources.find(
    (row) => row.version === input.version,
  );
  let replay = false;
  if (existing) {
    if (
      existing.sha256 !== parsed.sha256 ||
      !existingSource ||
      canonicalJson(
        JSON.parse(await decodePluginFilesJson(existingSource.files)),
      ) !== canonicalJson(parsed.sourceFiles)
    )
      fail("The retained local artifact changed or was removed.", 409);
    replay = true;
  } else if (input.mode === "retry-shared")
    fail("The retained local artifact changed or was removed.", 409);
  if (!replay) {
    if (canonicalJson(snapshot.head) !== canonicalJson(input.expectedHead))
      fail("Plugin head changed. Compare and rebase before publishing.", 409);
    if (compareSolutionVersions(input.version, snapshot.head.version) <= 0)
      fail("The new version must be greater than the current head.", 409);
  }
  let sharedState:
    Awaited<ReturnType<typeof getPluginRegistryState>> | undefined;
  if (input.destination === "shared" && registry) {
    try {
      sharedState = await getPluginRegistryState(
        registry,
        input.pluginId,
        input.version,
      );
    } catch (error) {
      if (!replay) throw error;
    }
    if (
      !replay &&
      sharedState?.head &&
      compareSolutionVersions(input.version, sharedState.head.version) <= 0
    )
      fail("The new version must be greater than the shared head.", 409);
  }
  await assertPluginDevelopmentScope(scope, input.pluginId);
  if (!replay)
    await persistParsedStoreArtifact(
      db,
      scope.tenantId,
      scope.principalId,
      parsed,
      publicationGuards(
        db,
        scope,
        input.pluginId,
        snapshot,
        input.sourceVersion,
      ),
    );
  const current = await readPublicationSnapshot(
    db,
    scope.tenantId,
    input.pluginId,
  );
  const local = current.artifacts.find((row) => row.version === input.version);
  if (!local || !current.head || local.sha256 !== parsed.sha256)
    fail("The retained local artifact changed or was removed.", 409);
  const receipt: PluginPublicationReceipt = {
    state: "published",
    destination: input.destination,
    local: {
      pluginId: input.pluginId,
      version: input.version,
      sha256: local.sha256,
    },
    head: current.head,
    sharedHead: sharedState?.head ?? null,
    issues: [],
  };
  if (input.destination === "tenant")
    return pluginPublicationReceiptSchema.parse(receipt);
  if (!registry) fail("The shared plugin publisher is not configured.", 403);
  await assertPluginDevelopmentScope(scope, input.pluginId);
  if (
    replay &&
    sharedState?.head &&
    compareSolutionVersions(input.version, sharedState.head.version) <= 0 &&
    !sharedState.release
  )
    return pluginPublicationReceiptSchema.parse({
      ...receipt,
      state: "shared-conflict",
      issues: [
        {
          code: "SHARED_HEAD_CHANGED",
          message:
            "A newer shared head prevents creating this missing release. The local release is retained.",
        },
      ],
    });
  try {
    const reply = await publishPluginRegistryRelease(
      registry,
      parsed,
      zipBytes,
    );
    receipt.shared = {
      pluginId: reply.data.id,
      version: reply.data.version,
      sha256: reply.data.sha256,
    };
    try {
      receipt.sharedHead = (
        await getPluginRegistryState(registry, input.pluginId)
      ).head;
    } catch {
      receipt.sharedHead = null;
      receipt.issues.push({
        code: "SHARED_HEAD_UNAVAILABLE",
        message:
          "The shared release was published, but its latest status could not be checked.",
      });
    }
  } catch (error) {
    const conflict =
      error instanceof PluginRegistryPublishError && error.status === 409;
    receipt.state = conflict ? "shared-conflict" : "shared-pending";
    receipt.issues = [
      {
        code: conflict ? "REGISTRY_CONFLICT" : "REGISTRY_UNAVAILABLE",
        message: conflict
          ? "The shared coordinate contains another release. The local release is retained."
          : "The shared release could not be confirmed. Retry the retained ZIP; the local release is retained.",
      },
    ];
  }
  return pluginPublicationReceiptSchema.parse(receipt);
}
