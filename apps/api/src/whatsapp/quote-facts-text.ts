import { publicQuoteFactSchema } from "@savia/studio-shared/public-quote";

/** Render only published evidence, keeping complete facts within the channel budget. */
export function quoteFactsText(
  value: unknown,
  maxFacts: number,
  maxCharacters: number,
): string {
  if (!Array.isArray(value)) return "";
  const lines: string[] = [];
  for (const item of value.slice(0, 40)) {
    const parsed = publicQuoteFactSchema.safeParse(item);
    if (!parsed.success) continue;
    const { label, value: detail } = parsed.data;
    if (
      /https?:\/\/|[^\s@]+@[^\s@]+\.[^\s@]+|[<>\x00-\x1f]/i.test(
        `${label} ${detail}`,
      )
    )
      continue;
    const line = `• ${label}: ${detail}`;
    if (!lines.includes(line)) lines.push(line);
  }
  const selected: string[] = [];
  for (const line of lines) {
    if (selected.length >= maxFacts) break;
    if ([...selected, line].join("\n").length > maxCharacters) continue;
    selected.push(line);
  }
  return selected.join("\n");
}
