export const translationLabels = [
  "Regular translation",
  "Professional but friendly translation",
  "Concise professional but friendly translation",
] as const;

export function translationVariants(response: string): string[] | null {
  const headings =
    /^[ \t]*(?:#{1,6}[ \t]*)?(?:\*\*)?([123])\.[ \t]*(?:\*\*)?(Regular translation|Professional but friendly translation|Concise professional but friendly translation)(?:\*\*)?[ \t]*:?(?:\*\*)?[ \t]*(.*)$/gm;
  const matches = [...response.matchAll(headings)];
  if (matches.length !== 3 || response.slice(0, matches[0].index).trim())
    return null;
  if (
    matches.some(
      (match, index) =>
        match[1] !== String(index + 1) || match[2] !== translationLabels[index],
    )
  )
    return null;
  const variants = matches.map((match, index) => {
    const end = matches[index + 1]?.index ?? response.length;
    return (
      match[3] + response.slice(match.index! + match[0].length, end)
    ).trim();
  });
  return variants.every(Boolean) ? variants : null;
}
