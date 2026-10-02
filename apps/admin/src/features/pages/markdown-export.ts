type Node = {
  type?: unknown;
  text?: unknown;
  children?: unknown;
  [key: string]: unknown;
};

const children = (node: Node): Node[] =>
  Array.isArray(node.children)
    ? node.children.filter(
        (child): child is Node =>
          !!child && typeof child === "object" && !Array.isArray(child),
      )
    : [];
const typeOf = (node: Node) => String(node.type ?? "p");
const safeUrl = (value: unknown) => {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    return ["https:", "http:", "mailto:"].includes(url.protocol) ? value : "";
  } catch {
    return "";
  }
};
const escapeDestination = (url: string) =>
  url.replace(/\\/g, "\\\\").replace(/\)/g, "\\)").replace(/\s/g, "%20");
const escapeMarkdown = (value: string) =>
  value.replace(/([\\`*_{}\[\]<>()#+\-.!|])/g, "\\$1");
const escapeTableCell = (value: string) =>
  value.replace(/(?<!\\)\|/g, "\\|").replace(/\r?\n/g, "<br>");
const wrapWith = (text: string, open: string, close: string) => {
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
  return match ? `${match[1]}${open}${match[2]}${close}${match[3]}` : text;
};

function inline(node: Node): string {
  if (typeof node.text === "string") {
    let text = node.text;
    if (node.code) {
      const ticks = Math.max(
        1,
        ...Array.from(text.matchAll(/`+/g), (m) => m[0].length + 1),
      );
      const fence = "`".repeat(ticks);
      text = `${fence}${text.includes("`") ? ` ${text} ` : text}${fence}`;
    } else {
      text = escapeMarkdown(text);
      if (node.bold) text = wrapWith(text, "**", "**");
      if (node.italic) text = wrapWith(text, "_", "_");
      if (node.strikethrough) text = wrapWith(text, "~~", "~~");
      if (node.underline) text = wrapWith(text, "<u>", "</u>");
    }
    return text;
  }
  const kind = typeOf(node);
  const content = children(node).map(inline).join("");
  if (kind === "a" || kind === "link") {
    const url = safeUrl(node.url ?? node.href);
    return url ? `[${content || url}](${escapeDestination(url)})` : content;
  }
  return content;
}

function blockText(node: Node): string {
  return children(node).map(inline).join("");
}

function table(node: Node): string {
  const rows = children(node).filter((row) => typeOf(row) === "table_row");
  if (!rows.length) return "";
  const matrix = rows.map((row) =>
    children(row)
      .filter((cell) => typeOf(cell) === "table_cell")
      .map((cell) =>
        escapeTableCell(
          children(cell).map(renderBlock).filter(Boolean).join("<br>"),
        ),
      ),
  );
  const width = Math.max(1, ...matrix.map((row) => row.length));
  const renderRow = (row: string[]) =>
    `| ${Array.from({ length: width }, (_, index) => row[index] ?? "").join(" | ")} |`;
  return [
    renderRow(matrix[0]),
    renderRow(Array(width).fill("---")),
    ...matrix.slice(1).map(renderRow),
  ].join("\n");
}

function renderBlock(node: Node): string {
  const kind = typeOf(node);
  const content = blockText(node);
  if (["p", "paragraph"].includes(kind)) return content;
  const heading = /^(h[1-6])$/.exec(kind);
  if (heading) return `${"#".repeat(Number(heading[1][1]))} ${content}`;
  const namedHeading: Record<string, number> = {
    "heading-one": 1,
    "heading-two": 2,
    "heading-three": 3,
  };
  if (namedHeading[kind]) return `${"#".repeat(namedHeading[kind])} ${content}`;
  if (["bullet", "bulleted-list", "bulletedList"].includes(kind))
    return `- ${content}`;
  if (["numbered", "numbered-list", "numberedList"].includes(kind))
    return `1. ${content}`;
  if (kind === "todo") return `- [${node.checked ? "x" : " "}] ${content}`;
  if (["blockquote", "quote"].includes(kind))
    return content
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
  if (kind === "callout")
    return content
      .split("\n")
      .map((line, index) => (index ? `> ${line}` : `> **Note:** ${line}`))
      .join("\n");
  if (kind === "code_block" || kind === "code") {
    const raw = children(node)
      .map((child) =>
        typeof child.text === "string" ? child.text : inline(child),
      )
      .join("");
    const longest = Math.max(
      0,
      ...Array.from(raw.matchAll(/`+/g), (m) => m[0].length),
    );
    const fence = "`".repeat(Math.max(3, longest + 1));
    const language =
      typeof node.language === "string" &&
      /^[\w+-]*$/.test(node.language) &&
      node.language !== "plain"
        ? node.language
        : "";
    return `${fence}${language}\n${raw}\n${fence}`;
  }
  if (kind === "divider") return "---";
  if (kind === "toggle") {
    const parts = children(node);
    const summary = parts[0] ? renderBlock(parts[0]) : "";
    const body = parts.slice(1).map(renderBlock).filter(Boolean).join("\n\n");
    return `<details>\n<summary>${summary}</summary>\n\n${body}\n</details>`;
  }
  if (kind === "table") return table(node);
  if (kind === "issue") {
    const url = safeUrl(node.url);
    return url
      ? `[Issue](${escapeDestination(url)})`
      : "Issue link unavailable";
  }
  if (kind === "collection") {
    const label = escapeMarkdown(
      typeof node.collection === "string" ? node.collection : "Collection",
    );
    const mode = node.mode === "pipeline" ? "board" : "table";
    return `> Collection view: **${label}** (${mode})`;
  }
  if (kind === "attachment") {
    const name = escapeMarkdown(
      typeof node.name === "string" ? node.name : "Attachment",
    );
    return `📎 ${name}`;
  }
  if (["table_row", "table_cell"].includes(kind))
    return children(node).map(renderBlock).join(" ");
  return children(node).map(renderBlock).filter(Boolean).join("\n\n");
}

/** Export the saved page title and Plate content as portable Markdown. */
export function exportPageMarkdown(title: string, content: unknown): string {
  const blocks = Array.isArray(content)
    ? content.filter(
        (node): node is Node =>
          !!node && typeof node === "object" && !Array.isArray(node),
      )
    : [];
  const body = blocks.map(renderBlock).filter(Boolean).join("\n\n");
  return `# ${escapeMarkdown(title.trim() || "Untitled")}${body ? `\n\n${body}` : ""}\n`;
}
