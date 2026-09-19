import { z } from "zod";
import { readDocument, materializeSchema } from "./openapi";
export const operationNames = [
  "list",
  "read",
  "create",
  "update",
  "delete",
] as const;
export type CollectionOperation = (typeof operationNames)[number];
const safeKey = z
  .string()
  .regex(/^[a-zA-Z_][a-zA-Z0-9_.-]{0,150}$/)
  .refine(
    (s) =>
      !s
        .split(".")
        .some((k) => ["__proto__", "prototype", "constructor"].includes(k)),
  );
export const endpointSchema = z
  .object({
    operationId: z.string().max(200).optional(),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    path: z
      .string()
      .max(500)
      .regex(/^\/?[a-zA-Z0-9_-]+(?:\/(?:[a-zA-Z0-9_-]+|\{id\}))*$/),
    format: z.enum(["jsonapi", "json", "domain"]).default("jsonapi"),
    requestFields: z.record(safeKey, safeKey).default({}),
    responseFields: z.record(safeKey, z.string().max(300)).default({}),
    dataPointer: z.string().max(300).default("/data"),
    idPointer: z.string().max(300).default("/id"),
    idBodyField: safeKey.refine((s) => !s.includes(".")).default("id"),
    totalPointer: z.string().max(300).optional(),
    pageParameter: z.string().max(80).default("page[number]"),
    sizeParameter: z.string().max(80).default("page[size]"),
    searchParameter: z.string().max(80).optional(),
  })
  .strict()
  .superRefine((v, c) => {
    for (const p of [
      v.dataPointer,
      v.idPointer,
      v.totalPointer,
      ...Object.values(v.responseFields),
    ])
      if (
        p !== undefined &&
        p !== "" &&
        (!p.startsWith("/") ||
          /~(?![01])/.test(p) ||
          p
            .split("/")
            .some((k) => ["__proto__", "prototype", "constructor"].includes(k)))
      )
        c.addIssue({ code: "custom", message: "Ruta JSON inválida." });
    if ((v.path.match(/\{id\}/g) ?? []).length > 1)
      c.addIssue({
        code: "custom",
        message: "Solo se admite un identificador en la ruta.",
      });
  });
export type OperationEndpoint = z.infer<typeof endpointSchema>;
export const operationMapSchema = z
  .object(
    Object.fromEntries(
      operationNames.map((k) => [k, endpointSchema.nullable()]),
    ) as Record<CollectionOperation, z.ZodNullable<typeof endpointSchema>>,
  )
  .strict();
export type OperationMap = Record<
  CollectionOperation,
  OperationEndpoint | null
>;
export function operationCapabilities(map: OperationMap) {
  return Object.fromEntries(
    operationNames.map((k) => [k, Boolean(map[k])]),
  ) as Record<CollectionOperation, boolean>;
}
export type EndpointCandidate = {
  endpoint: OperationEndpoint;
  action: CollectionOperation | null;
  summary: string;
};
export function inferOperationEndpoints(input: unknown): EndpointCandidate[] {
  const doc = readDocument(input),
    result: EndpointCandidate[] = [];
  for (const [path, raw] of Object.entries(doc.paths ?? {}) as [
    string,
    any,
  ][]) {
    const parameters = path.match(/\{[^}]+\}/g) ?? [];
    if (parameters.length > 1) continue;
    const normalized = path.replace(/\{[^}]+\}/g, "{id}");
    for (const method of ["get", "post", "put", "patch", "delete"]) {
      const op = raw[method];
      if (!op) continue;
      const hint = String(op.operationId ?? "") + " " + path;
      let action: CollectionOperation | null = null;
      if (method === "get") action = parameters.length ? "read" : "list";
      else if (method === "delete") action = "delete";
      else if (method === "put" || method === "patch") action = "update";
      else if (/(?:delete|remove|eliminar)/i.test(hint)) action = "delete";
      else if (/(?:update|edit|actualizar)/i.test(hint)) action = "update";
      else if (
        /(?:create|add|register|crear)/i.test(hint) ||
        !path.includes("/commands/")
      )
        action = "create";
      const media =
        op.requestBody?.content ??
        op.responses?.["200"]?.content ??
        op.responses?.["201"]?.content ??
        {};
      const format = media["application/vnd.api+json"] ? "jsonapi" : "json";
      const response = op.responses?.["200"] ?? op.responses?.["201"];
      let schema: any = {};
      try {
        schema = materializeSchema(
          doc,
          response?.content?.["application/json"]?.schema ?? {},
        );
      } catch {
        /* Mapping remains explicit for unresolved schemas. */
      }
      const parsed = endpointSchema.safeParse({
        method: method.toUpperCase(),
        path: normalized,
        operationId: op.operationId,
        format,
        dataPointer:
          schema.type === "array" ? "" : schema.properties?.data ? "/data" : "",
      });
      if (parsed.success)
        result.push({
          endpoint: parsed.data,
          action,
          summary:
            op.summary ?? op.operationId ?? `${method.toUpperCase()} ${path}`,
        });
    }
  }
  return result;
}
export function jsonPointer(value: any, path: string): any {
  if (path === "") return value;
  for (const part of path.slice(1).split("/")) {
    const key = part.replace(/~1/g, "/").replace(/~0/g, "~");
    value =
      value && typeof value === "object" && Object.hasOwn(value, key)
        ? value[key]
        : undefined;
  }
  return value;
}
export function mapRequest(
  data: Record<string, unknown>,
  mapping: Record<string, string>,
) {
  if (!Object.keys(mapping).length) return data;
  const result: Record<string, any> = {};
  for (const [field, path] of Object.entries(mapping)) {
    if (!Object.hasOwn(data, field)) continue;
    let target = result;
    const keys = path.split(".");
    for (const key of keys.slice(0, -1))
      target = target[key] ??= Object.create(null);
    target[keys.at(-1)!] = data[field];
  }
  return result;
}
