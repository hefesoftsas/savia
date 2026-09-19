import { it, expect } from "vitest";
import { mysqlUniqueKeys } from "../src/mysql-driver";
it("never reduces composite prefix indexes into single-column keys", () => {
  const keys = mysqlUniqueKeys([
    { INDEX_NAME: "prefix", COLUMN_NAME: "a", SUB_PART: null },
    { INDEX_NAME: "prefix", COLUMN_NAME: "b", SUB_PART: 10 },
    { INDEX_NAME: "expression", COLUMN_NAME: "a", SUB_PART: null },
    { INDEX_NAME: "expression", COLUMN_NAME: null, SUB_PART: null },
    { INDEX_NAME: "valid", COLUMN_NAME: "id", SUB_PART: null },
  ]);
  expect([...keys]).toEqual([["valid", ["id"]]]);
});
