import type { SchemaService } from "@savia/flows-runtime";
import type { Schema } from "@savia/flows-types";

import type { Bindings } from "../context";
import { createDatabase, getSchema } from "../db";

/**
 * Cloudflare-backed SchemaService.
 * Resolves schema IDs to Schema definitions via D1.
 */
export class CloudflareSchemaService implements SchemaService {
  constructor(private env: Pick<Bindings, "DB">) {}

  async resolve(
    schemaId: string,
    organizationId: string
  ): Promise<Schema | undefined> {
    const db = createDatabase(this.env.DB);
    const row = await getSchema(db, schemaId, organizationId);

    if (!row) return undefined;

    return {
      id: schemaId,
      name: row.name,
      description: row.description,
      fields: JSON.parse(row.fields),
    };
  }
}
