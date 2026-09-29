/**
 * Returns a quoted FTS5 trigram phrase when it can safely narrow a substring
 * search. The LIKE predicate remains authoritative; this only supplies a
 * candidate superset. Short strings and embedded NULs use the old scan path.
 */
export function recordSearchCandidate(query: string): string | undefined {
  if (query.includes("\0") || hasUnpairedSurrogate(query)) return undefined;
  if (Array.from(query).length < 3) return undefined;
  return `"${query.replaceAll('"', '""')}"`;
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index++;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
}
