export type PluginProjectSearchMatch = {
  path: string;
  lineNumber: number;
  column: number;
  /** One-based exclusive end column, matching Monaco's range convention. */
  endColumn: number;
  lineText: string;
};

export type PluginProjectSearchResult = {
  results: PluginProjectSearchMatch[];
  truncated: boolean;
};

export const PLUGIN_PROJECT_SEARCH_LIMIT = 500;

const BINARY_ASSET_EXTENSIONS = new Set([
  ".png",
  ".webp",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".bmp",
  ".avif",
  ".b64",
  ".base64",
]);

function isBinaryAssetPath(path: string) {
  const lowerPath = path.toLowerCase();
  return [...BINARY_ASSET_EXTENSIONS].some((extension) =>
    lowerPath.endsWith(extension),
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Search literal text files in stable path/line/column order. */
export function searchPluginProjectFiles(
  files: Record<string, string>,
  query: string,
): PluginProjectSearchResult {
  if (!query) return { results: [], truncated: false };

  const matcher = new RegExp(escapeRegExp(query), "giu");
  const paths = Object.keys(files)
    .filter((path) => !isBinaryAssetPath(path))
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  const results: PluginProjectSearchMatch[] = [];
  let truncated = false;

  for (const path of paths) {
    const lines = files[path].split(/\r\n|\n|\r/);
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const lineText = lines[lineIndex];
      matcher.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = matcher.exec(lineText)) !== null) {
        const index = match.index;
        if (results.length === PLUGIN_PROJECT_SEARCH_LIMIT) {
          truncated = true;
          return { results, truncated };
        }
        results.push({
          path,
          lineNumber: lineIndex + 1,
          column: index + 1,
          endColumn: index + query.length + 1,
          lineText,
        });
      }
    }
  }

  return { results, truncated };
}
