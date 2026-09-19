import type {
  DatabaseField,
  JsonValue,
} from "@savia/crm-shared/database-sources";
import { DatabaseBridgeError } from "./database-errors";
export function serializeDatabaseValue(value: unknown): JsonValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    if (Number.isInteger(value) && !Number.isSafeInteger(value))
      throw new DatabaseBridgeError(
        "DATABASE_PRECISION",
        "Database returned an unsafe numeric value.",
        422,
      );
    return value;
  }
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString("base64");
  if (Array.isArray(value)) return value.map(serializeDatabaseValue);
  if (typeof value === "object") {
    const bson = value as { _bsontype?: string; toString(): string };
    if (["ObjectId", "Decimal128", "Long"].includes(bson._bsontype ?? ""))
      return bson.toString();
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, serializeDatabaseValue(v)]),
    );
  }
  throw new DatabaseBridgeError(
    "DATABASE_VALUE",
    "Unsupported database value.",
    422,
  );
}
export function validateFieldValue(
  field: DatabaseField,
  value: JsonValue,
): unknown {
  const fail = () => {
    throw new DatabaseBridgeError(
      "DATABASE_VALUE",
      `Invalid value for field ${field.name}.`,
      422,
    );
  };
  if (value === null) {
    if (!field.nullable) fail();
    return null;
  }
  switch (field.valueType) {
    case "string":
      if (typeof value !== "string") fail();
      break;
    case "boolean":
      if (typeof value !== "boolean") fail();
      break;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) fail();
      break;
    case "decimal":
    case "bigint":
      if (
        typeof value !== "string" ||
        !(field.valueType === "bigint" ? /^-?\d+$/ : /^-?\d+(\.\d+)?$/).test(
          value,
        )
      )
        fail();
      break;
    case "date":
      if (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
        fail();
      break;
    case "binary":
    case "unsupported":
      fail();
      break;
  }
  return value;
}
export function fieldType(nativeType: string): DatabaseField["valueType"] {
  const t = nativeType.toLowerCase();
  if (["bool", "boolean", "bit"].includes(t)) return "boolean";
  if (["bigint", "int8", "bigserial"].includes(t)) return "bigint";
  if (["numeric", "decimal", "money", "smallmoney"].includes(t))
    return "decimal";
  if (
    [
      "int",
      "integer",
      "int4",
      "int2",
      "smallint",
      "tinyint",
      "mediumint",
      "serial",
      "float",
      "float4",
      "float8",
      "real",
      "double",
      "double precision",
    ].includes(t)
  )
    return "number";
  if (["json", "jsonb"].includes(t)) return "json";
  if (/date|timestamp/.test(t)) return "date";
  if (/char|text|uuid|uniqueidentifier|enum|name/.test(t)) return "string";
  if (/binary|blob|bytea|image/.test(t)) return "binary";
  return "unsupported";
}
