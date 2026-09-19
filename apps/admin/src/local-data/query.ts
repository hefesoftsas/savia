import {
  getPipeline,
  type CrmObject,
  type CrmRecord,
} from "@savia/crm-shared/metadata";
import type { Table } from "dexie";
import { queryCache } from "./query-cache";
import {
  conditionIds,
  searchIds,
  intersect,
  union,
  eachFieldValue,
} from "./query-index";
import { z } from "zod";

type Row = { collection: string; id: string; document: CrmRecord };
type Database = {
  records: Table<Row, [string, string]>;
  syncState?: Table<
    { collection: string; dataRevision?: string; cursor?: string },
    string
  >;
  outbox?: Table<{ collection: string; mutationId: string }, string>;
};
export type RecordSortKey = [string, string, number, string | number, string];
const scalar = (value: unknown): string | number | null =>
  value == null
    ? null
    : typeof value === "boolean"
      ? Number(value)
      : typeof value === "object"
        ? JSON.stringify(value)
        : (value as string | number);
const forwardText = (value: string) =>
  Array.from(value)
    .map((char) => char.codePointAt(0)!.toString(16).padStart(6, "0"))
    .join("");
const reverseText = (value: string) =>
  Array.from(value)
    .map((char) =>
      (0x10ffff - char.codePointAt(0)!).toString(16).padStart(6, "0"),
    )
    .join("") + "z";
