import { parse } from "yaml";
import type { IFieldConfig } from "@form-eng/core";
import { makeConfig, type StudioObject } from "./metadata";
import {
  resolveSchema,
  materializeSchema,
  type SchemaNode,
} from "./json-schema";
export {
  resolveSchema,
  materializeSchema,
  validateJsonSchema,
} from "./json-schema";
export type { SchemaNode } from "./json-schema";
const forbidden = new Set(["__proto__", "constructor", "prototype"]);
export const MAX_DOCUMENT_BYTES = 1024 * 1024;
export function readDocument(input: unknown): SchemaNode {
  if (
    typeof input === "string" &&
    new TextEncoder().encode(input).length > MAX_DOCUMENT_BYTES
  )
    throw new Error("Máximo 1 MB por contrato.");
  const doc =
    typeof input === "string" ? parse(input, { maxAliasCount: 30 }) : input;
  if (!doc || typeof doc !== "object" || !/^3\.[01]\./.test(doc.openapi ?? ""))
    throw new Error("Se necesita OpenAPI 3.0 o 3.1.");
  if (JSON.stringify(doc).length > MAX_DOCUMENT_BYTES)
    throw new Error("Máximo 1 MB por contrato.");
  const visit = (value: any, depth = 0) => {
    if (depth > 40) throw new Error("El documento excede 40 niveles.");
    if (value && typeof value === "object")
      for (const key of Object.keys(value)) {
        if (forbidden.has(key))
          throw new Error("El documento contiene claves reservadas.");
        visit(value[key], depth + 1);
      }
  };
  visit(doc);
  if (
    Object.keys(doc.paths ?? {}).length > 200 ||
    Object.keys(doc.components?.schemas ?? {}).length > 200
  )
    throw new Error("Máximo 200 rutas y 200 esquemas.");
  return doc;
}
function flattenObject(schema: SchemaNode): SchemaNode {
  const result = {
    ...schema,
    properties: { ...schema.properties },
    required: [...(schema.required ?? [])],
  };
  for (const branch of schema.allOf ?? []) {
    const flat = flattenObject(branch);
    for (const [key, value] of Object.entries(flat.properties))
      result.properties[key] = result.properties[key]
        ? { allOf: [result.properties[key], value] }
        : value;
    result.required = [...new Set([...result.required, ...flat.required])];
  }
  return result;
}
export function schemaToObject(
  document: SchemaNode,
  schema: SchemaNode,
  name: string,
): StudioObject {
  const resolved = flattenObject(materializeSchema(document, schema));
  if (
    resolved.oneOf ||
    resolved.anyOf ||
    !Object.keys(resolved.properties ?? {}).length
  )
    throw new Error(
      "Para crear un objeto selecciona propiedades de objeto; las uniones se admiten dentro de campos JSON.",
    );
  const fields: Record<string, IFieldConfig> = {};
  for (const [key, raw] of Object.entries(resolved.properties)) {
    const value = raw as SchemaNode;
    if (value.readOnly) continue;
    if (!/^[a-z][a-z0-9_]{0,47}$/.test(key) || forbidden.has(key))
      throw new Error(
        `El campo ${key} necesita un identificador CRM en minúsculas.`,
      );
    const typeValue = Array.isArray(value.type)
      ? value.type.find((t: string) => t !== "null")
      : value.type;
    const nested =
      typeValue === "array" ||
      typeValue === "object" ||
      value.properties ||
      value.allOf ||
      value.oneOf ||
      value.anyOf;
    const dropdown =
      value.enum && value.enum.every((v: unknown) => typeof v === "string");
    const type = nested
      ? "Textarea"
      : dropdown
        ? "Dropdown"
        : ["integer", "number"].includes(typeValue)
          ? "Number"
          : typeValue === "boolean"
            ? "Toggle"
            : value.format === "email"
              ? "Email"
              : value.format === "uri"
                ? "Url"
                : value.format === "date"
                  ? "DateControl"
                  : "Textbox";
    fields[key] = {
      type,
      label: value.title ?? key,
      required: resolved.required.includes(key),
      description: nested
        ? `${value.description ?? ""} JSON validado según el contrato.`.trim()
        : value.description,
      ...(dropdown
        ? { options: value.enum.map((v: string) => ({ value: v, label: v })) }
        : {}),
      ...("default" in value
        ? {
            defaultValue: nested
              ? JSON.stringify(value.default)
              : value.default,
          }
        : {}),
      config: {
        validationSchema: value,
        ...(type === "Textbox" && ["email", "uri"].includes(value.format)
          ? { format: value.format === "uri" ? "url" : value.format }
          : {}),
        ...(typeValue === "integer" ? { integer: true } : {}),
        ...Object.fromEntries(
          ["minimum", "maximum", "minLength", "maxLength", "pattern"]
            .filter((k) => value[k] !== undefined)
            .map((k) => [k, value[k]]),
        ),
        ...(nested ? { jsonSchema: value } : {}),
      },
    };
  }
  return {
    name,
    label: resolved.title ?? name,
    description: resolved.description ?? "Creado desde OpenAPI",
    config: makeConfig(fields),
    version: 1,
  } as StudioObject;
}
export type ApiOperation = {
  id: string;
  method: string;
  path: string;
  summary: string;
  object: StudioObject | null;
  parameters: SchemaNode[];
  bodySchema?: SchemaNode;
  bodyRequired: boolean;
  responses: SchemaNode;
  error?: string;
};
export function inspectDocument(input: unknown) {
  const document = readDocument(input);
  const operations: ApiOperation[] = [];
  const ids = new Set<string>();
  for (const [path, rawItem] of Object.entries(document.paths ?? {})) {
    const item = resolveSchema(document, rawItem as SchemaNode);
    for (const [method, raw] of Object.entries(item)) {
      if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
      const op = raw as SchemaNode,
        id = op.operationId ?? `${method}:${path}`;
      if (ids.has(id)) throw new Error(`operationId duplicado: ${id}`);
      ids.add(id);
      let object: StudioObject | null = null,
        bodySchema: SchemaNode | undefined,
        error: string | undefined;
      let parameters: SchemaNode[] = [];
      let bodyRequired = false;
      try {
        const params = [
          ...(item.parameters ?? []),
          ...(op.parameters ?? []),
        ].map((p) => resolveSchema(document, p));
        parameters = [
          ...new Map(params.map((p) => [`${p.in}:${p.name}`, p])).values(),
        ].map((p) => {
          if (!["path", "query", "header"].includes(p.in))
            throw new Error("Solo parámetros path, query y header.");
          if (
            (p.style && p.style !== (p.in === "query" ? "form" : "simple")) ||
            (p.explode === false && p.in === "query") ||
            p.content
          )
            throw new Error(
              "Serialización de parámetro no admitida. Usa escalares o arrays form/explode.",
            );
          return {
            ...p,
            schema: materializeSchema(document, p.schema ?? { type: "string" }),
          };
        });
        if (op.requestBody) {
          const body = resolveSchema(document, op.requestBody);
          bodyRequired = !!body.required;
          if (!body.content?.["application/json"]?.schema)
            throw new Error("Solo requestBody application/json.");
          bodySchema = materializeSchema(
            document,
            body.content["application/json"].schema,
          );
          try {
            object = schemaToObject(document, bodySchema, "action");
          } catch {
            /* A JSON editor covers scalar and union payloads. */
          }
        }
        for (const response of Object.values(op.responses ?? {})) {
          const content = resolveSchema(
            document,
            response as SchemaNode,
          ).content;
          if (content?.["application/json"]?.schema)
            materializeSchema(document, content["application/json"].schema);
        }
      } catch (e) {
        error = (e as Error).message;
      }
      operations.push({
        id,
        method: method.toUpperCase(),
        path,
        summary: op.summary ?? path,
        object,
        parameters,
        bodySchema,
        bodyRequired,
        responses: op.responses ?? {},
        error,
      });
    }
  }
  return {
    document,
    title: document.info?.title ?? "API importada",
    schemas: Object.keys(document.components?.schemas ?? {}),
    operations,
  };
}
