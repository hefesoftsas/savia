import type { CrmObject } from "@savia/crm-shared/metadata";
export type CollectionCapabilities = {
  list: boolean;
  read: boolean;
  create: boolean;
  update: boolean;
  delete: boolean;
  schema: boolean;
  customFields: boolean;
  search?: boolean;
  filter?: boolean;
  sort?: boolean;
};
const local: CollectionCapabilities = {
  list: true,
  read: true,
  create: true,
  update: true,
  delete: true,
  schema: true,
  customFields: true,
};
export function collectionCapabilities(
  object: CrmObject,
): CollectionCapabilities {
  const studio = object.config.studio as CrmObject["config"]["studio"] & {
    capabilities?: CollectionCapabilities;
    collection?: {
      capabilities: CollectionCapabilities;
      kind?: "domain" | "jsonapi" | "postgres" | "crm";
      domain?: string;
      collection?: string;
    };
  };
  if (
    studio?.collection?.kind === "domain" &&
    studio.collection.domain === "agency-network" &&
    studio.collection.collection === "agency-profiles"
  )
    return {
      ...(studio.capabilities ?? studio.collection.capabilities),
      filter: true,
      sort: true,
    };
  if (studio?.capabilities) return studio.capabilities;
  if (studio?.collection) return studio.collection.capabilities;
  if (studio?.business === "managed-agency")
    return { ...local, delete: false, schema: false };
  if (studio?.business === "managed-customer")
    return { ...local, schema: false };
  return local;
}
/** Trash, import and bulk mutations are a local-storage contract, not implied by individual writes. */
export function supportsLocalRecordTools(object: CrmObject): boolean {
  const studio = object.config.studio as CrmObject["config"]["studio"] & {
    capabilities?: CollectionCapabilities;
    collection?: unknown;
  };
  return (
    !studio?.collection &&
    !studio?.capabilities &&
    !["managed-customer", "managed-agency"].includes(studio?.business ?? "")
  );
}
