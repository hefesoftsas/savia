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
}: BuildRecordPageSelectionOptions): { sql: string; bindings: unknown[] } {
  const limit = perPage + 1;
  if (!cursor) {
    return {
      sql: `SELECT id FROM ${source} WHERE ${where} ORDER BY ${sortSql} ${order},id ASC LIMIT ? OFFSET ?`,
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

  const selectBranch = (condition: string, branchOrder: string) =>
    `SELECT id,${sortSql} AS cursor_sort FROM ${source} WHERE ${where} AND ${condition} ORDER BY ${branchOrder} LIMIT ?`;
  const tiedOrder = "id ASC";
  const pageOrder = `${sortSql} ${order},id ASC`;
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
