import { useEffect, useId, useRef, useState } from "react";
import type { ApiClient } from "@/api/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMessages } from "@/i18n/core";
import { animationCatalogMessages } from "./animation-catalog-messages";
import { LottiePreview } from "./lottie-preview";
export type CatalogAnimation = {
  id: string;
  name: string;
  author: string;
  license: "MIT";
  licenseUrl: string;
  sourceUrl: string;
  keywords: string[];
};
function verifiedEntry(value: unknown): value is CatalogAnimation {
  if (!value || typeof value !== "object") return false;
  const item = value as CatalogAnimation;
  // Only the reviewed provider and license are exposed by this catalog.
  return (
    item.license === "MIT" &&
    typeof item.id === "string" &&
    /^[a-z0-9-]+$/.test(item.id) &&
    typeof item.name === "string" &&
    typeof item.author === "string" &&
    [item.licenseUrl, item.sourceUrl].every(
      (url) =>
        typeof url === "string" &&
        url.startsWith("https://github.com/spemer/lottie-animations-json/"),
    )
  );
}
export function AnimationCatalog({
  apiClient,
  path,
  disabled,
  onSelect,
}: {
  apiClient: ApiClient;
  path: string;
  disabled: boolean;
  onSelect: (entry: CatalogAnimation, data: unknown) => void;
}) {
  const t = useMessages(animationCatalogMessages);
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState({ query: "", attempt: 0 });
  const [entries, setEntries] = useState<CatalogAnimation[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setState("loading");
    setEntries([]);
    void apiClient
      .get<{ data: unknown[] }>(
        `${path}/animations?q=${encodeURIComponent(search.query)}`,
        { signal: controller.signal },
      )
      .then((result) => {
        if (controller.signal.aborted) return;
        if (!Array.isArray(result.data)) throw new Error("Invalid catalog");
        setEntries(result.data.filter(verifiedEntry));
        setState("ready");
      })
      .catch(() => {
        if (!controller.signal.aborted) setState("error");
      });
    return () => controller.abort();
  }, [apiClient, path, search, open]);
  const runSearch = () =>
    setSearch((previous) => ({
      query: query.trim(),
      attempt: previous.attempt + 1,
    }));
  return (
    <div className="tenant-animation-catalog">
      <Button
        ref={trigger}
        type="button"
        variant="outline"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        {t(open ? "Ocultar catálogo" : "Explorar animaciones gratuitas")}
      </Button>
      {open && (
        <div id={id} className="tenant-animation-browser">
          <p className="tenant-branding-help">
            {t(
              "Colección gratuita verificada · licencia MIT. Puedes usarla en tu pantalla de acceso.",
            )}
          </p>
          <div className="tenant-branding-field">
            <label htmlFor={`${id}-search`}>
              {t("Buscar animaciones gratuitas")}
            </label>
            <div className="tenant-animation-search">
              <Input
                id={`${id}-search`}
                type="search"
                value={query}
                maxLength={80}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    runSearch();
                  }
                }}
              />
              <Button type="button" variant="secondary" onClick={runSearch}>
                {t("Buscar")}
              </Button>
            </div>
          </div>
          {state === "loading" && (
            <p role="status">{t("Cargando animaciones…")}</p>
          )}
          {state === "error" && (
            <div role="alert">
              <p>
                {t("No se pudo cargar el catálogo. Reintenta la búsqueda.")}
              </p>
              <Button type="button" variant="outline" onClick={runSearch}>
                {t("Reintentar búsqueda")}
              </Button>
            </div>
          )}
          {state === "ready" && !entries.length && (
            <p role="status">
              {t("No encontramos animaciones. Prueba otra palabra.")}
            </p>
          )}
          <div className="tenant-animation-results">
            {entries.map((entry) => (
              <AnimationResult
                key={entry.id}
                entry={entry}
                apiClient={apiClient}
                path={path}
                disabled={disabled}
                onSelect={onSelect}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
function AnimationResult({
  entry,
  apiClient,
  path,
  disabled,
  onSelect,
}: {
  entry: CatalogAnimation;
  apiClient: ApiClient;
  path: string;
  disabled: boolean;
  onSelect: (entry: CatalogAnimation, data: unknown) => void;
}) {
  const t = useMessages(animationCatalogMessages);
  const [data, setData] = useState<unknown>();
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void apiClient
      .get(`${path}/animations/${encodeURIComponent(entry.id)}`, {
        signal: controller.signal,
      })
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [apiClient, path, entry.id]);
  return (
    <article className="tenant-animation-result">
      {data ? (
        <LottiePreview data={data} name={entry.name} />
      ) : (
        <div className="tenant-animation-preview">
          <span>
            {t(
              error ? "Vista previa no disponible." : "Cargando vista previa…",
            )}
          </span>
        </div>
      )}
      <div className="tenant-animation-details">
        <strong>{entry.name}</strong>
        <span>{entry.author}</span>
        <div className="tenant-animation-links">
          <a href={entry.licenseUrl} target="_blank" rel="noopener noreferrer">
            {t("Gratis · MIT")}
          </a>
          <a href={entry.sourceUrl} target="_blank" rel="noopener noreferrer">
            {t("Fuente")}
          </a>
        </div>
      </div>
      <Button
        type="button"
        variant="secondary"
        disabled={disabled || !data}
        onClick={() => onSelect(entry, data)}
      >
        {t("Usar %{name}", { name: entry.name })}
      </Button>
    </article>
  );
}
