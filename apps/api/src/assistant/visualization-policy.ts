function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function latestUserText(messages: unknown[]): string {
  for (const message of [...messages].reverse()) {
    const record = recordValue(message);
    if (record?.role !== "user" || !Array.isArray(record.parts)) continue;

    return record.parts
      .flatMap((part) => {
        const value = recordValue(part);
        return value?.type === "text" && typeof value.text === "string"
          ? [value.text]
          : [];
      })
      .join(" ");
  }
  return "";
}

const explicitVisualizationPattern =
  /\b(?:gr[aá]fic(?:a|as|o|os|ar)?|chart(?:s)?|plot(?:s)?|visuali[sz](?:aci[oó]n|ar))\b/i;

export function visualizationRequested(messages: unknown[]): boolean {
  return explicitVisualizationPattern.test(latestUserText(messages));
}
