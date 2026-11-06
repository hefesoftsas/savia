import { z } from "zod";
import type { StudioObject } from "./metadata";

const identifier = z.string().regex(/^[a-z][a-z0-9_]{0,47}$/);
const scalarValue = z.union([z.string(), z.number().finite(), z.boolean()]);

export const pluginLookupSchema = z
  .object({
    collection: identifier,
    labelField: identifier,
    searchFields: z.array(identifier).min(1).max(5),
    idField: identifier,
    filter: z
      .object({ field: identifier, value: scalarValue })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((lookup, ctx) => {
    if (new Set(lookup.searchFields).size !== lookup.searchFields.length)
      ctx.addIssue({
        code: "custom",
        message: "Search fields must be unique.",
      });
  });

export type PluginLookup = z.infer<typeof pluginLookupSchema>;

export type PluginLookupTargetField = {
  type?: unknown;
  hidden?: unknown;
  readOnly?: unknown;
  computedValue?: unknown;
  config?: Record<string, unknown> | null;
};

/** Return a valid lookup mapping from a field, or undefined when it has none. */
export function getPluginLookup(field: unknown): PluginLookup | undefined {
  if (!field || typeof field !== "object") return undefined;
  const config = (field as PluginLookupTargetField).config;
  if (!config || typeof config !== "object" || !("pluginLookup" in config))
    return undefined;
  const parsed = pluginLookupSchema.safeParse(config.pluginLookup);
  return parsed.success ? parsed.data : undefined;
}

const scalarFieldTypes = new Set([
  "Textbox",
  "Textarea",
  "Email",
  "Phone",
  "Url",
  "Number",
  "Currency",
  "Percentage",
  "Rating",
  "Dropdown",
  "Autocomplete",
  "Toggle",
  "DateControl",
  "DateTime",
  "Time",
]);

export function isLookupScalar(
  field: PluginLookupTargetField | undefined,
): boolean {
  return Boolean(
    field &&
    scalarFieldTypes.has(String(field.type)) &&
    field.hidden !== true &&
    !field.config?.relation &&
    !field.config?.collectionOptions &&
    !field.config?.jsonSchema,
  );
}

function supportsLookupRead(object: StudioObject): boolean {
  const studio = object.config.studio as
    | {
        collection?: { capabilities?: { list?: boolean; read?: boolean } };
        capabilities?: { list?: boolean; read?: boolean };
      }
    | undefined;
  const capabilities = studio?.collection?.capabilities ?? studio?.capabilities;
  return capabilities
    ? capabilities.list === true && capabilities.read === true
    : true;
}

function lookupCapabilities(object: StudioObject) {
  const studio = object.config.studio as
    | {
        collection?: {
          capabilities?: {
            search?: boolean;
            filter?: boolean;
            list?: boolean;
            read?: boolean;
          };
        };
        capabilities?: {
          search?: boolean;
          filter?: boolean;
          list?: boolean;
          read?: boolean;
        };
      }
    | undefined;
  return studio?.collection?.capabilities ?? studio?.capabilities;
}

/**
 * Validate target collection and field references for every lookup declared on
 * an object. Tenant-aware callers should pass only same-tenant definitions the
 * actor is allowed to discover; collection reads still go through normal ACLs.
 */
export function validatePluginLookupTargets(
  object: StudioObject,
  definitions: readonly StudioObject[],
): string[] {
  const issues: string[] = [];
  const byName = new Map(
    definitions.map((definition) => [definition.name, definition]),
  );

  for (const [sourceName, source] of Object.entries(object.config.fields)) {
    const lookup = getPluginLookup(source);
    if (!lookup) continue;
    const target = byName.get(lookup.collection);
    if (!target) {
      issues.push(`${sourceName}: lookup collection does not exist.`);
      continue;
    }
    if (!supportsLookupRead(target))
      issues.push(
        `${sourceName}: lookup collection must support list and read.`,
      );
    const capabilities = lookupCapabilities(target);
    if (capabilities?.search === false)
      issues.push(`${sourceName}: lookup collection does not support search.`);
    if (lookup.filter && capabilities?.filter === false)
      issues.push(
        `${sourceName}: lookup collection does not support filtering.`,
      );

    const targetFields = target.config.fields as Record<
      string,
      PluginLookupTargetField
    >;
    for (const name of [lookup.labelField, ...lookup.searchFields]) {
      if (!isLookupScalar(targetFields[name]))
        issues.push(
          `${sourceName}: lookup field ${name} must be a visible scalar field.`,
        );
    }
    if (lookup.filter && !isLookupScalar(targetFields[lookup.filter.field]))
      issues.push(
        `${sourceName}: lookup filter field ${lookup.filter.field} must be a visible scalar field.`,
      );
  }
  return issues;
}