/** Fixed multiEntry index: arbitrary collection fields need no IndexedDB schema upgrades. */
export function createRecordSortKeys(
  collection: string,
  record: CrmRecord,
  fields: string[] = [],
): RecordSortKey[] {
  return [
    ...new Set([
      ...Object.keys(record),
      ...fields,
      "id",
      "created_at",
      "updated_at",
    ]),
  ].flatMap((field) => {
    const value = scalar(record[field]);
    const rank = value === null ? 0 : typeof value === "number" ? 1 : 2;
    return [
      [
        collection,
        field + ":ASC:" + (record.deleted_at == null ? "active" : "trash"),
        rank,
        typeof value === "string" ? forwardText(value) : (value ?? ""),
        record.id,
      ],
      [
        collection,
        field + ":DESC:" + (record.deleted_at == null ? "active" : "trash"),
        -rank,
        value === null
          ? ""
          : typeof value === "number"
            ? -value
            : reverseText(value),
        record.id,
      ],
    ] as RecordSortKey[];
  });
}
const schema = z.object({
  logic: z.enum(["and", "or"]).default("and"),
  conditions: z
    .array(
      z.object({
        field: z.string(),
        op: z.enum([
          "eq",
          "ne",
          "gt",
          "gte",
          "lt",
          "lte",
          "contains",
          "startsWith",
          "endsWith",
          "empty",
          "in",
        ]),
        value: z.unknown().optional(),
      }),
    )
    .max(20),
});
const supported = new Set([
  "page",
  "perPage",
  "sort",
  "order",
  "q",
  "searchField",
  "searchFields",
  "stage",
  "emptyStage",
  "filters",
  "trash",
  "group",
  "amountField",
]);
const fold = (value: string) => value.replace(/[A-Z]/g, (c) => c.toLowerCase());
function compare(a: ReturnType<typeof scalar>, b: ReturnType<typeof scalar>) {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  if (typeof a !== typeof b) return typeof a === "number" ? -1 : 1;
  if (typeof a === "string" && typeof b === "string")
    return forwardText(a) < forwardText(b) ? -1 : 1;
  return a < b ? -1 : 1;
}
function predicate(object: CrmObject, params: URLSearchParams) {
  for (const key of params.keys())
    if (!supported.has(key))
      throw new Error(`Unsupported local query parameter: ${key}`);
  const filters = params.has("filters")
    ? schema.parse(JSON.parse(params.get("filters")!))
    : undefined;
  for (const c of filters?.conditions ?? []) {
    if (!object.config.fields[c.field]) throw new Error("Unknown filter field");
    if (c.op === "empty") continue;
    if (c.op === "in") {
      if (
        !Array.isArray(c.value) ||
        !c.value.length ||
        c.value.length > 100 ||
        c.value.some((v) => !["string", "number", "boolean"].includes(typeof v))
      )
        throw new Error("Invalid list filter");
    } else if (
      c.value !== null &&
      !["string", "number", "boolean"].includes(typeof c.value)
    )
      throw new Error("Invalid filter value");
  }
  const fields =
    params
      .get("searchFields")
      ?.split(",")
      .map((v) => v.trim())
      .filter((v) => object.config.fields[v])
      .slice(0, 20) ??
    (object.config.fields[params.get("searchField") ?? ""]
      ? [params.get("searchField")!]
      : []);
  const pipeline = object.config.studio?.pipeline?.field ?? "stage";
  return (record: CrmRecord) => {
    if ((record.deleted_at != null) !== (params.get("trash") === "true"))
      return false;
    const q = params.get("q");
    if (q) {
      const values = fields.length
        ? fields.map((field) => record[field])
        : Object.entries(record)
            .filter(
              ([key]) =>
                ![
                  "id",
                  "created_at",
                  "updated_at",
                  "deleted_at",
                  "_version",
                ].includes(key),
            )
            .map(([, value]) => value);
      if (
        !values.some(
          (v) =>
            v != null &&
            fold(String(scalar(v))).includes(fold(q.slice(0, 200))),
        )
      )
        return false;
    }
    if (object.config.fields[pipeline]) {
      if (
        params.get("stage") &&
        scalar(record[pipeline]) !== params.get("stage")
      )
        return false;
      if (
        params.get("emptyStage") === "true" &&
        record[pipeline] != null &&
        record[pipeline] !== ""
      )
        return false;
    }
    const matches = (c: z.infer<typeof schema>["conditions"][number]) => {
      const actual = scalar(record[c.field]);
      const expected = scalar(c.value);
      switch (c.op) {
        case "empty":
          return actual === null || actual === "" || actual === "[]";
        case "in":
          return (c.value as unknown[]).some(
            (v) => actual !== null && actual === scalar(v),
          );
        case "eq":
          return actual === expected;
        case "ne":
          return actual !== expected;
        case "contains":
          return (
            actual !== null &&
            fold(String(actual)).includes(fold(String(expected ?? "")))
          );
        case "startsWith":
          return (
            actual !== null &&
            fold(String(actual)).startsWith(fold(String(expected ?? "")))
          );
        case "endsWith":
          return (
            actual !== null &&
            fold(String(actual)).endsWith(fold(String(expected ?? "")))
          );
        default:
          if (actual === null || expected === null) return false;
          const n = compare(actual, expected);
          return c.op === "gt"
            ? n > 0
            : c.op === "gte"
              ? n >= 0
              : c.op === "lt"
                ? n < 0
                : n <= 0;
      }
    };
    return (
      !filters?.conditions.length ||
      (filters.logic === "or"
        ? filters.conditions.some(matches)
        : filters.conditions.every(matches))
    );
  };
}
async function filteredIds(
  db: Database,
  collection: string,
  object: CrmObject,
  params: URLSearchParams,
) {
  const parsed = params.has("filters")
    ? schema.parse(JSON.parse(params.get("filters")!))
    : undefined;
  const trash = params.get("trash") === "true";
  const resolve = (
    condition: NonNullable<typeof parsed>["conditions"][number],
  ) => {
    const conditionParams = new URLSearchParams({
      trash: String(trash),
      filters: JSON.stringify({ conditions: [condition] }),
    });
    const matches = predicate(object, conditionParams);
    return conditionIds(db.records, collection, trash, condition, (value) =>
      matches({
        id: "",
        created_at: "",
        updated_at: "",
        [condition.field]: value,
        deleted_at: trash ? "deleted" : null,
      } as CrmRecord),
    );
  };
  let candidates: Set<string> | undefined;
  if (parsed?.conditions.length) {
    const sets = await Promise.all(parsed.conditions.map(resolve));
    candidates = parsed.logic === "or" ? union(sets) : sets.reduce(intersect);
  }
  const constrain = (set: Set<string>) => {
    candidates = candidates ? intersect(candidates, set) : set;
  };
  const pipeline = object.config.studio?.pipeline?.field ?? "stage";
  if (object.config.fields[pipeline]) {
    if (params.get("stage"))
      constrain(
        await resolve({
          field: pipeline,
          op: "eq",
          value: params.get("stage"),
        }),
      );
    if (params.get("emptyStage") === "true")
      constrain(
        union(
          await Promise.all(
            [null, ""].map((value) =>
              resolve({ field: pipeline, op: "eq", value }),
            ),
          ),
        ),
      );
  }
  if (params.get("q") && candidates?.size !== 0) {
    const fields =
      params
        .get("searchFields")
        ?.split(",")
        .map((v) => v.trim())
        .filter((v) => object.config.fields[v])
        .slice(0, 20) ??
      (object.config.fields[params.get("searchField") ?? ""]
        ? [params.get("searchField")!]
        : []);
    constrain(
      await searchIds(
        db.records,
        collection,
        trash,
        fields.length ? fields : undefined,
        params.get("q")!,
      ),
    );
  }
  return candidates;
}
export async function queryRecords(
  db: Database,
  collection: string,
  object: CrmObject,
  params: URLSearchParams,
) {
  predicate(object, params); // Validate before any cache lookup.
  const page = Math.max(1, Math.floor(Number(params.get("page")) || 1));
  const perPage = Math.min(
    200,
    Math.max(1, Math.floor(Number(params.get("perPage")) || 25)),
  );
  if (!Number.isFinite(page)) throw new Error("Invalid page");
  const sort = params.get("sort") ?? "updated_at";
  const order = params.get("order") === "ASC" ? "ASC" : "DESC";
  if (
    !["created_at", "updated_at", "id"].includes(sort) &&
    !object.config.fields[sort]
  )
    throw new Error("Invalid sort field");
  const prefix = [
    collection,
    sort +
      ":" +
      order +
      ":" +
      (params.get("trash") === "true" ? "trash" : "active"),
  ];
  let rows = db.records.where("sortKeys").between(prefix, [...prefix, []]);
  const parsed = params.has("filters")
    ? schema.parse(JSON.parse(params.get("filters")!))
    : undefined;
  const equality =
    parsed?.conditions.length === 1 &&
    parsed.conditions[0].op === "eq" &&
    parsed.conditions[0].field === sort
      ? parsed.conditions[0]
      : undefined;
  if (equality) {
    const indexed = createRecordSortKeys(collection, {
      id: "",
      created_at: "",
      updated_at: "",
      [sort]: equality.value,
      deleted_at: params.get("trash") === "true" ? "deleted" : null,
    } as CrmRecord).find((key) => key[1] === prefix[1])!;
    const exact = indexed.slice(0, 4);
    rows = db.records.where("sortKeys").between(exact, [...exact, []]);
  }
  const offset = (page - 1) * perPage;
  // Counts and page reads share one readonly snapshot, including concurrent replication.
  return db.records.db.transaction(
    "r",
    [
      db.records,
      ...(db.syncState ? [db.syncState] : []),
      ...(db.outbox ? [db.outbox] : []),
    ],
    async () => {
      if (
        !params.get("q") &&
        !params.get("stage") &&
        params.get("emptyStage") !== "true" &&
        (!parsed?.conditions.length || equality)
      ) {
        const total = await rows.clone().count();
        const selected = await rows
          .clone()
          .offset(offset)
          .limit(perPage)
          .toArray();
        return {
          data: selected.map((row) => row.document),
          total,
          page,
          perPage,
        };
      }
      const cache = queryCache(db.records.db);
      const constraints = new URLSearchParams(params);
      constraints.delete("page");
      constraints.delete("perPage");
      constraints.sort();
      const revision = await db.syncState?.get(collection);
      const pendingIds = await db.outbox
        ?.where("collection")
        .equals(collection)
        .primaryKeys();
      const key = JSON.stringify([
        collection,
        object.config,
        constraints.toString(),
        revision?.dataRevision,
        revision?.cursor,
        pendingIds?.sort(),
      ]);
      // The persisted revision and page share one snapshot. Broadcast delivery is
      // only an eviction hint; correctness never depends on another tab notifying us.
      let ids = revision?.dataRevision ? cache.get(key) : undefined;
      if (!ids) {
        const candidates = await filteredIds(db, collection, object, params);
        ids = [];
        // Only keys are traversed to preserve the requested sort and stable ID ties.
        if (candidates?.size !== 0)
          ids = (await rows.primaryKeys()).flatMap((key) =>
            !candidates || candidates.has(key[1]) ? [key[1]] : [],
          );
        if (revision?.dataRevision) cache.put(key, collection, ids);
      }
      const selected = await db.records.bulkGet(
        ids.slice(offset, offset + perPage).map((id) => [collection, id]),
      );
      return {
        data: selected.flatMap((row) => (row ? [row.document] : [])),
        total: ids.length,
        page,
        perPage,
      };
    },
  );
}
export async function querySummary(
  db: Database,
  collection: string,
  object: CrmObject,
  params: URLSearchParams,
) {
  predicate(object, params);
  const pipeline = getPipeline(object);
  const group = params.get("group") ?? pipeline?.field;
  if (!group || !object.config.fields[group])
    throw new Error("Invalid group field");
  const numeric = (field: string | undefined | null) =>
    !!field &&
    ["Number", "Currency"].includes(object.config.fields[field]?.type);
  const requested = params.get("amountField");
  const amount = numeric(requested) ? requested : pipeline?.amountField;
  const groups = new Map<
    string,
    { value: string | number | null; count: number; amount: number }
  >();
  await db.records.db.transaction("r", db.records, async () => {
    const ids = await filteredIds(db, collection, object, params);
    const trash = params.get("trash") === "true";
    const amounts = new Map<string, number>();
    if (amount && numeric(amount))
      await eachFieldValue(
        db.records,
        collection,
        trash,
        amount,
        (id, value) => {
          if (ids && !ids.has(id)) return;
          const parsed = parseFloat(String(value ?? ""));
          amounts.set(id, Number.isFinite(parsed) ? parsed : 0);
        },
      );
    await eachFieldValue(db.records, collection, trash, group, (id, value) => {
      if (ids && !ids.has(id)) return;
      const key = JSON.stringify(value);
      const bucket = groups.get(key) ?? { value, count: 0, amount: 0 };
      bucket.count++;
      bucket.amount += amounts.get(id) ?? 0;
      groups.set(key, bucket);
    });
  });
  return {
    data: [...groups.values()].sort(
      (a, b) => b.count - a.count || compare(a.value, b.value),
    ),
  };
}

