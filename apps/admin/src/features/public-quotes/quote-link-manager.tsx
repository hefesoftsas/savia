import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { useAppLocale } from "@/i18n/core";
import { Copy, ExternalLink, Loader2, ShieldOff } from "lucide-react";

const quoteLinkSchema = z
  .object({
    id: z.string().min(1).max(160),
    quoteId: z.string().min(1).max(160),
    url: z.string().url(),
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    revokedAt: z.string().datetime().nullable(),
  })
  .strict();
const quoteLinksSchema = z
  .object({ items: z.array(quoteLinkSchema).max(100) })
  .strict();
type QuoteLink = z.infer<typeof quoteLinkSchema>;
type Locale = "es" | "en" | "pt";

const labels = {
  es: {
    title: "Resultados de cotización compartidos",
    empty: "Todavía no hay resultados compartidos.",
    load: "Cargando enlaces…",
    retry: "Reintentar",
    active: "Activo",
    expired: "Vencido",
    revoked: "Revocado",
    created: "Creado",
    expires: "Vence",
    open: "Abrir enlace de cotización",
    copy: "Copiar enlace de cotización",
    copied: "Enlace copiado.",
    revoke: "Revocar enlace",
    revoking: "Revocando…",
    revokeError: "No se pudo revocar el enlace. Sigue activo.",
    loadError: "No se pudieron cargar los enlaces de cotización.",
    copyError: "No se pudo copiar el enlace.",
  },
  en: {
    title: "Shared quote results",
    empty: "No quote results have been shared yet.",
    load: "Loading links…",
    retry: "Retry",
    active: "Active",
    expired: "Expired",
    revoked: "Revoked",
    created: "Created",
    expires: "Expires",
    open: "Open quote link",
    copy: "Copy quote link",
    copied: "Link copied.",
    revoke: "Revoke link",
    revoking: "Revoking…",
    revokeError: "The link could not be revoked. It is still active.",
    loadError: "Quote links could not be loaded.",
    copyError: "The link could not be copied.",
  },
  pt: {
    title: "Resultados de cotação compartilhados",
    empty: "Ainda não há resultados compartilhados.",
    load: "Carregando links…",
    retry: "Tentar novamente",
    active: "Ativo",
    expired: "Expirado",
    revoked: "Revogado",
    created: "Criado",
    expires: "Expira",
    open: "Abrir link da cotação",
    copy: "Copiar link da cotação",
    copied: "Link copiado.",
    revoke: "Revogar link",
    revoking: "Revogando…",
    revokeError: "Não foi possível revogar o link. Ele continua ativo.",
    loadError: "Não foi possível carregar os links de cotação.",
    copyError: "Não foi possível copiar o link.",
  },
} as const;

function activeLocale(locale: string): Locale {
  return locale === "en" || locale === "pt" ? locale : "es";
}
function formatDate(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(
    locale === "pt" ? "pt-BR" : locale === "en" ? "en-US" : "es-CO",
    {
      dateStyle: "medium",
      timeStyle: "short",
    },
  ).format(new Date(value));
}
function safeHref(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      /^\/public\/quotes\/[a-f0-9]{64}\/?$/i.test(url.pathname)
      ? url.href
      : "";
  } catch {
    return "";
  }
}

export function QuoteLinkManager(props: {
  tenantId: number;
  request: (path: string, init?: RequestInit) => Promise<Response>;
}) {
  return <ScopedQuoteLinkManager key={props.tenantId} {...props} />;
}

