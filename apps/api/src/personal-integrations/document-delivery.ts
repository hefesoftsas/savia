import type {
  DocumentDeliveryBridge,
  DocumentProvider,
} from "@savia/studio-server/document-delivery";
import type { PersonalIntegrationRouteDependencies } from "../routes/personal-integrations";
import { createPersonalIntegrationRepository } from "./repository";
import { PersonalIntegrationOperations } from "./operations";

/** Credentials and confirmation ciphertext never cross into the Studio renderer. */
export function documentDeliveryBridge(
  db: D1Database,
  principalId: string,
  dependencies?: PersonalIntegrationRouteDependencies,
  actorName?: string,
): DocumentDeliveryBridge | undefined {
  if (!dependencies?.nango || !dependencies.personalActionPayloadCipher)
    return undefined;
  const repository = createPersonalIntegrationRepository(db);
  const operations = new PersonalIntegrationOperations(
    repository,
    dependencies.nango,
  );
  const cipher = dependencies.personalActionPayloadCipher;
  return {
    actorName,
    connections: async () =>
      (await repository.listConnections(principalId))
        .filter(
          (c) =>
            ["outlook", "onedrive_personal", "onedrive_business"].includes(
              c.provider,
            ) && dependencies.providers[c.provider].availability === "enabled",
        )
        .map((c) => ({
          id: `${c.id}:${c.updatedAt}`,
          provider: c.provider as DocumentProvider,
          status: c.status,
          externalAccountLabel: c.externalAccountLabel,
        })),
    folders: (provider, parentId) =>
      operations.listDocumentFolders({ principalId, provider, parentId }),
    saveCopy: ({ connectionKey, ...input }) =>
      operations.saveDocumentCopy({
        principalId,
        expectedConnectionKey: connectionKey,
        ...input,
      }),
    sendEmail: ({ connectionKey, ...input }) =>
      operations.sendDocumentEmail({
        principalId,
        expectedConnectionKey: connectionKey,
        ...input,
      }),
    seal: (actionId, payload) =>
      cipher.seal({ actionId, principalId, payload }),
    unseal: (actionId, token) =>
      cipher.unseal({
        actionId,
        principalId,
        storedInput: { sealedPayload: token },
      }),
  };
}