type Relation = {
  object: string;
  label: string;
  field: string;
  fieldLabel: string;
  direction: "incoming" | "outgoing";
  total: number;
  records: CrmRecord[];
};
/** Detail relations only claim completeness for fully replicated collections. */
export async function queryRecordDetail(
  db: Database,
  collection: string,
  id: string,
  params: URLSearchParams,
  definitions: import("./contracts").CollectionManifest[],
  hydratedCollections: ReadonlySet<string>,
) {
  for (const key of params.keys())
    if (key !== "page")
      throw new Error(`Unsupported local detail parameter: ${key}`);
  const record = (await db.records.get([collection, id]))?.document;
  if (!record || record.deleted_at != null) throw new Error("Record not found");
  const page = Math.max(1, Math.floor(Number(params.get("page")) || 1));
  if (!Number.isFinite(page)) throw new Error("Invalid page");
  const perPage = 20,
    offset = (page - 1) * perPage;
  const relations: Relation[] = [];
  let relationsComplete = true;
  const available = (name: string) =>
    definitions.some(
      (definition) =>
        definition.name === name && definition.capability !== "remote",
    ) && hydratedCollections.has(name);
  for (const definition of [...definitions].sort((a, b) =>
    compare(a.name, b.name),
  )) {
    const object = definition.object;
    for (const [fieldName, field] of Object.entries(object.config.fields)) {
      if (field.config?.relation === collection) {
        if (!available(object.name)) {
          relationsComplete = false;
        } else {
          const records: CrmRecord[] = [];
          let total = 0;
          const prefix = [object.name, "updated_at:DESC:active"];
          await db.records
            .where("sortKeys")
            .between(prefix, [...prefix, []])
            .each(({ document }) => {
              const value = document[fieldName];
              if (value !== id && !(Array.isArray(value) && value.includes(id)))
                return;
              if (total >= offset && records.length < perPage)
                records.push(document);
              total++;
            });
          relations.push({
            object: object.name,
            label: object.label,
            field: fieldName,
            fieldLabel: field.label,
            direction: "incoming",
            total,
            records,
          });
        }
      }
      if (
        object.name === collection &&
        typeof field.config?.relation === "string"
      ) {
        const target = field.config.relation;
        if (!available(target)) {
          relationsComplete = false;
          continue;
        }
        const value = record[fieldName];
        const ids = (
          Array.isArray(value) ? value : value ? [value] : []
        ).filter((value): value is string => typeof value === "string");
        const records: CrmRecord[] = [];
        let matched = 0;
        // Foreign keys are bounded by the field's maximum of 500; fetch by primary key,
        // preserving server semantics that total counts IDs even when a target is gone.
        for (const targetId of [...new Set(ids)].sort((a, b) =>
          compare(a, b),
        )) {
          const document = (await db.records.get([target, targetId]))?.document;
          if (!document || document.deleted_at != null) continue;
          if (matched++ >= offset && records.length < perPage)
            records.push(document);
        }
        relations.push({
          object: target,
          label:
            definitions.find((d) => d.name === target)?.object.label ?? target,
          field: fieldName,
          fieldLabel: field.label,
          direction: "outgoing",
          total: ids.length,
          records,
        });
      }
    }
  }
  return { data: { record, relations, page, perPage }, relationsComplete };
}
