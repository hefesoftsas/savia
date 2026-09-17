import { HTTPException } from "hono/http-exception";
import {
  emptyCollectionDomainProvider,
  type CollectionDomainProvider,
} from "./collection-domain-provider";
import {
  collectionOptionsSchema,
  optionPath,
} from "@savia/crm-shared/collection-options";

export async function loadCollectionOptions(
  db: D1Database,
  source: unknown,
  page = 1,
  provider: CollectionDomainProvider = emptyCollectionDomainProvider,
) {
  const config = collectionOptionsSchema.parse(source);
  const collection = provider
    .listCollections()
    .find(
      (item) =>
        item.descriptor.domain === config.domain &&
        item.descriptor.collection === config.collection,
    );
  if (!collection)
    throw new HTTPException(422, {
      message: "La colección de opciones no está disponible.",
    });
  const result = await collection.list(db, {
    limit: 51,
    offset: (page - 1) * 50,
  });
  return {
    data: result.data.slice(0, 50).flatMap((record) => {
      const value = optionPath(record, config.valueField),
        label = optionPath(record, config.labelField);
      return (typeof value === "string" || typeof value === "number") &&
        (typeof label === "string" || typeof label === "number")
        ? [{ value: String(value), label: String(label) }]
        : [];
    }),
    hasNext: result.data.length > 50,
  };
}

export async function assertCollectionOption(
  db: D1Database,
  source: unknown,
  value: unknown,
  provider: CollectionDomainProvider = emptyCollectionDomainProvider,
) {
  if (value === "" || value === null || value === undefined) return;
  const config = collectionOptionsSchema.parse(source);
  const collection = provider
    .listCollections()
    .find(
      (item) =>
        item.descriptor.domain === config.domain &&
        item.descriptor.collection === config.collection,
    );
  if (!collection)
    throw new HTTPException(422, {
      message: "La colección de opciones no está disponible.",
    });
  if (config.valueField === "id") {
    if (await collection.find(db, String(value))) return;
  } else {
    for (let page = 1; page <= 100; page++) {
      const options = await loadCollectionOptions(db, config, page, provider);
      if (options.data.some((option) => option.value === String(value))) return;
      if (!options.hasNext) break;
    }
  }
  throw new HTTPException(422, {
    message: "Selecciona un valor válido de la colección configurada.",
  });
}
