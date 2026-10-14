const SNIPPET_MAX = 200;

export function buildSnippet(text: string | undefined): string {
  if (!text) return "";
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > SNIPPET_MAX
    ? collapsed.slice(0, SNIPPET_MAX - 1) + "…"
    : collapsed;
}

export function stripHtml(html: string | undefined): string | undefined {
  if (!html) return undefined;
  return html.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/gi, " ");
}

// Subject prefixes added by mail clients on reply/forward. Stripped before
// using subject as a thread-matching fallback so "Re: hello" matches "hello".
function subjectPrefixLength(subject: string, start: number): number {
  const prefix = ["fwd", "re", "fw", "aw", "sv", "tr"].find(
    (candidate) =>
      subject.slice(start, start + candidate.length).toLowerCase() ===
      candidate,
  );
  if (!prefix) return 0;

  let index = start + prefix.length;
  while (index < subject.length && /\s/.test(subject[index])) index += 1;

  if (subject[index] === "[") {
    let digitEnd = index + 1;
    while (digitEnd < subject.length && /[0-9]/.test(subject[digitEnd])) {
      digitEnd += 1;
    }
    if (digitEnd === index + 1 || subject[digitEnd] !== "]") return 0;
    index = digitEnd + 1;
  }

  while (index < subject.length && /\s/.test(subject[index])) index += 1;
  if (subject[index] !== ":") return 0;
  index += 1;
  while (index < subject.length && /\s/.test(subject[index])) index += 1;
  return index - start;
}

function collapseWhitespace(value: string): string {
  const result: string[] = [];
  let pendingSpace = false;
  for (const character of value) {
    if (/\s/.test(character)) {
      pendingSpace = result.length > 0;
    } else {
      if (pendingSpace) result.push(" ");
      result.push(character);
      pendingSpace = false;
    }
  }
  return result.join("");
}

/** Strip leading Re:/Fwd: prefixes (recursively) and collapse whitespace. */
export function normalizeSubject(subject: string): string {
  let s = subject.trim();
  let offset = 0;
  let prefixLength = subjectPrefixLength(s, offset);
  while (prefixLength > 0) {
    offset += prefixLength;
    prefixLength = subjectPrefixLength(s, offset);
  }
  return collapseWhitespace(s.slice(offset)).trim();
}
