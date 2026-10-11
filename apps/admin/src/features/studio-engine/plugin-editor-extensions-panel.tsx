import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useMessages } from "@/i18n/core";
import { pluginEditorExtensionsMessages as messages } from "./plugin-editor-extensions-messages";

export type PluginEditorExtension = {
  id: string;
  name: string;
  publisher: string;
  descriptionMessage: "formatterDescription" | "reactSnippetsDescription";
  capabilities: string[];
};

/** Bundled extensions that have been verified to run in the browser workbench. */
export const pluginEditorExtensionsCatalog: PluginEditorExtension[] = [
  {
    id: "savia.formatter",
    name: "Prettier",
    publisher: "Savia",
    descriptionMessage: "formatterDescription",
    capabilities: ["TypeScript", "JavaScript", "JSON", "CSS", "HTML"],
  },
  {
    id: "savia.react-snippets",
    name: "React snippets",
    publisher: "Savia",
    descriptionMessage: "reactSnippetsDescription",
    capabilities: ["sfc", "useState", "JSX", "TSX"],
  },
];

export function PluginEditorExtensionsPanel({
  enabled,
  onChange,
  disabled = false,
  error,
}: {
  enabled: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  error?: string;
}) {
  const t = useMessages(messages);
  const [query, setQuery] = useState("");
  const filteredExtensions = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return pluginEditorExtensionsCatalog;
    return pluginEditorExtensionsCatalog.filter((extension) =>
      [
        extension.id,
        extension.name,
        extension.publisher,
        t(extension.descriptionMessage),
        ...extension.capabilities,
      ]
        .join(" ")
        .toLocaleLowerCase()
        .includes(normalizedQuery),
    );
  }, [query, t]);

  function setExtensionEnabled(id: string, shouldEnable: boolean) {
    const next = shouldEnable
      ? [...new Set([...enabled, id])]
      : enabled.filter((extensionId) => extensionId !== id);
    onChange(next);
  }

  return (
    <section
      className="plugin-project-search-panel"
      aria-labelledby="plugin-editor-extensions-title"
    >
      <h2 id="plugin-editor-extensions-title">{t("title")}</h2>
      <input
        type="search"
        role="searchbox"
        aria-label={t("search")}
        placeholder={t("searchPlaceholder")}
        value={query}
        disabled={disabled}
        onChange={(event) => setQuery(event.currentTarget.value)}
      />
      <p>{t("catalogNote")}</p>
      {error && <p role="alert">{error}</p>}
      {filteredExtensions.length === 0 ? (
        <p role="status">{t("noResults")}</p>
      ) : (
        <div className="plugin-project-search-results">
          {filteredExtensions.map((extension) => {
            const isEnabled = enabled.includes(extension.id);
            return (
              <article
                key={extension.id}
                aria-label={`${extension.name} · ${extension.publisher}`}
                style={{
                  padding: "10px 12px",
                  borderBottom: "1px solid var(--ide-line)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <strong>{extension.name}</strong>
                  <span style={{ color: "var(--ide-secondary)", fontSize: 12 }}>
                    {extension.publisher}
                  </span>
                  {isEnabled && (
                    <span
                      role="status"
                      style={{
                        marginLeft: "auto",
                        fontSize: 11,
                        color: "var(--ide-secondary)",
                      }}
                    >
                      {t("enabled")}
                    </span>
                  )}
                </div>
                <p style={{ padding: "4px 0 8px", fontSize: 12 }}>
                  {t(extension.descriptionMessage)}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant={isEnabled ? "outline" : "default"}
                  disabled={disabled}
                  aria-label={`${isEnabled ? t("disable") : t("enable")} ${extension.name}`}
                  onClick={() => setExtensionEnabled(extension.id, !isEnabled)}
                >
                  {isEnabled ? t("disable") : t("enable")}
                </Button>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
