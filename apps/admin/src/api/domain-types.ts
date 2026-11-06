export type DocumentScalar = string | number | boolean | null;
export type DocumentValue =
  DocumentScalar | DocumentValue[] | { [key: string]: DocumentValue };

export type PublicDocument = {
  id: string;
  kind: string;
  attributes: Record<string, DocumentValue>;
  relationships: Record<string, PublicDocument | PublicDocument[]>;
};

export type PublicDocumentPage = {
  data: PublicDocument[];
  page: { limit: number; offset: number };
};

export type CommandInputDescriptor = {
  name: string;
  type: "string" | "integer" | "number" | "boolean" | "array";
  required: boolean;
  description: string;
};

export type CommandDescriptor = {
  domain: string;
  command: string;
  title: string;
  description: string;
  input: CommandInputDescriptor[];
};

export type CollectionDescriptor = {
  domain: string;
  collection: string;
  title: string;
  description: string;
};

export type DomainDescriptor = {
  id: string;
  collections: CollectionDescriptor[];
  commands: CommandDescriptor[];
};

export type SaviaRecord = PublicDocument["attributes"] & {
  id: string;
  kind: string;
  relationships: PublicDocument["relationships"];
  document: PublicDocument;
};

export function resourceLocator(resource: string): {
  domain: string;
  collection: string;
} {
  const [domain, collection, ...rest] = resource.split("/");
  if (!domain || !collection || rest.length > 0) {
    throw new Error(`Invalid Savia resource: ${resource}`);
  }
  return { domain, collection };
}

export function toSaviaRecord(document: PublicDocument): SaviaRecord {
  return {
    id: document.id,
    kind: document.kind,
    ...document.attributes,
    relationships: document.relationships,
    document,
  };
}
