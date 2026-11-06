/** Select complete transcript segments within the provider context budget. */
export type SessionEvidenceSegment = {
  source: string;
  sequence: number;
  startSeconds: number;
  durationSeconds: number;
  text: string;
};
const words = (text: string) =>
  text
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .match(/[\p{L}\p{N}]{3,}/gu) ?? [];
const stopWords = new Set(
  "que qué los las una unos unas del para por con sobre como cuál cuales quien the and what which who how about was were did does this that de uma com qual quais quem como".split(
    " ",
  ),
);
export function selectSessionEvidence(
  segments: readonly SessionEvidenceSegment[],
  question: string,
  maxCharacters = 50000,
) {
  const terms = new Set(words(question).filter((word) => !stopWords.has(word)));
  const ranked = segments
    .map((segment, index) => {
      const content = new Set(words(segment.text));
      const score = [...terms].filter((term) => content.has(term)).length;
      return { segment, index, score };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const chosen: typeof ranked = [];
  let size = 0;
  for (const candidate of ranked) {
    const block = `[${candidate.segment.source} #${candidate.segment.sequence} ${candidate.segment.startSeconds.toFixed(2)}s]\n${candidate.segment.text}\n`;
    if (block.length + size > maxCharacters) continue;
    size += block.length;
    chosen.push(candidate);
  }
  chosen.sort(
    (a, b) =>
      a.segment.startSeconds - b.segment.startSeconds || a.index - b.index,
  );
  return {
    text: chosen
      .map(
        ({ segment }) =>
          `[${segment.source} #${segment.sequence} ${segment.startSeconds.toFixed(2)}s]\n${segment.text}\n`,
      )
      .join(""),
    partial: chosen.length !== segments.length,
    evidence: chosen.map(({ segment }) => ({
      source: segment.source,
      sequence: segment.sequence,
      startSeconds: segment.startSeconds,
      durationSeconds: segment.durationSeconds,
    })),
  };
}
