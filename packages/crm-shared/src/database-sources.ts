import { z } from "zod";
import type { CollectionCapabilities } from "./metadata";

export const databaseKinds = {
  postgres: { label: "PostgreSQL", port: 5432, schema: "public" },
  mysql: { label: "MySQL", port: 3306, schema: "" },
  mssql: { label: "SQL Server", port: 1433, schema: "dbo" },
  mongodb: { label: "MongoDB", port: 27017, schema: "" },
} as const;
export type DatabaseKind = keyof typeof databaseKinds;
export const isDatabaseKind = (kind: unknown): kind is DatabaseKind =>
  typeof kind === "string" && Object.hasOwn(databaseKinds, kind);
export const databaseFieldName = z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]{0,127}$/)
  .refine((key) => !["__proto__", "prototype", "constructor"].includes(key));
export const databaseResourceName = z.string().min(1).max(128)
  .regex(/^[a-zA-Z_][a-zA-Z0-9_.-]*$/)
  .refine((key) => !key.startsWith("system.") && !key.includes(".."));
const host = z.string().trim().min(1).max(253).regex(/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/);
const port = z.coerce.number().int().min(1).max(65535);
const text = z.string().trim().min(1).max(128);
const credentials = { username: text, password: z.string().max(10000).default("") };
const common = { host, database: text };
export const databaseConnectionSchemas = {
  postgres: z.object({kind:z.literal("postgres"),...common,...credentials,port:port.default(5432),schema:databaseFieldName.default("public"),ssl:z.boolean().default(true)}).strict(),
  mysql: z.object({kind:z.literal("mysql"),...common,...credentials,port:port.default(3306),ssl:z.boolean().default(true)}).strict(),
  mssql: z.object({kind:z.literal("mssql"),...common,...credentials,port:port.default(1433),schema:databaseFieldName.default("dbo"),encrypt:z.boolean().default(true),trustServerCertificate:z.boolean().default(false)}).strict(),
  mongodb: z.object({kind:z.literal("mongodb"),...common,username:text.optional(),password:z.string().max(10000).optional(),port:port.default(27017),authSource:text.default("admin"),ssl:z.boolean().default(true)}).strict(),
};
export const databaseConnectionSchema = z.discriminatedUnion("kind", [databaseConnectionSchemas.postgres, databaseConnectionSchemas.mysql, databaseConnectionSchemas.mssql, databaseConnectionSchemas.mongodb]);
export type DatabaseConnection = z.infer<typeof databaseConnectionSchema>;
const source = {id:z.string().regex(/^[a-z][a-z0-9_]{0,47}$/),label:z.string().trim().min(1).max(100),writeEnabled:z.boolean().default(false)};
export const databaseSourceInputSchema = z.discriminatedUnion("kind", [
  databaseConnectionSchemas.postgres.extend(source),databaseConnectionSchemas.mysql.extend(source),
  databaseConnectionSchemas.mssql.extend(source),databaseConnectionSchemas.mongodb.extend(source),
]);
export type DatabaseSourceInput = z.infer<typeof databaseSourceInputSchema>;
export function databaseSourceConfigFromInput(value: unknown) {
  const {id: _id,label: _label,password: _password,kind: _kind,...config} = databaseSourceInputSchema.parse(value);
  return config;
}
export const databaseSourceConfigSchema = z.unknown().transform((value,ctx) => {
  const parsed = databaseSourceInputSchema.safeParse({...value as object,id:"source",label:"Source"});
  if (!parsed.success) { ctx.addIssue({code:"custom",message:"Invalid database source configuration"}); return z.NEVER; }
  return databaseSourceConfigFromInput(parsed.data);
});
export type JsonValue = null | boolean | number | string | JsonValue[] | {[key:string]:JsonValue};
function safeJson(value: unknown, depth = 0): value is JsonValue {
  if (depth > 12) return false;
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value));
  if (typeof value === "string") return value.length <= 100_000;
  if (Array.isArray(value)) return value.length <= 1000 && value.every((v) => safeJson(v,depth+1));
  if (value && typeof value === "object") return Object.entries(value).length <= 500 && Object.entries(value).every(([key,v]) => !key.startsWith("$") && !key.includes(".") && !["__proto__","constructor","prototype"].includes(key) && safeJson(v,depth+1));
  return false;
}
const jsonValueSchema = z.custom<JsonValue>((value) => safeJson(value), "Invalid or unsafe JSON value");
export const databaseFieldSchema = z.object({
  name:databaseFieldName,nativeType:z.string().max(128),valueType:z.enum(["string","boolean","number","decimal","bigint","date","json","binary","unsupported"]),
  nullable:z.boolean(),generated:z.boolean(),writable:z.boolean(),hasDefault:z.boolean(),defaultValue:z.string().nullable().optional(),
}).strict();
export type DatabaseField = z.infer<typeof databaseFieldSchema>;
export const resourceMetadataSchema = z.object({
  resource:databaseResourceName,kind:z.enum(["table","view","collection"]),fields:z.array(databaseFieldSchema).max(500),
  primaryKey:z.array(databaseFieldName).max(16),uniqueKeys:z.array(z.array(databaseFieldName).max(16)).max(100),
  idType:z.enum(["string","objectId"]).optional(),sampled:z.boolean(),
}).strict();
export type ResourceMetadata = z.infer<typeof resourceMetadataSchema>;
const envelope = {connection:databaseConnectionSchema,resource:databaseResourceName,columns:z.array(databaseFieldName).min(1).max(100),idColumn:databaseFieldName.optional(),idType:z.enum(["string","objectId"]).optional()};
export const databaseReadSchema = z.object({...envelope,
  operation:z.enum(["list","read"]),id:z.string().min(1).max(300).optional(),
  page:z.number().int().min(1).max(100000).default(1),perPage:z.number().int().min(1).max(100).default(25),
  sort:databaseFieldName.optional(),order:z.enum(["ASC","DESC"]).default("DESC"),
  filters:z.array(z.object({field:databaseFieldName,op:z.literal("eq"),value:z.union([z.string().max(2000),z.number().finite(),z.boolean(),z.null()])}).strict()).max(20).default([]),
  search:z.string().max(200).optional(),searchColumns:z.array(databaseFieldName).max(20).default([]),
}).strict().refine((v) => v.operation !== "read" || Boolean(v.id && v.idColumn),"Reading requires an identifier");
export type DatabaseRead = z.infer<typeof databaseReadSchema>;
const values = z.record(databaseFieldName,jsonValueSchema).refine((v) => Object.keys(v).length <= 100);
const mutationEnvelope = {...envelope,idColumn:databaseFieldName};
export const databaseMutationSchema = z.discriminatedUnion("operation",[
  z.object({...mutationEnvelope,operation:z.literal("create"),values}).strict(),
  z.object({...mutationEnvelope,operation:z.literal("update"),id:z.string().min(1).max(300),values:values.refine(v => Object.keys(v).length>0)}).strict(),
  z.object({...mutationEnvelope,operation:z.literal("delete"),id:z.string().min(1).max(300)}).strict(),
]);
export type DatabaseMutation = z.infer<typeof databaseMutationSchema>;
// Results are bounded JSON; arbitrary field values must not be interpreted as query operators.
const resultRow = z.record(z.string(),z.json());
export const databaseResultSchema = z.object({data:z.union([resultRow,z.array(resultRow),z.null()]),page:z.number().int().optional(),perPage:z.number().int().optional(),total:z.number().int().optional(),hasNext:z.boolean().optional()}).strict();
export type DatabaseResult = z.infer<typeof databaseResultSchema>;
export const databaseResourcesSchema = z.array(z.object({resource:databaseResourceName,kind:z.enum(["table","view","collection"])}).strict()).max(500);
export function resolveRecordKey(meta: ResourceMetadata, selected?: string): string | undefined {
  if (meta.kind === "collection") return meta.idType && (!selected || selected==="_id") ? "_id" : undefined;
  const keys = [meta.primaryKey,...meta.uniqueKeys].filter(k => k.length===1 && meta.fields.some(f => f.name===k[0] && !f.nullable)).map(k=>k[0]!);
  return selected ? keys.find(k=>k===selected) : keys[0];
}
export function deriveDatabaseCapabilities(meta: ResourceMetadata, writeEnabled: boolean, idColumn?: string): CollectionCapabilities {
  const key=resolveRecordKey(meta,idColumn); const write=writeEnabled && Boolean(key) && meta.kind!=="view";
  return {list:true,read:Boolean(key),create:write,update:write,delete:write,schema:false,customFields:false,search:true,filter:true,sort:true};
}
export function databaseFieldInterface(field: DatabaseField) {
  const type = ({string:"Textbox",boolean:"Toggle",number:"Number",decimal:"Textbox",bigint:"Textbox",date:"DateControl",json:"Textarea",binary:"Textarea",unsupported:"Textarea"} as const)[field.valueType];
  return {type,label:field.name.replaceAll("_"," "),readOnly:field.generated || !field.writable,required:!field.nullable && !field.hasDefault && !field.generated};
}

export class DatabaseBridgeError extends Error {
  constructor(public readonly code: string, message: string,
    public readonly status: 400|403|404|405|409|422|502|503|504 = 502,
    public readonly outcome?: "unknown" | "committed") {
    super(message); this.name="DatabaseBridgeError";
  }
}
