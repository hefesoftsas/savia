import type {
  DomainCollection,
  DomainDocument,
  CommandDescriptor,
} from "../domains/contracts";
import type { EndpointCandidate } from "@savia/studio-shared/collection-operations";
import { HTTPException } from "hono/http-exception";

/** Optional collection capabilities supplied by a separately composed service. */
export interface CollectionDomainProvider {
  collectionsForTenant(
    db: D1Database,
    tenant: string,
  ): Promise<readonly DomainCollection[]>;
  listCollections(): readonly DomainCollection[];
  isQueryableCollection(domain?: string, collection?: string): boolean;
  domainWriteContract(
    tenant: string,
    domain?: string,
    collection?: string,
  ):
    { domain: string; stem: string; paths: Record<string, string> } | undefined;
  configureDomainWrites(
    tenant: string,
    config: any,
    fields: Record<string, any>,
  ): boolean;
  readDomainPath(document: DomainDocument, path: string[]): unknown;
  executeDomainWrite(
    db: D1Database,
    tenant: string,
    config: any,
    operation: "create" | "update" | "delete",
    body: Record<string, unknown>,
    existing?: DomainDocument,
    id?: string,
  ): Promise<DomainDocument>;
  registeredCandidates(tenant: string, config: any): EndpointCandidate[];
  registeredCollectionCommands(
    tenant: string,
    config: any,
  ): CommandDescriptor[];
  installCommandFields(
    tenant: string,
    config: any,
    object: any,
    operations: any,
  ): void;
}

/** Core has no built-in domain registry, commands, or database requirements. */
export const emptyCollectionDomainProvider: CollectionDomainProvider = {
  collectionsForTenant: async () => [],
  listCollections: () => [],
  isQueryableCollection: () => false,
  domainWriteContract: () => undefined,
  configureDomainWrites: () => false,
  readDomainPath: () => undefined,
  executeDomainWrite: async () => {
    throw new HTTPException(404, { message: "Colección no disponible." });
  },
  registeredCandidates: () => [],
  registeredCollectionCommands: () => [],
  installCommandFields: () => {},
};
