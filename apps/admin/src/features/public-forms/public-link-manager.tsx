import { useMessages, useAppLocale, intlLocale } from "@/i18n/core";
import { publicFormsMessages } from "@/i18n/locales/public-forms";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { PublicLinkQr } from "./public-link-qr";
import {
  ArrowLeft,
  Ban,
  Calendar,
  Check,
  Clock,
  Copy,
  ExternalLink,
  Globe,
  Link2,
  Loader2,
  QrCode,
  Share2,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import "./public-forms.css";

const linkSchema = z.object({
  id: z.string(),
  token: z.string(),
  path: z.string(),
  url: z.string().optional(),
  kind: z.enum(["record", "quote"]),
  expiresAt: z.string().nullable().optional(),
  revokedAt: z.string().nullable().optional(),
  dailyLimit: z.number(),
});
type PublicLink = z.infer<typeof linkSchema>;

type Props = {
  domainId: string;
  objectName: string;
  kind: "record" | "quote";
  request: (path: string, init?: RequestInit) => Promise<Response>;
  screenTitle?: string;
  onBack?: () => void;
};

function managementError(status: number) {
  if (status === 503)
    return "No se pueden publicar enlaces todavía: falta configurar la verificación de seguridad. Contacta al administrador.";
  if (status === 401 || status === 403)
    return "No tienes permiso para administrar estos enlaces. Verifica tu sesión y tus permisos.";
  if (status === 400 || status === 422)
    return "No se pudo publicar este formulario. Revisa sus campos, la vigencia y el límite de envíos.";
  return "No se pudo completar la operación. Revisa tu conexión y vuelve a intentarlo.";
}

function linkUrl(link: PublicLink) {
  const parsed = new URL(link.url ?? link.path, window.location.origin);
  return ["https:", "http:"].includes(parsed.protocol) ? parsed.href : "";
}

function setChecked(
  checked: boolean | "indeterminate",
  setter: (value: boolean) => void,
) {
  setter(checked === true);
}

/** Protected controls; the caller supplies the existing authenticated transport. */
export function PublicLinkManager({
  domainId,
  objectName,
  kind,
  request,
  screenTitle,
  onBack,
}: Props) {
  const t = useMessages(publicFormsMessages);
  const locale = useAppLocale();
  const id = useId();
  const [links, setLinks] = useState<PublicLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<string>();
  const [confirmed, setConfirmed] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [dailyLimit, setDailyLimit] = useState(25);
  const [expiresAt, setExpiresAt] = useState("");
  const [returnResult, setReturnResult] = useState(false);
  const [qrVisible, setQrVisible] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [shortUrls, setShortUrls] = useState<Record<string, string>>({});
  const [shorteningId, setShorteningId] = useState<string | null>(null);

  const canShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";

  const busy = useRef(false);
  const generation = useRef(0);

  useEffect(() => {
    const current = ++generation.current;
    setLoading(true);
    setError("");
    setLinks([]);
    setNotice("");
    setConfirmed(false);
    setConfirming(null);
    void request(
      `/v1/public-forms?${new URLSearchParams({ domainId, objectName })}`,
    )
      .then(async (response) => {
        if (!response.ok) throw new Error(managementError(response.status));
        const body = z
          .object({ data: z.array(linkSchema) })
          .parse(await response.json());
        if (current === generation.current) setLinks(body.data);
      })
      .catch((cause) => {
        if (current === generation.current)
          setError(
            cause instanceof Error && !(cause instanceof z.ZodError)
              ? cause.message
              : managementError(500),
          );
      })
      .finally(() => {
        if (current === generation.current) setLoading(false);
      });
    return () => {
      generation.current++;
    };
  }, [domainId, objectName, request]);

  function setPresetExpiration(hours: number) {
    if (hours === 0) {
      setExpiresAt("");
      return;
    }
    const date = new Date(Date.now() + hours * 3600 * 1000);
    const localIso = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
    setExpiresAt(localIso);
  }

  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!confirmed || busy.current || loading) return;
    busy.current = true;
    setPending("publish");
    setError("");
    setNotice("");
    const current = generation.current;
    try {
      const response = await request("/v1/public-forms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domainId,
          objectName,
          kind,
          dailyLimit,
          ...(expiresAt
            ? { expiresAt: new Date(expiresAt).toISOString() }
            : {}),
          ...(kind === "quote" ? { returnResult } : {}),
        }),
      });
      if (!response.ok) throw new Error(managementError(response.status));
      const body = z.object({ data: linkSchema }).parse(await response.json());
      if (current === generation.current) {
        setLinks((previous) => [body.data, ...previous]);
        setConfirmed(false);
        setNotice("Enlace publicado. Puedes copiarlo y compartirlo.");
      }
    } catch (cause) {
      if (current === generation.current)
        setError(
          cause instanceof Error && !(cause instanceof z.ZodError)
            ? cause.message
            : managementError(500),
        );
    } finally {
      busy.current = false;
      if (current === generation.current) setPending(undefined);
    }
  }

  async function revoke(link: PublicLink) {
    if (busy.current) return;
    busy.current = true;
    setPending(link.id);
    setError("");
    setNotice("");
    const current = generation.current;
    try {
      const response = await request(
        `/v1/public-forms/${encodeURIComponent(link.id)}`,
        { method: "DELETE" },
      );
      if (!response.ok) throw new Error(managementError(response.status));
      if (current === generation.current) {
        setLinks((previous) =>
          previous.map((item) =>
            item.id === link.id
              ? { ...item, revokedAt: new Date().toISOString() }
              : item,
          ),
        );
        setNotice("Enlace revocado. Ya no admite nuevos envíos.");
      }
    } catch (cause) {
      if (current === generation.current)
        setError(cause instanceof Error ? cause.message : managementError(500));
    } finally {
      busy.current = false;
      if (current === generation.current) setPending(undefined);
    }
  }

  async function remove(link: PublicLink) {
    if (busy.current) return;
    busy.current = true;
    setPending(link.id);
    setError("");
    setNotice("");
    const current = generation.current;
    try {
      const response = await request(
        `/v1/public-forms/${encodeURIComponent(link.id)}?hard=true`,
        { method: "DELETE" },
      );
      if (!response.ok) throw new Error(managementError(response.status));
      if (current === generation.current) {
        setLinks((previous) => previous.filter((item) => item.id !== link.id));
        setConfirming(null);
        setNotice("Enlace eliminado.");
      }
    } catch (cause) {
      if (current === generation.current)
        setError(cause instanceof Error ? cause.message : managementError(500));
    } finally {
      busy.current = false;
      if (current === generation.current) setPending(undefined);
    }
  }

  async function copy(link: PublicLink, forceShort = false) {
    const targetUrl =
      forceShort && shortUrls[link.id]
        ? shortUrls[link.id]
        : shortUrls[link.id] || linkUrl(link);
    try {
      await navigator.clipboard.writeText(targetUrl);
      setCopiedId(link.id);
      setNotice(t("Enlace copiado."));
      setTimeout(() => {
        setCopiedId((current) => (current === link.id ? null : current));
      }, 2000);
    } catch {
      setError(
        "No se pudo copiar. Selecciona el enlace y cópialo manualmente.",
      );
    }
  }

  async function handleShare(link: PublicLink) {
    const urlToShare = shortUrls[link.id] || linkUrl(link);
    if (!urlToShare) return;
    try {
      if (navigator.share) {
        await navigator.share({
          title: screenTitle ? `${screenTitle} · Savia` : "Enlace público",
          text: t("Comparte este formulario para recibir solicitudes sin iniciar sesión. Cada envío requiere una verificación de seguridad."),
          url: urlToShare,
        });
      } else {
        await copy(link);
      }
    } catch (err: unknown) {
      if ((err as Error)?.name !== "AbortError") {
        void copy(link);
      }
    }
  }

  async function shortenUrl(link: PublicLink) {
    const originalUrl = linkUrl(link);
    if (!originalUrl || shorteningId) return;
    setShorteningId(link.id);
    setError("");
    try {
      const response = await fetch(
        `https://is.gd/create.php?format=json&url=${encodeURIComponent(originalUrl)}`,
      );
      if (!response.ok) throw new Error("HTTP error " + response.status);
      const data = (await response.json()) as {
        shorturl?: string;
        errormessage?: string;
      };
      if (data.shorturl) {
        setShortUrls((previous) => ({
          ...previous,
          [link.id]: data.shorturl!,
        }));
        setNotice(t("Enlace copiado."));
      } else {
        throw new Error(data.errormessage || "Failed to shorten");
      }
    } catch {
      setError(
        "No se pudo acortar el enlace. Puedes usar el enlace completo.",
      );
    } finally {
      setShorteningId(null);
    }
  }

  function toggleQr(linkId: string) {
    setQrVisible((previous) => ({ ...previous, [linkId]: !previous[linkId] }));
  }

  return (
    <section
      className="grid min-w-0 gap-6"
      aria-labelledby={`${id}-heading`}
      lang={locale}
    >
      {onBack && (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="gap-2 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            <span>{t("Volver a la configuración")}</span>
          </Button>
        </div>
      )}

      {/* Header section */}
      <header className="savia-surface-card rounded-2xl border p-5 sm:p-6 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2.5">
              <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Globe className="size-5" aria-hidden="true" />
              </span>
              <h2 id={`${id}-heading`} className="text-lg sm:text-xl font-semibold tracking-tight">
                {t("Enlace público")}
              </h2>
            </div>
            <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {t(
                kind === "quote"
                  ? "Comparte este formulario para recibir solicitudes de cotización sin iniciar sesión. Cada envío requiere una verificación de seguridad."
                  : "Comparte este formulario para recibir solicitudes sin iniciar sesión. Cada envío requiere una verificación de seguridad.",
              )}
            </p>
          </div>
          <div className="flex items-center gap-2 self-start sm:self-center">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              <ShieldCheck className="size-3.5" aria-hidden="true" />
              <span>{t("Verificación de seguridad")}</span>
            </span>
          </div>
        </div>
      </header>

      {/* Form creation card */}
      <div className="savia-surface-card rounded-2xl border p-5 sm:p-6 shadow-xs">
        <h3 className="text-base font-semibold mb-4 flex items-center gap-2">
          <Sparkles className="size-4 text-primary" aria-hidden="true" />
          <span>{t("Nuevo enlace público")}</span>
        </h3>

        <form
          onSubmit={publish}
          aria-busy={pending === "publish"}
          className="grid gap-5"
        >
          <div className="grid min-w-0 gap-5 sm:grid-cols-2">
            <div className="grid min-w-0 gap-2">
              <label className="grid min-w-0 gap-1.5 text-sm font-medium">
                <span className="flex items-center gap-1.5">
                  <Calendar className="size-3.5 text-muted-foreground" aria-hidden="true" />
                  <span>{t("Vence el (opcional)")}</span>
                </span>
                <Input
                  type="datetime-local"
                  value={expiresAt}
                  onChange={(event) => setExpiresAt(event.target.value)}
                  disabled={!!pending}
                  className="bg-background font-normal"
                />
              </label>
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                <button
                  type="button"
                  onClick={() => setPresetExpiration(24)}
                  className="rounded-md border border-border/70 px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
                  disabled={!!pending}
                >
                  {t("24 horas")}
                </button>
                <button
                  type="button"
                  onClick={() => setPresetExpiration(24 * 7)}
                  className="rounded-md border border-border/70 px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
                  disabled={!!pending}
                >
                  {t("7 días")}
                </button>
                <button
                  type="button"
                  onClick={() => setPresetExpiration(24 * 30)}
                  className="rounded-md border border-border/70 px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
                  disabled={!!pending}
                >
                  {t("30 días")}
                </button>
                {expiresAt && (
                  <button
                    type="button"
                    onClick={() => setPresetExpiration(0)}
                    className="rounded-md border border-border/70 px-2 py-0.5 text-xs text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
                    disabled={!!pending}
                  >
                    {t("Sin vencimiento")}
                  </button>
                )}
              </div>
            </div>

            <div className="grid min-w-0 gap-2">
              <label className="grid min-w-0 gap-1.5 text-sm font-medium">
                <span className="flex items-center gap-1.5">
                  <Clock className="size-3.5 text-muted-foreground" aria-hidden="true" />
                  <span>{t("Máximo de envíos al día")}</span>
                </span>
                <Input
                  type="number"
                  min={1}
                  max={1000}
                  step={1}
                  required
                  value={dailyLimit}
                  onChange={(event) => setDailyLimit(Number(event.target.value))}
                  disabled={!!pending}
                  className="bg-background font-normal"
                />
              </label>
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {[10, 25, 50, 100].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setDailyLimit(preset)}
                    className={`rounded-md border px-2 py-0.5 text-xs transition-colors cursor-pointer ${
                      dailyLimit === preset
                        ? "border-primary bg-primary/10 text-primary font-medium"
                        : "border-border/70 text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                    disabled={!!pending}
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {kind === "quote" && (
            <label className="flex items-start gap-2.5 text-sm leading-normal cursor-pointer">
              <Checkbox
                className="mt-0.5"
                checked={returnResult}
                onCheckedChange={(checked) =>
                  setChecked(checked, setReturnResult)
                }
                disabled={!!pending}
              />
              <span>
                {t("Mostrar el resultado público de la cotización al finalizar.")}
              </span>
            </label>
          )}

          <div className="rounded-xl border border-border/80 bg-muted/20 p-3.5">
            <label className="flex items-start gap-2.5 text-sm leading-normal cursor-pointer">
              <Checkbox
                className="mt-0.5"
                checked={confirmed}
                onCheckedChange={(checked) => setChecked(checked, setConfirmed)}
                disabled={!!pending}
              />
              <div className="space-y-0.5">
                <span className="font-medium text-foreground">
                  {t(
                    "Publicar la versión actual del formulario. Los cambios posteriores requieren un enlace nuevo.",
                  )}
                </span>
                <p className="text-xs text-muted-foreground">
                  {t(
                    "Snapshot seguro: los cambios posteriores en la pantalla no afectarán este enlace.",
                  )}
                </p>
              </div>
            </label>
          </div>

          <div className="flex items-center gap-3">
            <Button
              type="submit"
              className="gap-2 font-medium"
              disabled={!confirmed || !!pending || loading}
            >
              {pending === "publish" ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  <span>{t("Publicando…")}</span>
                </>
              ) : (
                <>
                  <Globe className="size-4" aria-hidden="true" />
                  <span>{t("Publicar enlace")}</span>
                </>
              )}
            </Button>
          </div>
        </form>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive flex items-start gap-2.5"
        >
          <ShieldAlert className="size-4.5 mt-0.5 shrink-0" aria-hidden="true" />
          <p className="leading-relaxed">
            {Object.hasOwn(publicFormsMessages, error)
              ? t(error as keyof typeof publicFormsMessages)
              : error}
          </p>
        </div>
      )}

      {notice && (
        <div
          role="status"
          className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm text-foreground flex items-start gap-2.5"
        >
          <Check className="size-4.5 text-primary mt-0.5 shrink-0" aria-hidden="true" />
          <p className="leading-relaxed">
            {Object.hasOwn(publicFormsMessages, notice)
              ? t(notice as keyof typeof publicFormsMessages)
              : notice}
          </p>
        </div>
      )}

      {/* Published links list */}
      <div className="savia-surface-card rounded-2xl border p-5 sm:p-6 shadow-xs space-y-4">
        <h3 className="text-base font-semibold flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Link2 className="size-4 text-primary" aria-hidden="true" />
            <span>{t("Enlaces publicados")}</span>
          </span>
          {links.length > 0 && (
            <span className="text-xs font-normal text-muted-foreground">
              {links.length}
            </span>
          )}
        </h3>

        {loading ? (
          <div role="status" className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            <span>{t("Cargando enlaces…")}</span>
          </div>
        ) : links.length ? (
          <ul className="m-0 grid min-w-0 list-none gap-4 p-0">
            {links.map((link) => {
              const expired =
                !!link.expiresAt &&
                new Date(link.expiresAt).getTime() <= Date.now();
              const unavailable = !!link.revokedAt || expired;
              const url = linkUrl(link);
              const shortUrl = shortUrls[link.id];
              const showingQr = !!qrVisible[link.id] && !unavailable && !!url;
              const fileBase = `form-${(link.token || link.id).slice(0, 12).replace(/[^A-Za-z0-9_-]+/g, "-")}`;
              const isCopied = copiedId === link.id;

              return (
                <li
                  key={link.id}
                  className="rounded-xl border border-border/80 bg-background/50 p-4 sm:p-5 transition-all space-y-3.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2.5">
                    <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm">
                      {link.revokedAt ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/60 px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                          <Ban className="size-3" aria-hidden="true" />
                          <span>{t("Revocado")}</span>
                        </span>
                      ) : expired ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                          <Clock className="size-3" aria-hidden="true" />
                          <span>{t("Vencido")}</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                          <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" aria-hidden="true" />
                          <span>{t("Activo")}</span>
                        </span>
                      )}

                      <span className="rounded-md bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground">
                        {t("%{count} envíos al día", {
                          count: link.dailyLimit,
                        })}
                      </span>

                      <span className="rounded-md bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground">
                        {link.expiresAt
                          ? t("Vence: %{date}", {
                              date: new Date(link.expiresAt).toLocaleString(
                                intlLocale(locale),
                              ),
                            })
                          : t("Sin vencimiento")}
                      </span>
                    </div>
                  </div>

                  {/* URL Box */}
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <Input
                        aria-label={t("Dirección del enlace público")}
                        className="font-mono text-xs sm:text-sm bg-muted/30"
                        value={url}
                        readOnly
                        onFocus={(event) => event.target.select()}
                      />
                    </div>
                    {shortUrl && (
                      <div className="flex items-center gap-2 rounded-lg bg-primary/5 border border-primary/20 px-3 py-1.5 text-xs">
                        <span className="font-semibold text-primary shrink-0">
                          {t("Enlace corto")}:
                        </span>
                        <span className="font-mono truncate select-all">{shortUrl}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-xs ml-auto shrink-0"
                          onClick={() => void copy(link, true)}
                        >
                          {t("Copiar")}
                        </Button>
                      </div>
                    )}
                  </div>

                  {/* Action Buttons Toolbar */}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {/* Web Share Button */}
                    {canShare && (
                      <Button
                        type="button"
                        variant="default"
                        size="sm"
                        onClick={() => void handleShare(link)}
                        disabled={unavailable}
                        className="gap-1.5 font-medium"
                      >
                        <Share2 className="size-3.5" aria-hidden="true" />
                        <span>{t("Compartir")}</span>
                      </Button>
                    )}

                    {/* Copy Link Button */}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void copy(link)}
                      disabled={unavailable}
                      className="gap-1.5"
                    >
                      {isCopied ? (
                        <Check className="size-3.5 text-emerald-500" aria-hidden="true" />
                      ) : (
                        <Copy className="size-3.5" aria-hidden="true" />
                      )}
                      <span>{isCopied ? t("¡Copiado!") : t("Copiar enlace")}</span>
                    </Button>

                    {/* Shorten URL Button */}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void shortenUrl(link)}
                      disabled={unavailable || shorteningId === link.id || !!shortUrl}
                      className="gap-1.5"
                    >
                      {shorteningId === link.id ? (
                        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <Link2 className="size-3.5" aria-hidden="true" />
                      )}
                      <span>
                        {shorteningId === link.id
                          ? t("Acortando…")
                          : shortUrl
                            ? t("Enlace corto")
                            : t("Acortar URL")}
                      </span>
                    </Button>

                    {/* Open link in new tab */}
                    {url && !unavailable && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        asChild
                        className="gap-1.5"
                      >
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={t("Abrir enlace")}
                        >
                          <ExternalLink className="size-3.5" aria-hidden="true" />
                          <span>{t("Abrir enlace")}</span>
                        </a>
                      </Button>
                    )}

                    {/* Show / Hide QR Button */}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => toggleQr(link.id)}
                      disabled={unavailable || !url}
                      aria-expanded={showingQr}
                      className="gap-1.5"
                    >
                      <QrCode className="size-3.5" aria-hidden="true" />
                      <span>{showingQr ? t("Ocultar QR") : t("Mostrar QR")}</span>
                    </Button>

                    {/* Revoke Link Button */}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => void revoke(link)}
                      disabled={unavailable || !!pending}
                      className="gap-1.5 text-muted-foreground hover:text-destructive"
                    >
                      <Ban className="size-3.5" aria-hidden="true" />
                      <span>
                        {pending === link.id ? t("Revocando…") : t("Revocar enlace")}
                      </span>
                    </Button>

                    {/* Delete Link Trigger */}
                    {unavailable && confirming !== link.id && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirming(link.id)}
                        disabled={!!pending}
                        className="gap-1.5 text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="size-3.5" aria-hidden="true" />
                        <span>{t("Eliminar enlace")}</span>
                      </Button>
                    )}
                  </div>

                  {/* Delete Confirmation Box */}
                  {unavailable && confirming === link.id && (
                    <div
                      className="grid gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm"
                      role="group"
                    >
                      <p className="break-words font-medium text-destructive">
                        {t("¿Eliminar este enlace y su historial de envíos?")}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          onClick={() => void remove(link)}
                          disabled={!!pending}
                          className="gap-1.5"
                        >
                          <Trash2 className="size-3.5" aria-hidden="true" />
                          <span>
                            {pending === link.id
                              ? t("Eliminando…")
                              : t("Eliminar enlace")}
                          </span>
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setConfirming(null)}
                          disabled={!!pending}
                        >
                          {t("Cancelar")}
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* QR Code Container */}
                  {showingQr && (
                    <div className="pt-2">
                      <PublicLinkQr url={url} fileBase={fileBase} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="rounded-xl border border-dashed border-border/80 p-8 text-center space-y-2">
            <div className="flex justify-center">
              <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Link2 className="size-5" aria-hidden="true" />
              </span>
            </div>
            <p className="text-sm font-medium text-foreground">
              {t("Aún no hay enlaces publicados para este formulario.")}
            </p>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">
              {t(
                "Configura la vigencia y el límite de envíos arriba y haz clic en Publicar enlace para compartirlo.",
              )}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
