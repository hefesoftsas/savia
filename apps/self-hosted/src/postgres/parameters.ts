/** Convert D1 positional placeholders only. SQL operators using ? must use named
 * PostgreSQL functions instead. Native $n and numbered ?n parameters are rejected. */
export function postgresParameters(sql: string): {
  text: string;
  parameterCount: number;
} {
  let text = "";
  let parameterCount = 0;
  let i = 0;
  while (i < sql.length) {
    const start = i;
    const c = sql[i];
    if (c === "'" || c === '"') {
      const escaped =
        c === "'" &&
        i > 0 &&
        /[eE]/.test(sql[i - 1]) &&
        (i < 2 || !/[\w$]/.test(sql[i - 2]));
      i++;
      let closed = false;
      while (i < sql.length) {
        if (escaped && sql[i] === "\\") {
          i += 2;
          continue;
        }
        if (sql[i++] === c) {
          if (sql[i] === c) {
            i++;
            continue;
          }
          closed = true;
          break;
        }
      }
      if (!closed) throw new Error("Unterminated SQL quote.");
    } else if (sql.startsWith("--", i)) {
      i = sql.indexOf("\n", i);
      if (i < 0) i = sql.length;
    } else if (sql.startsWith("/*", i)) {
      let depth = 1;
      i += 2;
      while (i < sql.length && depth) {
        if (sql.startsWith("/*", i)) {
          depth++;
          i += 2;
        } else if (sql.startsWith("*/", i)) {
          depth--;
          i += 2;
        } else i++;
      }
      if (depth) throw new Error("Unterminated SQL comment.");
    } else if (c === "$" && (i === 0 || !/[\w$]/.test(sql[i - 1]))) {
      if (/^\$\d/.test(sql.slice(i)))
        throw new Error(
          "Native PostgreSQL parameters are not supported; use ? bindings.",
        );
      const delimiter = sql
        .slice(i)
        .match(/^\$(?:[a-zA-Z_][a-zA-Z_0-9]*)?\$/)?.[0];
      if (delimiter) {
        const end = sql.indexOf(delimiter, i + delimiter.length);
        if (end < 0) throw new Error("Unterminated SQL dollar quote.");
        i = end + delimiter.length;
      } else i++;
    } else if (c === "?") {
      if (/\d/.test(sql[i + 1] ?? ""))
        throw new Error("Numbered SQL parameters are not supported.");
      text += `$${++parameterCount}`;
      i++;
      continue;
    } else i++;
    text += sql.slice(start, i);
  }
  return { text, parameterCount };
}