/** Owner-only list for revoking the seven-day quote links published by WhatsApp. */
function ScopedQuoteLinkManager({
  tenantId,
  request,
}: {
  tenantId: number;
  request: (path: string, init?: RequestInit) => Promise<Response>;
}) {
  const locale = activeLocale(useAppLocale());
  const text = labels[locale];
  const [opened, setOpened] = useState(false);
  const [items, setItems] = useState<QuoteLink[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<string>();
  const [revokedIds, setRevokedIds] = useState<Set<string>>(() => new Set());
  const [refreshKey, setRefreshKey] = useState(0);
  const endpoint = `/api/tenants/${encodeURIComponent(String(tenantId))}/quote-links`;

  useEffect(() => {
    if (!opened || loaded) return;
    let current = true;
    setLoading(true);
    setError("");
    void request(endpoint)
      .then(async (response) => {
        if (!response.ok) throw new Error(text.loadError);
        const parsed = quoteLinksSchema.safeParse(await response.json());
        if (!parsed.success) throw new Error(text.loadError);
        if (current) {
          setItems(
            parsed.data.items.map((item) =>
              revokedIds.has(item.id) && !item.revokedAt
                ? { ...item, revokedAt: new Date().toISOString() }
                : item,
            ),
          );
          setLoaded(true);
        }
      })
      .catch(() => {
        if (current) setError(text.loadError);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [
    endpoint,
    loaded,
    opened,
    refreshKey,
    request,
    revokedIds,
    text.loadError,
  ]);

  const copyLink = useCallback(
    async (url: string) => {
      try {
        if (!safeHref(url)) throw new Error("unsafe URL");
        await navigator.clipboard.writeText(url);
        setNotice(text.copied);
        setError("");
      } catch {
        setNotice("");
        setError(text.copyError);
      }
    },
    [text.copied, text.copyError],
  );

  async function revoke(link: QuoteLink) {
    if (
      pending ||
      link.revokedAt ||
      new Date(link.expiresAt).getTime() <= Date.now()
    )
      return;
    setPending(link.id);
    setError("");
    setNotice("");
    try {
      const response = await request(
        `${endpoint}/${encodeURIComponent(link.id)}`,
        { method: "DELETE" },
      );
      if (!response.ok) throw new Error(text.revokeError);
      setRevokedIds((previous) => new Set(previous).add(link.id));
      setItems((previous) =>
        previous.map((item) =>
          item.id === link.id
            ? { ...item, revokedAt: new Date().toISOString() }
            : item,
        ),
      );
      setNotice(text.revoked);
      setLoaded(false);
      setRefreshKey((key) => key + 1);
    } catch {
      setError(text.revokeError);
    } finally {
      setPending(undefined);
    }
  }

  return (
    <details
      className="rounded-xl border bg-background/70"
      onToggle={(event) => setOpened(event.currentTarget.open)}
    >
      <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold marker:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="flex items-center justify-between gap-3">
          {text.title}
          <span aria-hidden="true" className="text-muted-foreground">
            ⌄
          </span>
        </span>
      </summary>
      <div className="grid gap-4 border-t px-4 py-4">
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="text-sm text-muted-foreground">
            {notice}
          </p>
        )}
        {loading ? (
          <p
            role="status"
            className="flex items-center gap-2 text-sm text-muted-foreground"
          >
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            {text.load}
          </p>
        ) : error && !loaded && items.length === 0 ? (
          <button
            type="button"
            className="w-fit rounded-md border px-3 py-1.5 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => {
              setError("");
              setRefreshKey((key) => key + 1);
            }}
          >
            {text.retry}
          </button>
        ) : items.length ? (
          <ul className="grid gap-3">
            {items.map((link) => {
              const href = safeHref(link.url);
              const expired = new Date(link.expiresAt).getTime() <= Date.now();
              const revoked = !!link.revokedAt || revokedIds.has(link.id);
              const status = revoked
                ? text.revoked
                : expired
                  ? text.expired
                  : text.active;
              return (
                <li
                  key={link.id}
                  className="grid gap-3 border-b pb-3 last:border-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                >
                  <div className="min-w-0">
                    <span className="inline-flex rounded-full border px-2 py-0.5 text-xs font-medium">
                      {status}
                    </span>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {text.created}: {formatDate(link.createdAt, locale)} ·{" "}
                      {text.expires}: {formatDate(link.expiresAt, locale)}
                    </p>
                    {href && (
                      <p className="mt-1 break-all text-xs text-muted-foreground">
                        {href}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {href && (
                      <>
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={text.open}
                          className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <ExternalLink
                            className="size-3.5"
                            aria-hidden="true"
                          />
                          {text.open}
                        </a>
                        <button
                          type="button"
                          onClick={() => void copyLink(href)}
                          aria-label={text.copy}
                          className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <Copy className="size-3.5" aria-hidden="true" />
                          {text.copy}
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => void revoke(link)}
                      disabled={revoked || expired || !!pending}
                      className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <ShieldOff className="size-3.5" aria-hidden="true" />
                      {pending === link.id ? text.revoking : text.revoke}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{text.empty}</p>
        )}
      </div>
    </details>
  );
}
