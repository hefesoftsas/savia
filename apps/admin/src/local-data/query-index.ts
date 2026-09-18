import type { Table } from "dexie";
import type { CrmRecord } from "@savia/crm-shared/metadata";

type Row = { collection: string; id: string; document: CrmRecord };
type Records = Table<Row, [string, string]>;
export type Condition = { field: string; op: string; value?: unknown };
const scalar = (value: unknown): string | number | null =>
  value == null
    ? null
    : typeof value === "boolean"
      ? Number(value)
      : typeof value === "object"
        ? JSON.stringify(value)
        : (value as string | number);
const encode = (value: string) =>
  Array.from(value)
    .map((c) => c.codePointAt(0)!.toString(16).padStart(6, "0"))
    .join("");
const decode = (value: string) =>
  value.replace(/.{6}/g, (code) => String.fromCodePoint(parseInt(code, 16)));
const valueKey = (value: unknown) => {
  const v = scalar(value);
  return [
    v === null ? 0 : typeof v === "number" ? 1 : 2,
    typeof v === "string" ? encode(v) : (v ?? ""),
  ];
};
export const intersect = (left: Set<string>, right: Set<string>) =>
  new Set([...left].filter((id) => right.has(id)));
export const union = (sets: Set<string>[]) =>
  new Set(sets.flatMap((set) => [...set]));
/** Resolve exact scalar predicates from existing compound index ranges, without loading documents. */
export async function conditionIds(
  records: Records,
  collection: string,
  trash: boolean,
  condition: Condition,
  test: (value: unknown) => boolean,
): Promise<Set<string>> {
  const prefix = [
    collection,
    `${condition.field}:ASC:${trash ? "trash" : "active"}`,
  ];
  const exact = [...prefix, ...valueKey(condition.value)];
  const range = async (lower: unknown[], upper: unknown[]) =>
    new Set(
      (await records.where("sortKeys").between(lower, upper).primaryKeys()).map(
        (key) => key[1],
      ),
    );
  const equal = (value: unknown) => {
    const key = [...prefix, ...valueKey(value)];
    return range(key, [...key, []]);
  };
  switch (condition.op) {
    case "eq":
      return equal(condition.value);
    case "in":
      return union(
        await Promise.all((condition.value as unknown[]).map(equal)),
      );
    case "empty":
      return union(await Promise.all([null, "", "[]"].map(equal)));
    case "ne":
      return union(
        await Promise.all([
          range(prefix, exact),
          range([...exact, []], [...prefix, []]),
        ]),
      );
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      if (condition.value == null) return new Set();
      return condition.op === "gt" || condition.op === "gte"
        ? range(condition.op === "gt" ? [...exact, []] : exact, [...prefix, []])
        : range(
            [...prefix, 1],
            condition.op === "lte" ? [...exact, []] : exact,
          );
    }
    default: {
      const ids = new Set<string>();
      await records
        .where("sortKeys")
        .between(prefix, [...prefix, []])
        .eachKey((key, cursor) => {
          const [, , rank, value] = key as [
            string,
            string,
            number,
            string | number,
            string,
          ];
          const actual =
            rank === 0 ? null : rank === 2 ? decode(String(value)) : value;
          if (test(actual)) ids.add((cursor.primaryKey as [string, string])[1]);
        });
      return ids;
    }
  }
}

/** Field search uses scalar keys. Unrestricted substring search uses bounded batches once. */
export async function searchIds(
  records: Records,
  collection: string,
  trash: boolean,
  fields: string[] | undefined,
  query: string,
) {
  const ids = new Set<string>();
  const suffix = `:ASC:${trash ? "trash" : "active"}`;
  const fold = (v: string) => v.replace(/[A-Z]/g, (c) => c.toLowerCase());
  const needle = fold(query.slice(0, 200));
  const excluded = new Set([
    "id",
    "created_at",
    "updated_at",
    "deleted_at",
    "_version",
  ]);
  const inspect = async (prefix: string[]) => {
    await records
      .where("sortKeys")
      .between(prefix, [...prefix, []])
      .eachKey((key, cursor) => {
        const [, name, rank, value] = key as [
          string,
          string,
          number,
          string | number,
          string,
        ];
        const field = name.slice(0, -suffix.length);
        if (!name.endsWith(suffix) || (!fields && excluded.has(field))) return;
        if (
          rank !== 0 &&
          fold(rank === 2 ? decode(String(value)) : String(value)).includes(
            needle,
          )
        )
          ids.add((cursor.primaryKey as [string, string])[1]);
      });
  };
  if (fields?.length)
    await Promise.all(
      fields.map((field) => inspect([collection, field + suffix])),
    );
  else {
    // A cursor over every field's ASC/DESC sort key is slower than a single
    // document pass. Read bounded primary-key batches for unrestricted text.
    let lower: unknown[] = [collection];
    while (true) {
      const batch = await records
        .where("[collection+id]")
        .between(lower, [collection, []], false, false)
        .limit(256)
        .toArray();
      for (const row of batch) {
        if ((row.document.deleted_at != null) !== trash) continue;
        if (
          Object.entries(row.document).some(
            ([field, value]) =>
              !excluded.has(field) &&
              value != null &&
              fold(String(scalar(value))).includes(needle),
          )
        )
          ids.add(row.id);
      }
      if (batch.length < 256) break;
      lower = [collection, batch[batch.length - 1].id];
    }
  }
  return ids;
}

/** Visit the scalar projection already stored in the index; no record values are read. */
export async function eachFieldValue(
  records: Records,
  collection: string,
  trash: boolean,
  field: string,
  visit: (id: string, value: string | number | null) => void,
) {
  const prefix = [collection, `${field}:ASC:${trash ? "trash" : "active"}`];
  await records
    .where("sortKeys")
    .between(prefix, [...prefix, []])
    .eachKey((key, cursor) => {
      const [, , rank, value] = key as [
        string,
        string,
        number,
        string | number,
        string,
      ];
      visit(
        (cursor.primaryKey as [string, string])[1],
        rank === 0 ? null : rank === 2 ? decode(String(value)) : value,
      );
    });
}
