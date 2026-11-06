type DetailPersistenceCollection<T> = {
  describe(): Promise<
    { config?: { fields?: Record<string, unknown> } } | undefined
  >;
  update(
    id: string,
    patch: Record<string, unknown>,
    options?: { version?: number },
  ): Promise<T>;
};

const schemaReads = new WeakMap<object, Promise<Record<string, unknown>>>();

async function resultFields<T>(collection: DetailPersistenceCollection<T>) {
  let pending = schemaReads.get(collection);
  if (!pending) {
    pending = collection.describe().then((definition) => {
      const fields = definition?.config?.fields;
      if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
        throw new Error(
          "The quote detail schema is unavailable. The result could not be saved.",
        );
      }
      return fields;
    });
    schemaReads.set(collection, pending);
  }
  try {
    return await pending;
  } catch (error) {
    schemaReads.delete(collection);
    throw error;
  }
}

const optionalResultFields = ["resultado_snapshot", "duracion_ms"] as const;

/** Preserve core results on installations predating the optional result fields. */
export async function persistQuoteDetail<T>(
  collection: DetailPersistenceCollection<T>,
  id: string,
  patch: Record<string, unknown>,
  options?: { version?: number },
): Promise<{ record: T; omittedFields: string[] }> {
  const input = { ...patch };
  const omittedFields: string[] = [];
  if (optionalResultFields.some((field) => Object.hasOwn(input, field))) {
    const fields = await resultFields(collection);
    for (const field of optionalResultFields) {
      if (Object.hasOwn(input, field) && !Object.hasOwn(fields, field)) {
        delete input[field];
        omittedFields.push(field);
      }
    }
  }
  const record = await collection.update(id, input, options);
  return { record, omittedFields };
}
