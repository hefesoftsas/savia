import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Button } from "@/components/ui/button";
import { useMessages } from "@/i18n/core";
import { Search, Upload } from "lucide-react";
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
  const translate = useRef(t);
  translate.current = t;
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"marketplace" | "installed">("marketplace");
  const [marketplaceItems, setMarketplaceItems] = useState<
    MarketplaceExtension[]
  >([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [inspection, setInspection] =
    useState<EditorExtensionInspection | null>(null);
  const [installed, setInstalled] = useState<InstalledEditorExtension[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [operationError, setOperationError] = useState("");
  const [searchError, setSearchError] = useState("");
  const [installedError, setInstalledError] = useState("");
  const [searching, setSearching] = useState(Boolean(client));
  const [loadingInstalled, setLoadingInstalled] = useState(false);
  const searchController = useRef<AbortController | null>(null);
  const uploadController = useRef<AbortController | null>(null);
  const searchGeneration = useRef(0);
  const installedListGeneration = useRef(0);
  const inspectionGeneration = useRef(0);
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextDebounce = useRef<string | null>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const tabButtons = useRef<Record<string, HTMLButtonElement | null>>({});
  const id = useId().replaceAll(":", "");

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredBundled = useMemo(() => {
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
  }, [normalizedQuery, t]);
  const filteredInstalled = useMemo(() => {
    if (!normalizedQuery) return installed;
    return installed.filter((extension) =>
      [
        extension.id,
        extension.name,
        extension.publisher,
        extension.version,
        extension.license ?? "",
      ]
        .join(" ")
        .toLocaleLowerCase()
        .includes(normalizedQuery),
    );
  }, [installed, normalizedQuery]);

  useEffect(() => {
    return () => {
      searchGeneration.current += 1;
      searchController.current?.abort();
      uploadController.current?.abort();
      if (searchDebounce.current) clearTimeout(searchDebounce.current);
    };
  }, []);

  useEffect(() => {
    searchGeneration.current += 1;
    searchController.current?.abort();
    searchController.current = null;
    uploadController.current?.abort();
    inspectionGeneration.current += 1;
    setBusy(null);
    setInspection(null);
    setMarketplaceItems([]);
    setNextOffset(null);
    setSearchError("");
  }, [client]);

  useEffect(() => {
    const generation = ++installedListGeneration.current;
    if (!client) {
      setInstalled([]);
      setLoadingInstalled(false);
      setInstalledError("");
      return;
    }
    let current = true;
    setLoadingInstalled(true);
    setInstalledError("");
    void client
      .list()
      .then((result) => {
        if (current && generation === installedListGeneration.current)
          setInstalled(result);
      })
      .catch((reason: unknown) => {
        if (current && generation === installedListGeneration.current)
          setInstalledError(
            errorMessage(reason, translate.current("installError")),
          );
      })
      .finally(() => {
        if (current && generation === installedListGeneration.current)
          setLoadingInstalled(false);
      });
    return () => {
      current = false;
    };
  }, [client]);

  const searchMarketplace = useCallback(
    async (offset = 0, searchQuery = query) => {
      if (!client) return;
      searchController.current?.abort();
      const controller = new AbortController();
      const generation = ++searchGeneration.current;
      searchController.current = controller;
      setSearching(true);
      setSearchError("");
      if (offset === 0) {
        setMarketplaceItems([]);
        setNextOffset(null);
      }
      try {
        const result = await client.search(
          searchQuery,
          offset,
          controller.signal,
        );
        if (
          controller.signal.aborted ||
          generation !== searchGeneration.current
        )
          return;
        setMarketplaceItems((current) =>
          offset === 0 ? result.results : [...current, ...result.results],
        );
        setNextOffset(result.nextOffset);
      } catch (reason) {
        if (
          !controller.signal.aborted &&
          generation === searchGeneration.current
        )
          setSearchError(errorMessage(reason, t("searchError")));
      } finally {
        if (searchController.current === controller) {
          searchController.current = null;
          if (generation === searchGeneration.current) setSearching(false);
        }
      }
    },
    [client, query, t],
  );

  useEffect(() => {
    if (tab !== "marketplace" || !client) return;
    if (skipNextDebounce.current === query) {
      skipNextDebounce.current = null;
      return;
    }
    setSearching(true);
    searchDebounce.current = setTimeout(() => {
      searchDebounce.current = null;
      void searchMarketplace(0, query);
    }, 250);
    return () => {
      if (searchDebounce.current) clearTimeout(searchDebounce.current);
      searchDebounce.current = null;
      searchGeneration.current += 1;
      searchController.current?.abort();
      searchController.current = null;
      setSearching(false);
    };
  }, [client, query, searchMarketplace, tab]);

  function changeQuery(value: string) {
    inspectionGeneration.current += 1;
    uploadController.current?.abort();
    uploadController.current = null;
    setBusy((current) =>
      current === "upload" || current?.startsWith("inspect:") ? null : current,
    );
    skipNextDebounce.current = null;
    searchGeneration.current += 1;
    searchController.current?.abort();
    searchController.current = null;
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    searchDebounce.current = null;
    setSearching(Boolean(client));
    setSearchError("");
    setMarketplaceItems([]);
    setNextOffset(null);
    setInspection(null);
    setQuery(value);
    if (client) setTab("marketplace");
  }

  function selectTab(nextTab: "marketplace" | "installed") {
    if (nextTab === "installed") {
      searchGeneration.current += 1;
      searchController.current?.abort();
      searchController.current = null;
      if (searchDebounce.current) clearTimeout(searchDebounce.current);
      searchDebounce.current = null;
      setSearching(false);
    }
    setTab(nextTab);
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLElement>) {
    const tabs = ["marketplace", "installed"] as const;
    const current = tabs.indexOf(tab);
    const next =
      event.key === "ArrowRight"
        ? tabs[(current + 1) % tabs.length]
        : event.key === "ArrowLeft"
          ? tabs[(current + tabs.length - 1) % tabs.length]
          : event.key === "Home"
            ? tabs[0]
            : event.key === "End"
              ? tabs[tabs.length - 1]
              : null;
    if (next) {
      event.preventDefault();
      selectTab(next);
      tabButtons.current[next]?.focus();
    }
  }

  function setBundledEnabled(id: string, shouldEnable: boolean) {
    const next = shouldEnable
      ? [...new Set([...enabled, id])]
      : enabled.filter((extensionId) => extensionId !== id);
    onChange(next);
  }

  function cancelMarketplaceSearch() {
    searchGeneration.current += 1;
    searchController.current?.abort();
    searchController.current = null;
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    searchDebounce.current = null;
    setSearching(false);
  }

  async function inspectMarketplace(item: MarketplaceExtension) {
    if (!client) return;
    cancelMarketplaceSearch();
    const generation = ++inspectionGeneration.current;
    setBusy(`inspect:${item.publisher}.${item.name}`);
    setOperationError("");
    try {
      const result = await client.inspectMarketplace(item);
      if (generation === inspectionGeneration.current) setInspection(result);
    } catch (reason) {
      if (generation === inspectionGeneration.current)
        setOperationError(errorMessage(reason, t("inspectError")));
    } finally {
      if (generation === inspectionGeneration.current) setBusy(null);
    }
  }

  async function inspectUpload(file: File | undefined) {
    if (!client || !file) return;
    cancelMarketplaceSearch();
    const generation = ++inspectionGeneration.current;
    setInspection(null);
    setOperationError("");
    setBusy((current) =>
      current === "upload" || current?.startsWith("inspect:") ? null : current,
    );
    uploadController.current?.abort();
    uploadController.current = null;
    if (
      !file.name.toLowerCase().endsWith(".vsix") ||
      file.size < 1 ||
      file.size > EDITOR_EXTENSION_LIMITS.compressedBytes
    ) {
      setOperationError(t("uploadLimit"));
      return;
    }
    const controller = new AbortController();
    uploadController.current = controller;
    setBusy("upload");
    try {
      const result = await client.inspectUpload(file, controller.signal);
      if (generation !== inspectionGeneration.current) return;
      setInspection(result);
      setTab("marketplace");
    } catch (reason) {
      if (
        !controller.signal.aborted &&
        generation === inspectionGeneration.current
      )
        setOperationError(errorMessage(reason, t("inspectError")));
    } finally {
      if (
        uploadController.current === controller &&
        generation === inspectionGeneration.current
      ) {
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
    installedListGeneration.current += 1;
    setLoadingInstalled(false);
    try {
      const previousInstallations = await client.list();
      setInstalled(previousInstallations);
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
    installedListGeneration.current += 1;
    setLoadingInstalled(false);
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

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client) return;
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    searchDebounce.current = null;
    skipNextDebounce.current = query;
    void searchMarketplace(0, query);
  }

  function bundledRows() {
    return filteredBundled.map((extension) => {
      const isEnabled = enabled.includes(extension.id);
      return (
        <article className="plugin-editor-extension-row" key={extension.id}>
          <div className="plugin-editor-extension-row-heading">
            <strong>{extension.name}</strong>
          </div>
          <p className="plugin-editor-extension-meta">
            {extension.publisher}
            {isEnabled && (
              <span className="plugin-editor-extension-state" role="status">
                {" "}
                · {t("enabled")}
              </span>
            )}
          </p>
          <p className="plugin-editor-extension-description">
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
    });
  }

  return (
    <section
      className="plugin-editor-extensions-panel"
      aria-labelledby={`${id}-title`}
    >
      <header className="plugin-editor-extensions-header">
        <h2 id={`${id}-title`}>{t("title")}</h2>
        {client && (
          <>
            <input
              ref={uploadInput}
              className="plugin-editor-extensions-file-input"
              type="file"
              tabIndex={-1}
              accept=".vsix,application/zip,application/octet-stream"
              aria-label={t("upload")}
              disabled={disabled || busy === "upload"}
              onChange={(event) => {
                void inspectUpload(event.currentTarget.files?.[0]);
                event.currentTarget.value = "";
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="plugin-editor-extensions-upload"
              disabled={disabled || busy === "upload"}
              onClick={() => uploadInput.current?.click()}
            >
              <Upload aria-hidden="true" />
              <span>{t("upload")}</span>
            </Button>
          </>
        )}
      </header>
      <form
        className="plugin-editor-extensions-search"
        onSubmit={submitSearch}
        role="search"
      >
        <input
          type="search"
          role="searchbox"
          aria-label={t("search")}
          placeholder={t("searchPlaceholder")}
          value={query}
          maxLength={200}
          disabled={disabled}
          onChange={(event) => changeQuery(event.currentTarget.value)}
        />
        {client && (
          <Button
            type="submit"
            size="icon"
            variant="outline"
            aria-label={t("searchMarketplace")}
            disabled={disabled}
          >
            <Search aria-hidden="true" />
          </Button>
        )}
      </form>
      {error && (
        <p className="plugin-editor-extensions-alert" role="alert">
          {error}
        </p>
      )}
      {operationError && (
        <p className="plugin-editor-extensions-alert" role="alert">
          {operationError}
        </p>
      )}
      {client && (
        <div
          className="plugin-editor-extensions-tabs"
          role="tablist"
          aria-label={t("title")}
          onKeyDown={handleTabKeyDown}
        >
          <button
            ref={(node) => {
              tabButtons.current.marketplace = node;
            }}
            id={`${id}-marketplace-tab`}
            type="button"
            role="tab"
            aria-selected={tab === "marketplace"}
            aria-controls={`${id}-marketplace-panel`}
            tabIndex={tab === "marketplace" ? 0 : -1}
            onClick={() => selectTab("marketplace")}
          >
            {t("marketplace")}
          </button>
          <button
            ref={(node) => {
              tabButtons.current.installed = node;
            }}
            id={`${id}-installed-tab`}
            type="button"
            role="tab"
            aria-selected={tab === "installed"}
            aria-controls={`${id}-installed-panel`}
            tabIndex={tab === "installed" ? 0 : -1}
            onClick={() => selectTab("installed")}
          >
            {t("installedTab")}
          </button>
        </div>
      )}
      {client ? (
        tab === "marketplace" ? (
          <div
            id={`${id}-marketplace-panel`}
            className="plugin-editor-extensions-content"
            role="tabpanel"
            aria-labelledby={`${id}-marketplace-tab`}
            tabIndex={0}
          >
            {!runtimeAvailable && (
              <p className="plugin-editor-extensions-alert" role="status">
                {t("runtimeUnavailable")}
              </p>
            )}
            {searchError && (
              <p className="plugin-editor-extensions-alert" role="alert">
                {searchError}
              </p>
            )}
            {inspection && (
              <InspectionCard
                inspection={inspection}
                update={Boolean(updateTarget)}
                busy={busy === "install"}
                disabled={disabled || !runtimeAvailable || busy !== null}
                onInstall={() => void installInspection()}
                accessNotice={t("projectAccessNotice")}
                t={t}
              />
            )}
            <div
              className="plugin-editor-extensions-results"
              aria-label={t("marketplace")}
            >
              {searching && (
                <p className="plugin-editor-extensions-empty" role="status">
                  {t("loading")}
                </p>
              )}
              {!searching && !searchError && marketplaceItems.length === 0 && (
                <p className="plugin-editor-extensions-empty" role="status">
                  {t("noMarketplaceResults")}
                </p>
              )}
              {marketplaceItems.map((item) => (
                <article
                  className="plugin-editor-extension-row"
                  key={`${item.publisher}.${item.name}.${item.version}`}
                >
                  <div className="plugin-editor-extension-row-heading">
                    <strong>{item.displayName ?? item.name}</strong>
                  </div>
                  <p className="plugin-editor-extension-meta">
                    <span>
                      {item.publisher} · {t("version")} {item.version}
                    </span>
                  </p>
                  {item.description && (
                    <p className="plugin-editor-extension-description">
                      {item.description}
                    </p>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={disabled || busy !== null}
                    onClick={() => void inspectMarketplace(item)}
                  >
                    {busy === `inspect:${item.publisher}.${item.name}`
                      ? t("loading")
                      : t("inspect")}
                  </Button>
                </article>
              ))}
              {nextOffset !== null && (
                <div className="plugin-editor-extensions-more">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={disabled || searching || busy !== null}
                    onClick={() => void searchMarketplace(nextOffset)}
                  >
                    {t("pageMore")}
                  </Button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div
            id={`${id}-installed-panel`}
            className="plugin-editor-extensions-content"
            role="tabpanel"
            aria-labelledby={`${id}-installed-tab`}
            tabIndex={0}
          >
            {installedError && (
              <p className="plugin-editor-extensions-alert" role="alert">
                {installedError}
              </p>
            )}
            <div
              className="plugin-editor-extensions-results"
              aria-label={t("installedTab")}
            >
              {loadingInstalled && (
                <p className="plugin-editor-extensions-empty" role="status">
                  {t("loading")}
                </p>
              )}
              {filteredBundled.length > 0 && (
                <section
                  className="plugin-editor-extensions-group"
                  aria-label={t("builtIn")}
                >
                  <h3>{t("builtIn")}</h3>
                  {bundledRows()}
                </section>
              )}
              {filteredInstalled.length > 0 && (
                <section
                  className="plugin-editor-extensions-group"
                  aria-label={t("installedGroup")}
                >
                  <h3>{t("installedGroup")}</h3>
                  {filteredInstalled.map((installation) => {
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
                        className="plugin-editor-extension-row"
                        key={installation.installationId}
                      >
                        <div className="plugin-editor-extension-row-heading">
                          <strong>{installation.name}</strong>
                        </div>
                        <p className="plugin-editor-extension-meta">
                          {installation.publisher} · {t("version")}{" "}
                          {installation.version}
                        </p>
                        {reference && (
                          <p
                            className="plugin-editor-extension-state"
                            role="status"
                          >
                            {activationError
                              ? `${t("activationFailed")} ${activationError}`
                              : referencePending
                                ? t("pending")
                                : t("enabled")}
                          </p>
                        )}
                        {activationError && (
                          <p
                            className="plugin-editor-extensions-alert"
                            role="alert"
                          >
                            {activationError}
                          </p>
                        )}
                        <div className="plugin-editor-extension-actions">
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
                            onClick={() =>
                              void removeInstallation(installation)
                            }
                          >
                            {t("remove")}
                          </Button>
                        </div>
                      </article>
                    );
                  })}
                </section>
              )}
              {!loadingInstalled &&
                filteredBundled.length === 0 &&
                filteredInstalled.length === 0 && (
                  <p className="plugin-editor-extensions-empty" role="status">
                    {installed.length === 0 ? t("noInstalled") : t("noResults")}
                  </p>
                )}
            </div>
          </div>
        )
      ) : (
        <div
          className="plugin-editor-extensions-content"
          role="region"
          aria-label={t("title")}
        >
          <p className="plugin-editor-extensions-empty">{t("catalogNote")}</p>
          <div className="plugin-editor-extensions-results">
            {filteredBundled.length === 0 ? (
              <p className="plugin-editor-extensions-empty" role="status">
                {t("noResults")}
              </p>
            ) : (
              bundledRows()
            )}
          </div>
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
  accessNotice,
  t,
}: {
  inspection: EditorExtensionInspection;
  update: boolean;
  busy: boolean;
  disabled: boolean;
  onInstall: () => void;
  accessNotice: string;
  t: (key: keyof typeof messages, values?: Record<string, string>) => string;
}) {
  const { metadata, manifestSummary } = inspection;
  const reason = metadata.compatibility.reason;
  return (
    <article
      className="plugin-editor-extensions-inspection"
      aria-label={`${metadata.publisher}.${metadata.name}`}
    >
      <p className="plugin-editor-extensions-access-notice">{accessNotice}</p>
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
