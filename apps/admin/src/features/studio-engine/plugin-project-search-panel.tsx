import { useMemo, type Ref } from "react";
import {
  searchPluginProjectFiles,
  type PluginProjectSearchMatch,
} from "./plugin-project-search";

export type PluginProjectSearchPanelLabels = {
  search: string;
  placeholder: string;
  noResults: string;
  resultCount: (count: number) => string;
  truncated: string;
};

const MAX_SNIPPET_LENGTH = 160;

function getSnippet(match: PluginProjectSearchMatch) {
  const start = Math.max(
    0,
    Math.min(match.column - 1 - 40, match.lineText.length - MAX_SNIPPET_LENGTH),
  );
  const end = Math.min(match.lineText.length, start + MAX_SNIPPET_LENGTH);
  return {
    text: match.lineText.slice(start, end),
    start,
    hasPrefix: start > 0,
    hasSuffix: end < match.lineText.length,
  };
}

export function PluginProjectSearchPanel({
  files,
  query,
  onQueryChange,
  onSelect,
  labels,
  inputRef,
}: {
  files: Record<string, string>;
  query: string;
  onQueryChange: (query: string) => void;
  onSelect: (match: PluginProjectSearchMatch) => void;
  labels: PluginProjectSearchPanelLabels;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const { results, truncated } = useMemo(
    () => searchPluginProjectFiles(files, query),
    [files, query],
  );
  const resultsByPath = new Map<string, typeof results>();
  for (const result of results) {
    const pathResults = resultsByPath.get(result.path) ?? [];
    pathResults.push(result);
    resultsByPath.set(result.path, pathResults);
  }

  return (
    <section className="plugin-project-search-panel">
      <h2>{labels.search}</h2>
      <input
        ref={inputRef}
        type="search"
        role="searchbox"
        aria-label={labels.search}
        placeholder={labels.placeholder}
        value={query}
        autoFocus
        onChange={(event) => onQueryChange(event.currentTarget.value)}
      />
      {results.length === 0 ? (
        <p>{labels.noResults}</p>
      ) : (
        <>
          <p aria-live="polite">{labels.resultCount(results.length)}</p>
          {truncated && <p role="status">{labels.truncated}</p>}
          <div className="plugin-project-search-results">
            {[...resultsByPath.entries()].map(([path, pathResults]) => {
              const basename = path.split("/").at(-1) || path;
              const directory = path.slice(
                0,
                Math.max(0, path.length - basename.length - 1),
              );
              return (
                <section
                  key={path}
                  role="group"
                  aria-label={path}
                  className="plugin-project-search-file"
                >
                  <h3 title={path} aria-label={path}>
                    {basename}
                    {directory && <small>{directory}</small>}
                  </h3>
                  <ul>
                    {pathResults.map((match) => (
                      <li
                        key={`${match.lineNumber}:${match.column}:${match.endColumn}`}
                      >
                        <button
                          type="button"
                          aria-label={`${match.path}:${match.lineNumber}:${match.column}`}
                          onClick={() => onSelect(match)}
                        >
                          <span>
                            {match.lineNumber}:{match.column}
                          </span>
                          {(() => {
                            const snippet = getSnippet(match);
                            const matchStart = match.column - 1 - snippet.start;
                            const matchEnd = Math.min(
                              snippet.text.length,
                              matchStart + match.endColumn - match.column,
                            );
                            const visibleMatchStart = Math.max(0, matchStart);
                            return (
                              <code>
                                {snippet.hasPrefix ? "…" : ""}
                                {snippet.text.slice(0, visibleMatchStart)}
                                {matchEnd > visibleMatchStart ? (
                                  <mark>
                                    {snippet.text.slice(
                                      visibleMatchStart,
                                      matchEnd,
                                    )}
                                  </mark>
                                ) : null}
                                {snippet.text.slice(
                                  Math.max(visibleMatchStart, matchEnd),
                                )}
                                {snippet.hasSuffix ? "…" : ""}
                              </code>
                            );
                          })()}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
