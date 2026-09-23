import { DatabaseBridgeError } from "@savia/studio-shared/database-sources";
export { DatabaseBridgeError };
export function databaseError(
  error: unknown,
  mutation = false,
): DatabaseBridgeError {
  if (error instanceof DatabaseBridgeError) return error;
  const e = error as { code?: string | number; number?: number; name?: string };
  const code = String(
    e?.code === "EREQUEST" ? e?.number : (e?.code ?? e?.number ?? ""),
  );
  if (
    [
      "23505",
      "23503",
      "23514",
      "ER_DUP_ENTRY",
      "ER_ROW_IS_REFERENCED_2",
      "ER_NO_REFERENCED_ROW_2",
      "2601",
      "2627",
      "547",
      "11000",
    ].includes(code)
  )
    return new DatabaseBridgeError(
      "DATABASE_CONFLICT",
      "The database rejected a conflicting value.",
      409,
    );
  if (
    [
      "42501",
      "ER_TABLEACCESS_DENIED_ERROR",
      "ER_ACCESS_DENIED_ERROR",
      "229",
      "13",
    ].includes(code)
  )
    return new DatabaseBridgeError(
      "DATABASE_PERMISSION",
      "The database account does not permit this operation.",
      403,
    );
  if (
    code.startsWith("22") ||
    [
      "ER_BAD_NULL_ERROR",
      "ER_TRUNCATED_WRONG_VALUE",
      "ER_DATA_TOO_LONG",
      "515",
      "245",
      "241",
      "121",
    ].includes(code)
  )
    return new DatabaseBridgeError(
      "DATABASE_VALUE",
      "The database rejected a field value.",
      422,
    );
  if (
    ["57014", "ETIMEOUT", "ETIMEDOUT", "50"].includes(code) ||
    e?.name?.includes("Timeout")
  )
    return new DatabaseBridgeError(
      "DATABASE_TIMEOUT",
      "Database timed out. Refresh before repeating a write.",
      504,
      mutation ? "unknown" : undefined,
    );
  return new DatabaseBridgeError(
    "DATABASE_UNAVAILABLE",
    "The database operation could not be completed.",
    502,
    mutation ? "unknown" : undefined,
  );
}
