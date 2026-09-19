import {
  MongoClient,
  ObjectId,
  Decimal128,
  Long,
  type Document,
  type Filter,
} from "mongodb";
import {
  databaseFieldName,
  databaseReadSchema,
  databaseMutationSchema,
  type DatabaseConnection,
  type DatabaseField,
  type ResourceMetadata,
  type JsonValue,
} from "@savia/crm-shared/database-sources";
import type { DatabaseDriver } from "./driver";
import { ConnectionPools } from "./connection-pools";
import { DatabaseBridgeError, databaseError } from "./database-errors";
import { serializeDatabaseValue, validateFieldValue } from "./database-values";
export function decodeMongoId(id: string, type: "string" | "objectId") {
  if (type === "string") return id;
  if (!/^[0-9a-fA-F]{24}$/.test(id))
    throw new DatabaseBridgeError("DATABASE_ID", "Invalid ObjectId.", 422);
  return new ObjectId(id);
}
function valueType(v: unknown): DatabaseField["valueType"] {
  if (v instanceof Date) return "date";
  if (v instanceof Decimal128) return "decimal";
  if (v instanceof Long) return "bigint";
  if (v instanceof ObjectId || typeof v === "string") return "string";
  if (typeof v === "boolean") return "boolean";
  if (typeof v === "number") return "number";
  return "json";
}
export function encodeMongoValue(field: DatabaseField, value: JsonValue): any {
  validateFieldValue(field, value);
  if (value === null) return null;
  if (field.nativeType === "objectId")
    return decodeMongoId(String(value), "objectId");
  if (field.valueType === "date") return new Date(String(value));
  if (field.valueType === "decimal")
    return Decimal128.fromString(String(value));
  if (field.valueType === "bigint") {
    const integer = BigInt(String(value));
    if (integer < -(1n << 63n) || integer > (1n << 63n) - 1n)
      throw new DatabaseBridgeError(
        "DATABASE_VALUE",
        `Integer out of range for field ${field.name}.`,
        422,
      );
    return Long.fromString(String(value));
  }
  return value;
}
export function inferMongoMetadata(
  resource: string,
  docs: Document[],
): ResourceMetadata {
  const names = [...new Set(docs.flatMap((d) => Object.keys(d)))].filter(
    (name) => databaseFieldName.safeParse(name).success,
  );
  const idTypes = new Set(
    docs.map((d) =>
      d._id instanceof ObjectId
        ? "objectId"
        : typeof d._id === "string"
          ? "string"
          : "unsupported",
    ),
  );
  const idType =
    idTypes.size === 1 && !idTypes.has("unsupported")
      ? ([...idTypes][0] as "string" | "objectId")
      : undefined;
  return {
    resource,
    kind: "collection",
    primaryKey: ["_id"],
    uniqueKeys: [],
    sampled: true,
    ...(idType ? { idType } : {}),
    fields: names.map((name) => {
      const values = docs.map((d) => d[name]);
      const types = new Set(values.filter((v) => v != null).map(valueType));
      const hasObjectIds = values.some((v) => v instanceof ObjectId);
      const mixedObjectIds =
        hasObjectIds &&
        values.some((v) => v != null && !(v instanceof ObjectId));
      const type = types.size === 1 ? [...types][0]! : "json";
      return {
        name,
        nativeType:
          name === "_id"
            ? (idType ?? "mixed")
            : values
                  .filter((v) => v != null)
                  .every((v) => v instanceof ObjectId) &&
                values.some((v) => v != null)
              ? "objectId"
              : type,
        valueType: type,
        nullable: values.some((v) => v == null),
        generated: name === "_id" && idType === "objectId",
        writable: !mixedObjectIds && (name !== "_id" || idType === "string"),
        hasDefault: name === "_id" && idType === "objectId",
      };
    }),
  };
}
export function createMongoDriver(): DatabaseDriver {
  const pools = new ConnectionPools(
    async (key) => {
      const c = JSON.parse(key);
      const client = new MongoClient(`mongodb://${c.host}:${c.port}`, {
        auth: c.username
          ? { username: c.username, password: c.password ?? "" }
          : undefined,
        authSource: c.authSource,
        tls: c.ssl,
        directConnection: true,
        retryWrites: false,
        retryReads: false,
        maxPoolSize: 5,
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000,
        socketTimeoutMS: 12000,
        timeoutMS: 10000,
        promoteLongs: false,
      });
      await client.connect();
      return client;
    },
    async (c) => c.close(),
  );
  async function using<T>(
    c: DatabaseConnection,
    work: (client: MongoClient) => Promise<T>,
    write = false,
  ) {
    if (c.kind !== "mongodb")
      throw new DatabaseBridgeError("DATABASE_KIND", "Invalid driver.", 422);
    try {
      return await pools.use(JSON.stringify(c), work);
    } catch (e) {
      throw databaseError(e, write);
    }
  }
  async function inspect(
    client: MongoClient,
    c: DatabaseConnection,
    resource: string,
  ) {
    const db = client.db(c.database);
    const info = await db
      .listCollections({ name: resource }, { nameOnly: false })
      .next();
    if (!info)
      throw new DatabaseBridgeError(
        "DATABASE_NOT_FOUND",
        "Collection not found.",
        404,
      );
    const meta = inferMongoMetadata(
      resource,
      await db.collection(resource).find({}).limit(100).toArray(),
    );
    if (info.type === "view") meta.kind = "view";
    return meta;
  }
  const project = (row: Document, columns: string[]) =>
    Object.fromEntries(
      columns
        .filter((k) => Object.hasOwn(row, k))
        .map((k) => [k, serializeDatabaseValue(row[k])]),
    );
  return {
    testConnection: (c) =>
      using(c, async (client) => {
        await client.db(c.database).command({ ping: 1 });
      }),
    listResources: (c) =>
      using(c, async (client) =>
        (
          await client
            .db(c.database)
            .listCollections({}, { nameOnly: false })
            .toArray()
        )
          .filter((r) => !r.name.startsWith("system."))
          .slice(0, 500)
          .map((r) => ({
            resource: r.name,
            kind:
              r.type === "view" ? ("view" as const) : ("collection" as const),
          })),
      ),
    inspect: (c, r) => using(c, (client) => inspect(client, c, r)),
    read: (raw) => {
      const input = databaseReadSchema.parse(raw);
      return using(input.connection, async (client) => {
        const meta = await inspect(client, input.connection, input.resource);
        const collection = client
          .db(input.connection.database)
          .collection(input.resource);
        const idType = input.idType ?? meta.idType;
        if (
          input.operation === "read" &&
          (!idType || (meta.idType && meta.idType !== idType))
        )
          throw new DatabaseBridgeError(
            "DATABASE_ID",
            "Identifier metadata changed. Synchronize the collection.",
            409,
          );
        const conditions: Document[] = [];
        if (input.operation === "read")
          conditions.push({ _id: decodeMongoId(input.id!, idType!) });
        for (const filter of input.filters) {
          if (!input.columns.includes(filter.field))
            throw new DatabaseBridgeError(
              "DATABASE_FIELD",
              "Unknown filter field.",
              422,
            );
          const field = meta.fields.find((f) => f.name === filter.field);
          conditions.push({
            [filter.field]: {
              $eq: field ? encodeMongoValue(field, filter.value) : filter.value,
            },
          });
        }
        if (input.search) {
          const regex = input.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          if (
            !input.searchColumns.length ||
            input.searchColumns.some((k) => !input.columns.includes(k))
          )
            throw new DatabaseBridgeError(
              "DATABASE_SEARCH",
              "Invalid search fields.",
              422,
            );
          conditions.push({
            $or: input.searchColumns.map((k) => ({
              [k]: { $regex: regex, $options: "i" },
            })),
          });
        }
        const filter = conditions.length ? { $and: conditions } : {};
        const projection = Object.fromEntries(input.columns.map((k) => [k, 1]));
        if (!input.columns.includes("_id")) projection._id = 0;
        if (input.operation === "read") {
          const row = await collection.findOne(filter, { projection });
          if (!row)
            throw new DatabaseBridgeError(
              "DATABASE_NOT_FOUND",
              "Record not found.",
              404,
            );
          return { data: project(row, input.columns) };
        }
        const sort = input.sort ?? "_id";
        if (sort !== "_id" && !input.columns.includes(sort))
          throw new DatabaseBridgeError(
            "DATABASE_FIELD",
            "Invalid sort field.",
            422,
          );
        const direction = input.order === "ASC" ? 1 : -1;
        const rows = await collection
          .find(filter, { projection })
          .sort({
            [sort]: direction,
            ...(sort !== "_id" ? { _id: direction } : {}),
          })
          .skip((input.page - 1) * input.perPage)
          .limit(input.perPage + 1)
          .toArray();
        return {
          data: rows
            .slice(0, input.perPage)
            .map((r) => project(r, input.columns)),
          page: input.page,
          perPage: input.perPage,
          hasNext: rows.length > input.perPage,
        };
      });
    },
    mutate: (raw) => {
      const input = databaseMutationSchema.parse(raw);
      return using(
        input.connection,
        async (client) => {
          const meta = await inspect(client, input.connection, input.resource);
          const idType = meta.idType ?? input.idType;
          if (
            meta.kind === "view" ||
            input.idColumn !== "_id" ||
            !idType ||
            (meta.idType && input.idType && meta.idType !== input.idType)
          )
            throw new DatabaseBridgeError(
              "DATABASE_READ_ONLY",
              "Collection has no writable identifier. Synchronize metadata.",
              405,
            );
          if (meta.fields.length && !meta.idType)
            throw new DatabaseBridgeError(
              "DATABASE_ID",
              "Collection has mixed identifier types.",
              405,
            );
          const collection = client
            .db(input.connection.database)
            .collection<Document>(input.resource);
          const projection = Object.fromEntries(
            input.columns.map((k) => [k, 1]),
          );
          if (!input.columns.includes("_id")) projection._id = 0;
          const values: Document = {};
          if (input.operation !== "delete")
            for (const [key, v] of Object.entries(input.values)) {
              if (
                !input.columns.includes(key) ||
                (key === "_id" && input.operation === "update")
              )
                throw new DatabaseBridgeError(
                  "DATABASE_FIELD",
                  `Field ${key} is not writable.`,
                  422,
                );
              const field = meta.fields.find((f) => f.name === key);
              if (field) {
                if (field.generated || !field.writable)
                  throw new DatabaseBridgeError(
                    "DATABASE_FIELD",
                    `Field ${key} is generated.`,
                    422,
                  );
                validateFieldValue(field, v);
              }
              values[key] = field ? encodeMongoValue(field, v) : v;
            }
          if (input.operation === "create") {
            if (idType === "string" && typeof values._id !== "string")
              throw new DatabaseBridgeError(
                "DATABASE_REQUIRED",
                "A string _id is required.",
                422,
              );
            if (idType === "objectId") values._id = new ObjectId();
            await collection.insertOne(values);
            return { data: project(values, input.columns) };
          }
          const filter = {
            _id: decodeMongoId(input.id, idType),
          } as Filter<Document>;
          const row =
            input.operation === "update"
              ? await collection.findOneAndUpdate(
                  filter,
                  { $set: values },
                  {
                    returnDocument: "after",
                    includeResultMetadata: false,
                    projection,
                  },
                )
              : await collection.findOneAndDelete(filter, {
                  includeResultMetadata: false,
                  projection: { _id: 1 },
                });
          if (!row)
            throw new DatabaseBridgeError(
              "DATABASE_NOT_FOUND",
              "Record not found.",
              404,
            );
          return {
            data:
              input.operation === "delete"
                ? { id: input.id, deleted: true }
                : project(row, input.columns),
          };
        },
        true,
      );
    },
    close: () => pools.close(),
  };
}
