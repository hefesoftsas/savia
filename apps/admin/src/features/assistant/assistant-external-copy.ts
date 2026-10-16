import type { PluginAssistantResponse } from "@savia/studio-shared/plugin-assistant";

type ExternalAssistantMessage = PluginAssistantResponse["messages"][number];
type ExternalAssistantCopyLabels = {
  sources: string;
  insufficientEvidence: string;
  stale: string;
};

function citationText(
  citations: ExternalAssistantMessage["citations"],
  sourcesLabel: string,
): string {
  if (!citations?.length) return "";
  const items = citations.map((citation) => {
    // Keep short, human-readable references while excluding opaque provider hashes.
    const reference = /^[A-Za-z]{1,6}[-_]?[0-9]{1,6}$/.test(citation.id)
      ? ` [${citation.id}]`
      : "";
    const excerpt = citation.excerpt
      .split("\n")
      .map((line) => `  > ${line}`)
      .join("\n");
    return `- ${citation.label}${reference}\n${excerpt}`;
  });
  return `${sourcesLabel}:\n${items.join("\n")}`;
}

export function formatExternalAssistantAnswer(
  message: ExternalAssistantMessage,
  labels: ExternalAssistantCopyLabels,
): string {
  const qualifications = [
    message.insufficientEvidence ? labels.insufficientEvidence : "",
    message.stale ? labels.stale : "",
  ];
  return [
    message.text,
    ...qualifications,
    citationText(message.citations, labels.sources),
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function formatExternalAssistantConversation(
  title: string,
  messages: PluginAssistantResponse["messages"],
  labels: ExternalAssistantCopyLabels & { user: string; assistant: string },
): string {
  const entries = messages.map((message) => {
    const role = message.role === "user" ? labels.user : labels.assistant;
    return `## ${role}\n\n${formatExternalAssistantAnswer(message, labels)}`;
  });
  return [`# ${title}`, ...entries].join("\n\n");
}
