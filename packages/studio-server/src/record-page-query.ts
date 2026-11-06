import type { RecordCursor } from "./record-pagination";

type BuildRecordPageSelectionOptions = {
  source: string;
  where: string;
  args: unknown[];
  sortSql: string;
  sortName: string;
  order: "ASC" | "DESC";
  perPage: number;
  offset: number;
  cursor?: RecordCursor;
  nullSafeEqual?: string;
  sortParts?: readonly string[];
};

/** Build the bounded ID selection used before loading record JSON. */
export function buildRecordPageSelection({
  source,
  where,
  args,
  sortSql,
  sortName,
  order,
  perPage,
  offset,
  cursor,
  nullSafeEqual = "IS",
  sortParts,
}: BuildRecordPageSelectionOptions): { sql: string; bindings: unknown[] } {
  const limit = perPage + 1;
  const orderSql = sortParts?.length
    ? sortParts.map((part) => `${part} ${order}`).join(",")
    : `${sortSql} ${order}`;
  if (!cursor) {
    return {
      sql: `SELECT id FROM ${source} WHERE ${where} ORDER BY ${orderSql},id ASC LIMIT ? OFFSET ?`,
      bindings: [...args, limit, offset],
    };
  }

  if (sortName === "id") {
    const comparison = order === "ASC" ? ">" : "<";
    return {
      sql: `SELECT id FROM ${source} WHERE ${where} AND id${comparison}? ORDER BY id ${order} LIMIT ?`,
      bindings: [...args, cursor.id, limit],
    };
  }

  if (
    sortParts?.length &&
    cursor.value !== null &&
    typeof cursor.value === "object"
  ) {
    const row = `(${sortParts.join(",")})`;
    const value = cursor.value;
    const key = [value.rank, value.number, value.text];
    const placeholders = key.map(() => "?").join(",");
    const comparison = order === "ASC" ? ">" : "<";
    const projectedParts = sortParts
      .map((part, index) => `${part} AS cursor_part_${index}`)
      .join(",");
    const tied = `SELECT id,${projectedParts} FROM ${source} WHERE ${where} AND ${row}=(${placeholders}) AND id>? ORDER BY id ASC LIMIT ?`;
    const laterOrder = sortParts.map((part) => `${part} ${order}`).join(",");
    const later = `SELECT id,${projectedParts} FROM ${source} WHERE ${where} AND ${row}${comparison}(${placeholders}) ORDER BY ${laterOrder},id ASC LIMIT ?`;
    const finalOrder = sortParts
      .map((_, index) => `cursor_part_${index} ${order}`)
      .join(",");
    return {
      sql: `SELECT id FROM ((${tied}) UNION ALL (${later})) positions ORDER BY ${finalOrder},id ASC LIMIT ?`,
      bindings: [
        ...args,
        ...key,
        cursor.id,
        limit,
        ...args,
        ...key,
        limit,
        limit,
      ],
    };
  }

  const selectBranch = (condition: string, branchOrder: string) =>
    `SELECT id,${sortSql} AS cursor_sort FROM ${source} WHERE ${where} AND ${condition} ORDER BY ${branchOrder} LIMIT ?`;
  const tiedOrder = "id ASC";
  const pageOrder = `${orderSql},id ASC`;
  const merge = (branches: string[]) =>
    `SELECT id FROM (${branches
      .map((branch, index) => `SELECT * FROM (${branch}) page_${index}`)
      .join(
        " UNION ALL ",
      )}) positions ORDER BY cursor_sort ${order},id ASC LIMIT ?`;

  if (cursor.value === null) {
    const tied = selectBranch(`${sortSql} IS NULL AND id>?`, tiedOrder);
    if (order === "DESC") {
      return {
        sql: merge([tied]),
        bindings: [...args, cursor.id, limit, limit],
      };
    }
    const later = selectBranch(`${sortSql} IS NOT NULL`, pageOrder);
    return {
      sql: merge([tied, later]),
      bindings: [...args, cursor.id, limit, ...args, limit, limit],
    };
  }

  const tied = selectBranch(
    `${sortSql} ${nullSafeEqual} ? AND id>?`,
    tiedOrder,
  );
  const comparison = order === "ASC" ? ">" : "<";
  const later = selectBranch(`${sortSql}${comparison}?`, pageOrder);
  if (order === "ASC") {
    return {
      sql: merge([tied, later]),
      bindings: [
        ...args,
        cursor.value,
        cursor.id,
        limit,
        ...args,
        cursor.value,
        limit,
        limit,
      ],
    };
  }

  const nullsLast = selectBranch(`${sortSql} IS NULL`, tiedOrder);
  return {
    sql: merge([tied, later, nullsLast]),
    bindings: [
      ...args,
      cursor.value,
      cursor.id,
      limit,
      ...args,
      cursor.value,
      limit,
      ...args,
      limit,
      limit,
    ],
  };
}
