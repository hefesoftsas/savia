import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useMessages } from "@/i18n/core";
import { EDITOR_EXTENSION_LIMITS } from "@savia/studio-shared/plugin-editor-extensions";
import { pluginEditorExtensionsMessages as messages } from "./plugin-editor-extensions-messages";
import {
  PluginEditorExtensionClient,
  PluginEditorExtensionClientError,
  type EditorExtensionInspection,
  type MarketplaceExtension,
} from "./plugin-editor-extension-client";
import type {
  InstalledEditorExtension,
  ProjectEditorExtensionReference,
} from "@savia/studio-shared/plugin-editor-extensions";

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

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function sameExtension(
  installed: InstalledEditorExtension,
  metadata: EditorExtensionInspection["metadata"],
) {
  return (
    installed.publisher.toLowerCase() === metadata.publisher.toLowerCase() &&
    installed.name.toLowerCase() === metadata.name.toLowerCase()
  );
}

function localizedCompatibilityReason(
  reason: string | null,
  t: (key: keyof typeof messages) => string,
): string {
  const messageKey: Record<string, keyof typeof messages> = {
    "desktop-only": "reasonDesktopOnly",
    "invalid-engine-range": "reasonInvalidEngineRange",
    "incompatible-engine": "reasonIncompatibleEngine",
    "unsupported-api": "reasonUnsupportedApi",
    "unsupported-contributions": "reasonUnsupportedContributions",
    "missing-browser-resource": "reasonMissingBrowserResource",
    "invalid-browser-resource": "reasonInvalidBrowserResource",
  };
  return reason && messageKey[reason] ? t(messageKey[reason]) : (reason ?? "");
}

