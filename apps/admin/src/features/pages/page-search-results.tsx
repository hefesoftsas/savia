import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, FileText, Folder } from "lucide-react";
import { useAppLocale, useMessages, intlLocale } from "@/i18n/core";
import type { PageSummary } from "./client";
import { pagesMessages } from "./messages";

export type PageSearchResult = PageSummary & { excerpt?: string };

export function highlightPageSearchText(value: string, query: string) {
  const literal = query.trim();
  if (!literal) return value;
  const escaped = literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = value.matchAll(new RegExp(escaped, "giu"));
  const output: ReactNode[] = [];
  let cursor = 0;
  let index = 0;
  for (const match of matches) {
    const start = match.index ?? cursor;
    if (start > cursor) output.push(value.slice(cursor, start));
    output.push(<mark key={`match-${index++}`}>{match[0]}</mark>);
    cursor = start + match[0].length;
  }
  if (cursor < value.length) output.push(value.slice(cursor));
  return output.length ? output : value;
}

function formattedUpdatedDate(value: string, locale: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
    timestamp,
  );
}

export function PageSearchResultContent({
  page,
  query,
}: {
  page: PageSearchResult;
  query: string;
}) {
  const t = useMessages(pagesMessages);
  const locale = intlLocale(useAppLocale());
  const excerpt = page.excerpt?.trim();
  const updated = formattedUpdatedDate(page.updatedAt, locale);
  return (
    <span className="pages-search-result-copy">
      <span className="pages-list-title">
        {highlightPageSearchText(page.title, query)}
      </span>
      {excerpt ? (
        <span className="pages-search-result-excerpt">
          {highlightPageSearchText(excerpt, query)}
        </span>
      ) : null}
      {updated ? (
        <span className="pages-search-result-updated">
          {t("Page updated date", { date: updated })}
        </span>
      ) : null}
    </span>
  );
}

export function PageSearchResults({
  pages,
  query,
  empty,
  sortByTitle = false,
}: {
  pages: PageSearchResult[];
  query: string;
  empty: string;
  sortByTitle?: boolean;
}) {
  const t = useMessages(pagesMessages);
  const locale = intlLocale(useAppLocale());
  const sorted = sortByTitle
    ? [...pages].sort(
        (a, b) =>
          Number(b.kind === "folder") - Number(a.kind === "folder") ||
          a.title.localeCompare(b.title, locale),
      )
    : pages;

  return (
    <>
      <p className="pages-search-result-count" role="status" aria-live="polite">
        {sorted.length === 1
          ? t("One page search result")
          : t("Multiple page search results", { count: sorted.length })}
      </p>
      {sorted.length === 0 ? (
        <div className="pages-empty">
          <Folder size={28} strokeWidth={1.4} aria-hidden />
          <p>{empty}</p>
        </div>
      ) : (
        <ul className="pages-list pages-search-results">
          {sorted.map((page) => {
            return (
              <li key={page.id}>
                <Link to={`/pages/${encodeURIComponent(page.id)}`}>
                  {page.kind === "folder" ? (
                    <Folder size={20} strokeWidth={1.5} aria-hidden />
                  ) : (
                    <FileText size={20} strokeWidth={1.5} aria-hidden />
                  )}
                  <PageSearchResultContent page={page} query={query} />
                  <span className="pages-list-access">
                    {t(page.isShared ? "Team shared" : "Team private")}
                  </span>
                  <ChevronRight size={14} aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
