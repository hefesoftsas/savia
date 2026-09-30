import { useState } from "react";
import { Copy, ExternalLink, Share2 } from "lucide-react";
import {
  buildTenantOrigin,
  KNOWN_CANONICAL_HOSTS,
  normalizeTenantSlug,
  parseTenantSlugFromHostname,
} from "@savia/tenant-host";
import { useMessages } from "@/i18n/core";
import { settingsMessages } from "@/i18n/locales/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function TenantAccessUrl({ slug }: { slug?: string | null }) {
  const t = useMessages(settingsMessages);
  const [notice, setNotice] = useState<keyof typeof settingsMessages>();
  const [error, setError] = useState<keyof typeof settingsMessages>();
  const [pending, setPending] = useState(false);
  const normalizedSlug = normalizeTenantSlug(slug);
  const hostname = window.location.hostname;
  const canonical = KNOWN_CANONICAL_HOSTS.find(
    (host) =>
      hostname === host ||
      (hostname.endsWith(`.${host}`) &&
        parseTenantSlugFromHostname(hostname, host) !== null),
  );
  // Unknown deployment hosts must not produce links to an unrelated environment.
  if (!normalizedSlug || !canonical) return null;
  const url = buildTenantOrigin(normalizedSlug, canonical);

  async function act(share: boolean) {
    setNotice(undefined);
    setError(undefined);
    setPending(true);
    const nativeShare = share && typeof navigator.share === "function";
    try {
      if (nativeShare) {
        await navigator.share({ url });
        setNotice("Enlace compartido.");
      } else {
        await navigator.clipboard.writeText(url);
        setNotice("Enlace copiado.");
      }
    } catch (cause) {
      if (!(
        nativeShare &&
        cause instanceof DOMException &&
        cause.name === "AbortError"
      )) {
        setError(
          nativeShare
            ? "No se pudo compartir el enlace. Usa Copiar enlace para compartirlo."
            : "No se pudo copiar el enlace. Selecciona la URL y cópiala manualmente.",
        );
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      className="tenant-branding-access tenant-branding-field"
      aria-labelledby="tenant-access-label"
    >
      <label id="tenant-access-label" htmlFor="tenant-access-url">
        {t("Tu URL de Savia")}
      </label>
      <p id="tenant-access-help" className="tenant-branding-help">
        {t(
          "Savia asigna esta URL a tu organización. No se puede editar aquí. Compártela para acceder a tu espacio.",
        )}
      </p>
      <div className="tenant-branding-access-controls">
        <Input
          id="tenant-access-url"
          type="url"
          readOnly
          value={url}
          aria-describedby="tenant-access-help"
          onFocus={(event) => event.currentTarget.select()}
        />
        <div className="tenant-branding-actions">
          <Button asChild variant="outline">
            <a href={url} target="_blank" rel="noopener noreferrer">
              <ExternalLink aria-hidden="true" />
              {t("Open in new window")}
            </a>
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => void act(false)}
          >
            <Copy aria-hidden="true" />
            {t("Copiar enlace")}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => void act(true)}
          >
            <Share2 aria-hidden="true" />
            {t("Compartir enlace")}
          </Button>
        </div>
      </div>
      {notice && (
        <p role="status" className="tenant-branding-help">
          {t(notice)}
        </p>
      )}
      {error && (
        <p role="alert" className="tenant-branding-error">
          {t(error)}
        </p>
      )}
    </section>
  );
}
