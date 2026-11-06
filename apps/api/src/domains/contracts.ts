export type DocumentScalar = string | number | boolean | null;
export type DocumentValue =
  DocumentScalar | DocumentValue[] | { [key: string]: DocumentValue };

export type DomainDocument = {
  id: string;
  kind: string;
  attributes: Record<string, DocumentValue>;
  relationships: Record<string, DomainDocument | DomainDocument[]>;
};

export type CollectionPage = {
  data: DomainDocument[];
  page: { limit: number; offset: number; total?: number };
};

export type CollectionQuery = {
  limit: number;
  offset: number;
  agencyId?: number;
  q?: string;
  source?: "direct" | "prospect";
  /** Internal authorization scope supplied by the domain route. */
  authorizedAgencyIds?: number[];
};

export type CollectionDescriptor = {
  domain: string;
  collection: string;
  title: string;
  description: string;
};

export type DomainCollection = {
  descriptor: CollectionDescriptor;
  listQuerySchema?: z.ZodObject;
  list(d1: D1Database, query: CollectionQuery): Promise<CollectionPage>;
  find(d1: D1Database, id: string): Promise<DomainDocument | undefined>;
};

export type CommandDescriptor = {
  collectionBinding?: {
    collection: string;
    operation: "create" | "update" | "delete";
    fieldPaths: Record<string, string>;
  };
  domain: string;
  command: string;
  title: string;
  description: string;
  input: CommandInputDescriptor[];
};

export type CommandInputDescriptor = {
  name: string;
  type: "string" | "integer" | "number" | "boolean" | "array";
  required: boolean;
  description: string;
};

export type DomainExecutionContext = {
  documents?: R2Bucket;
  r2Credentials?: {
    accountId: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
  };
};

export class DomainCommandError extends Error {
  constructor(
    public readonly code:
      "VALIDATION_ERROR" | "DEPENDENCY_NOT_FOUND" | "CONFLICT" | "NOT_FOUND",
    message: string,
  ) {
    super(message);
  }
}

export type DomainCommand = {
  descriptor: CommandDescriptor;
  inputSchema?: z.ZodType;
  execute(
    d1: D1Database,
    input: unknown,
    context?: DomainExecutionContext,
  ): Promise<DomainDocument>;
};

export function domainCommandStatus(
  error: DomainCommandError,
): 400 | 404 | 409 {
  if (error.code === "NOT_FOUND") return 404;
  if (error.code === "CONFLICT") return 409;
  return 400;
}
import type { z } from "@hono/zod-openapi";