export function PluginEditorExtensionsPanel({
  enabled,
  onChange,
  disabled = false,
  error,
  client,
  installedReferences = [],
  onInstalledChange,
  activationErrors = {},
  runtimeAvailable = false,
}: {
  enabled: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  error?: string;
  client?: PluginEditorExtensionClient;
  installedReferences?: ProjectEditorExtensionReference[];
  onInstalledChange?: (
    next: ProjectEditorExtensionReference[],
  ) => Promise<void>;
  activationErrors?: Record<string, string>;
  runtimeAvailable?: boolean;
}) {
  const t = useMessages(messages);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"marketplace" | "installed">("marketplace");
  const [marketplaceQuery, setMarketplaceQuery] = useState("");
  const [marketplaceItems, setMarketplaceItems] = useState<
    MarketplaceExtension[]
  >([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [inspection, setInspection] =
    useState<EditorExtensionInspection | null>(null);
  const [installed, setInstalled] = useState<InstalledEditorExtension[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [operationError, setOperationError] = useState("");
  const searchController = useRef<AbortController | null>(null);
  const uploadController = useRef<AbortController | null>(null);

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

  useEffect(() => {
    return () => {
      searchController.current?.abort();
      uploadController.current?.abort();
    };
  }, []);

  useEffect(() => {
    searchController.current?.abort();
    uploadController.current?.abort();
    setInspection(null);
  }, [client]);

  useEffect(() => {
    if (!client) return;
    let current = true;
    setBusy("list");
    setOperationError("");
    void client
      .list()
      .then((result) => {
        if (current) setInstalled(result);
      })
      .catch((reason: unknown) => {
        if (current) setOperationError(errorMessage(reason, t("installError")));
      })
      .finally(() => {
        if (current) setBusy(null);
      });
    return () => {
      current = false;
    };
  }, [client, tab, t]);

  function setBundledEnabled(id: string, shouldEnable: boolean) {
    const next = shouldEnable
      ? [...new Set([...enabled, id])]
      : enabled.filter((extensionId) => extensionId !== id);
    onChange(next);
  }

  async function searchMarketplace(offset = 0) {
    if (!client) return;
    searchController.current?.abort();
    const controller = new AbortController();
    searchController.current = controller;
    setBusy("search");
    setOperationError("");
    if (offset === 0) setInspection(null);
    try {
      const result = await client.search(
        marketplaceQuery,
        offset,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setMarketplaceItems((current) =>
        offset === 0 ? result.results : [...current, ...result.results],
      );
      setNextOffset(result.nextOffset);
    } catch (reason) {
      if (!controller.signal.aborted)
        setOperationError(errorMessage(reason, t("searchError")));
    } finally {
      if (searchController.current === controller) {
        searchController.current = null;
        setBusy(null);
      }
    }
  }

  async function inspectMarketplace(item: MarketplaceExtension) {
    if (!client) return;
    setBusy(`inspect:${item.publisher}.${item.name}`);
    setOperationError("");
    try {
      const result = await client.inspectMarketplace(item);
      setInspection(result);
    } catch (reason) {
      setOperationError(errorMessage(reason, t("inspectError")));
    } finally {
      setBusy(null);
    }
  }

  async function inspectUpload(file: File | undefined) {
    if (!client || !file) return;
    setInspection(null);
    setOperationError("");
    if (
      !file.name.toLowerCase().endsWith(".vsix") ||
      file.size < 1 ||
      file.size > EDITOR_EXTENSION_LIMITS.compressedBytes
    ) {
      setOperationError(t("uploadLimit"));
      return;
    }
    uploadController.current?.abort();
    const controller = new AbortController();
    uploadController.current = controller;
    setBusy("upload");
    try {
      setInspection(await client.inspectUpload(file, controller.signal));
    } catch (reason) {
      if (!controller.signal.aborted)
        setOperationError(errorMessage(reason, t("inspectError")));
    } finally {
      if (uploadController.current === controller) {
        uploadController.current = null;
        setBusy(null);
      }
    }
  }

  async function installInspection() {
    if (!client || !inspection || !inspection.metadata.compatibility.supported)
      return;
    if (!runtimeAvailable) {
      setOperationError(t("runtimeUnavailable"));
      return;
    }
    setBusy("install");
    setOperationError("");
    try {
      const previousInstallations = installedReferences.length
        ? await client.list()
        : installed;
      const installation = await client.install(inspection.inspectionId);
      setInstalled((current) => {
        const next = current.filter(
          (item) => item.installationId !== installation.installationId,
        );
        return [...next, installation].sort((a, b) =>
          `${a.publisher}.${a.name}.${a.version}`.localeCompare(
            `${b.publisher}.${b.name}.${b.version}`,
          ),
        );
      });
      const updateTarget = previousInstallations.find(
        (item) =>
          sameExtension(item, installation) &&
          installedReferences.some(
            (reference) => reference.installationId === item.installationId,
          ),
      );
      if (updateTarget && onInstalledChange) {
        const nextReferences = [
          ...installedReferences.filter(
            (reference) =>
              reference.installationId !== updateTarget.installationId,
          ),
          {
            installationId: installation.installationId,
            sha256: installation.sha256,
          },
        ];
        await onInstalledChange(nextReferences);
      }
      setInspection(null);
      setTab("installed");
    } catch (reason) {
      setOperationError(errorMessage(reason, t("installError")));
    } finally {
      setBusy(null);
    }
  }

  async function changeInstalledReference(
    installation: InstalledEditorExtension,
  ) {
    if (!onInstalledChange) return;
    const enabled = installedReferences.some(
      (reference) => reference.installationId === installation.installationId,
    );
    if (
      !enabled &&
      installedReferences.length >= EDITOR_EXTENSION_LIMITS.projectReferences
    ) {
      setOperationError(t("referenceLimit"));
      return;
    }
    const next: ProjectEditorExtensionReference[] = enabled
      ? installedReferences.filter(
          (reference) =>
            reference.installationId !== installation.installationId,
        )
      : [
          ...installedReferences,
          {
            installationId: installation.installationId,
            sha256: installation.sha256,
          },
        ];
    setBusy(`reference:${installation.installationId}`);
    setOperationError("");
    try {
      await onInstalledChange(next);
    } catch (reason) {
      setOperationError(errorMessage(reason, t("changeError")));
    } finally {
      setBusy(null);
    }
  }

  async function removeInstallation(installation: InstalledEditorExtension) {
    if (!client) return;
    const isReferenced = installedReferences.some(
      (reference) => reference.installationId === installation.installationId,
    );
    setBusy(`remove:${installation.installationId}`);
    setOperationError("");
    try {
      if (isReferenced && onInstalledChange) {
        await onInstalledChange(
          installedReferences.filter(
            (reference) =>
              reference.installationId !== installation.installationId,
          ),
        );
      }
      await client.uninstall(installation.installationId);
      setInstalled((current) =>
        current.filter(
          (item) => item.installationId !== installation.installationId,
        ),
      );
    } catch (reason) {
      const errorText = errorMessage(reason, t("removeError"));
      const details =
        reason instanceof PluginEditorExtensionClientError &&
        reason.details &&
        typeof reason.details === "object" &&
        "projectIds" in reason.details &&
        Array.isArray(reason.details.projectIds)
          ? ` ${reason.details.projectIds.join(", ")}`
          : "";
      setOperationError(`${errorText}${details}`);
    } finally {
      setBusy(null);
    }
  }

  const updateTarget = inspection
    ? installed.find(
        (item) =>
          sameExtension(item, inspection.metadata) &&
          installedReferences.some(
            (reference) => reference.installationId === item.installationId,
          ),
      )
    : undefined;

  return (
    <section
      className="plugin-project-search-panel"
      aria-labelledby="plugin-editor-extensions-title"
    >
      <h2 id="plugin-editor-extensions-title">{t("title")}</h2>
      <label style={{ display: "grid", gap: 4 }}>
        <span>{t("search")}</span>
        <input
          type="search"
          role="searchbox"
          aria-label={t("search")}
          placeholder={t("searchPlaceholder")}
          value={query}
          disabled={disabled}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </label>
      <p>{t("catalogNote")}</p>
      {error && <p role="alert">{error}</p>}
      {filteredExtensions.length === 0 ? (
        <p role="status">{t("noResults")}</p>
      ) : (
        <div className="plugin-project-search-results" aria-label={t("title")}>
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
                  onClick={() => setBundledEnabled(extension.id, !isEnabled)}
                >
                  {isEnabled ? t("disable") : t("enable")}
                </Button>
              </article>
            );
          })}
        </div>
      )}

      {client && (
        <div style={{ marginTop: 20 }}>
          <div
            role="tablist"
            aria-label={t("title")}
            style={{ display: "flex", gap: 8 }}
          >
            <Button
              type="button"
              role="tab"
              aria-selected={tab === "marketplace"}
              variant={tab === "marketplace" ? "default" : "outline"}
              onClick={() => setTab("marketplace")}
            >
              {t("marketplace")}
            </Button>
            <Button
              type="button"
              role="tab"
              aria-selected={tab === "installed"}
              variant={tab === "installed" ? "default" : "outline"}
              onClick={() => setTab("installed")}
            >
              {t("installedTab")}
            </Button>
          </div>
          {!runtimeAvailable && <p role="status">{t("runtimeUnavailable")}</p>}
          <p>{t("projectAccessNotice")}</p>
          {operationError && <p role="alert">{operationError}</p>}

          {tab === "marketplace" ? (
            <div role="tabpanel" aria-label={t("marketplace")}>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void searchMarketplace(0);
                }}
                style={{ display: "flex", gap: 8, margin: "12px 0" }}
              >
                <input
                  type="search"
                  aria-label={t("marketplaceSearch")}
                  placeholder={t("marketplacePlaceholder")}
                  value={marketplaceQuery}
                  disabled={disabled || busy === "search"}
                  onChange={(event) =>
                    setMarketplaceQuery(event.currentTarget.value)
                  }
                />
                <Button
                  type="submit"
                  disabled={
                    disabled || busy === "search" || !marketplaceQuery.trim()
                  }
                >
                  {t("searchMarketplace")}
                </Button>
              </form>
              <label
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 12,
                }}
              >
                <span>{t("upload")}</span>
                <input
                  type="file"
                  accept=".vsix,application/zip,application/octet-stream"
                  aria-label={t("upload")}
                  disabled={disabled || busy === "upload"}
                  onChange={(event) => {
                    void inspectUpload(event.currentTarget.files?.[0]);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
              {busy === "search" && <p role="status">{t("loading")}</p>}
              {marketplaceItems.length === 0 && busy !== "search" && (
                <p role="status">{t("noMarketplaceResults")}</p>
              )}
              <div className="plugin-project-search-results">
                {marketplaceItems.map((item) => (
                  <article
                    key={`${item.publisher}.${item.name}.${item.version}`}
                    style={{
                      padding: "10px 12px",
                      borderBottom: "1px solid var(--ide-line)",
                    }}
                  >
                    <strong>{item.displayName ?? item.name}</strong>
                    <p>
                      {item.publisher} · {t("version")} {item.version}
                    </p>
                    {item.description && <p>{item.description}</p>}
                    {item.license && (
                      <p>
                        {t("license")}: {item.license}
                      </p>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      disabled={disabled || busy !== null}
                      onClick={() => void inspectMarketplace(item)}
                    >
                      {busy === `inspect:${item.publisher}.${item.name}`
                        ? t("loading")
                        : t("inspect")}
                    </Button>
                  </article>
                ))}
              </div>
              {nextOffset !== null && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={disabled || busy !== null}
                  onClick={() => void searchMarketplace(nextOffset)}
                >
                  {t("pageMore")}
                </Button>
              )}
              {inspection && (
                <InspectionCard
                  inspection={inspection}
                  update={Boolean(updateTarget)}
                  busy={busy === "install"}
                  disabled={disabled || !runtimeAvailable || busy !== null}
                  onInstall={() => void installInspection()}
                  t={t}
                />
              )}
            </div>
          ) : (
            <div role="tabpanel" aria-label={t("installedTab")}>
              {busy === "list" && <p role="status">{t("loading")}</p>}
              {installed.length === 0 && busy !== "list" && (
                <p role="status">{t("noInstalled")}</p>
              )}
              <div className="plugin-project-search-results">
                {installed.map((installation) => {
                  const reference = installedReferences.find(
                    (item) =>
                      item.installationId === installation.installationId,
                  );
                  const activationError =
                    activationErrors[installation.installationId];
                  const referencePending =
                    busy === `reference:${installation.installationId}`;
                  const operationBusy =
                    referencePending ||
                    busy === `remove:${installation.installationId}`;
                  return (
                    <article
                      key={installation.installationId}
                      style={{
                        padding: "10px 12px",
                        borderBottom: "1px solid var(--ide-line)",
                      }}
                    >
                      <strong>{installation.name}</strong>
                      <p>
                        {installation.publisher} · {t("version")}{" "}
                        {installation.version}
                      </p>
                      {reference && (
                        <p role="status">
                          {activationError
                            ? `${t("activationFailed")} ${activationError}`
                            : referencePending
                              ? t("pending")
                              : t("enabled")}
                        </p>
                      )}
                      {activationError && <p role="alert">{activationError}</p>}
                      <Button
                        type="button"
                        size="sm"
                        variant={reference ? "outline" : "default"}
                        disabled={
                          disabled ||
                          !runtimeAvailable ||
                          !onInstalledChange ||
                          operationBusy
                        }
                        onClick={() =>
                          void changeInstalledReference(installation)
                        }
                      >
                        {reference ? t("disable") : t("enable")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={
                          disabled ||
                          operationBusy ||
                          (Boolean(reference) && !onInstalledChange)
                        }
                        onClick={() => void removeInstallation(installation)}
                      >
                        {t("remove")}
                      </Button>
                    </article>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function InspectionCard({
  inspection,
  update,
  busy,
  disabled,
  onInstall,
  t,
}: {
  inspection: EditorExtensionInspection;
  update: boolean;
  busy: boolean;
  disabled: boolean;
  onInstall: () => void;
  t: (key: keyof typeof messages, values?: Record<string, string>) => string;
}) {
  const { metadata, manifestSummary } = inspection;
  const reason = metadata.compatibility.reason;
  return (
    <article
      aria-label={`${metadata.publisher}.${metadata.name}`}
      style={{
        marginTop: 12,
        padding: "10px 12px",
        border: "1px solid var(--ide-line)",
      }}
    >
      <strong>
        {metadata.publisher}.{metadata.name}
      </strong>
      <p>
        {t("version")} {metadata.version} · {t("license")}:{" "}
        {metadata.license ?? "—"}
      </p>
      {manifestSummary.description && <p>{manifestSummary.description}</p>}
      {metadata.compatibility.supported ? (
        <p role="status">{t("compatibilitySupported")}</p>
      ) : (
        <p role="alert">
          {t("compatibilityUnsupported")}{" "}
          {localizedCompatibilityReason(reason, t)}
        </p>
      )}
      <Button
        type="button"
        disabled={disabled || !metadata.compatibility.supported}
        onClick={onInstall}
      >
        {busy ? t("loading") : update ? t("update") : t("install")}
      </Button>
    </article>
  );
}
