export const MAX_PAGE_EXCERPT_LENGTH = 360;

const normalizeWhitespace = (value: string) =>
  value.replace(/\s+/g, " ").trim();

/** Build a plain-text excerpt, centered on a literal query match when present. */
export function makePageExcerpt(
  source: string,
  query: string,
  options: { requireMatch?: boolean } = {},
): string | undefined {
  const text = normalizeWhitespace(source);
  if (!text) return undefined;

  const needle = normalizeWhitespace(query).toLowerCase();
  const match = needle ? text.toLowerCase().indexOf(needle) : -1;
  if (options.requireMatch !== false && match < 0) return undefined;

  const start = match < 0 ? 0 : Math.max(0, match - 60);
  const end = Math.min(text.length, start + MAX_PAGE_EXCERPT_LENGTH - 2);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}
