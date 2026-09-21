import { useMessages, useAppLocale, intlLocale } from "@/i18n/core";
import { publicFormsMessages } from "@/i18n/locales/public-forms";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { PublicLinkQr } from "./public-link-qr";
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
  async function copy(link: PublicLink) {
    try {
      await navigator.clipboard.writeText(linkUrl(link));
      setNotice("Enlace copiado.");
    } catch {
      setError(
        "No se pudo copiar. Selecciona el enlace y cópialo manualmente.",
      );
    }
  }
  function toggleQr(linkId: string) {
    setQrVisible((previous) => ({ ...previous, [linkId]: !previous[linkId] }));
  }
  return (
    <section
      className="savia-surface-card mt-4 grid min-w-0 gap-5 p-6"
      aria-labelledby={`${id}-heading`}
      lang={locale}
    >
      <header>
        <h2 id={`${id}-heading`} className="text-base font-semibold">
          {t("Enlace público")}
        </h2>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">
          {t(
            kind === "quote"
              ? "Comparte este formulario para recibir solicitudes de cotización sin iniciar sesión. Cada envío requiere una verificación de seguridad."
              : "Comparte este formulario para recibir solicitudes sin iniciar sesión. Cada envío requiere una verificación de seguridad.",
          )}
        </p>
      </header>
      <form
        onSubmit={publish}
        aria-busy={pending === "publish"}
        className="grid gap-4"
      >
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <label className="grid min-w-0 gap-1.5 text-sm font-medium">
            {t("Vence el (opcional)")}
            <Input
              type="datetime-local"
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
              disabled={!!pending}
            />
          </label>
          <label className="grid min-w-0 gap-1.5 text-sm font-medium">
            {t("Máximo de envíos al día")}
            <Input
              type="number"
              min={1}
              max={1000}
              step={1}
              required
              value={dailyLimit}
              onChange={(event) => setDailyLimit(Number(event.target.value))}
              disabled={!!pending}
            />
          </label>
        </div>
        {kind === "quote" && (
          <label className="flex items-start gap-2 text-sm leading-normal">
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
        <label className="flex items-start gap-2 text-sm leading-normal">
          <Checkbox
            className="mt-0.5"
            checked={confirmed}
            onCheckedChange={(checked) => setChecked(checked, setConfirmed)}
            disabled={!!pending}
          />
          <span>
            {t(
              "Publicar la versión actual del formulario. Los cambios posteriores requieren un enlace nuevo.",
            )}
          </span>
        </label>
        <Button
          type="submit"
          className="w-fit"
          disabled={!confirmed || !!pending || loading}
        >
          {pending === "publish" ? t("Publicando…") : t("Publicar enlace")}
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {Object.hasOwn(publicFormsMessages, error)
            ? t(error as keyof typeof publicFormsMessages)
            : error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-muted-foreground">
          {Object.hasOwn(publicFormsMessages, notice)
            ? t(notice as keyof typeof publicFormsMessages)
            : notice}
        </p>
      )}
      {loading ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t("Cargando enlaces…")}
        </p>
      ) : links.length ? (
        <ul className="m-0 grid min-w-0 list-none p-0">
          {links.map((link) => {
            const expired =
              !!link.expiresAt &&
              new Date(link.expiresAt).getTime() <= Date.now();
            const unavailable = !!link.revokedAt || expired;
            const url = linkUrl(link);
            const showingQr = !!qrVisible[link.id] && !unavailable && !!url;
            const fileBase = `form-${(link.token || link.id).slice(0, 12).replace(/[^A-Za-z0-9_-]+/g, "-")}`;
            return (
              <li
                key={link.id}
                className="grid min-w-0 gap-3 border-t py-4 first:border-t-0 first:pt-0 last:pb-0"
              >
                <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {link.revokedAt
                      ? t("Revocado")
                      : expired
                        ? t("Vencido")
                        : t("Activo")}
                  </span>
                  <span>
                    {t("%{count} envíos al día", { count: link.dailyLimit })}
                  </span>
                  <span>
                    {link.expiresAt
                      ? t("Vence: %{date}", {
                          date: new Date(link.expiresAt).toLocaleString(
                            intlLocale(locale),
                          ),
                        })
                      : t("Sin vencimiento")}
                  </span>
                </div>
                <Input
                  aria-label={t("Dirección del enlace público")}
                  className="min-w-0 text-sm"
                  value={url}
                  readOnly
                  onFocus={(event) => event.target.select()}
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void copy(link)}
                    disabled={unavailable}
                  >
                    {t("Copiar enlace")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => toggleQr(link.id)}
                    disabled={unavailable || !url}
                    aria-expanded={showingQr}
                  >
                    {showingQr ? t("Ocultar QR") : t("Mostrar QR")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => void revoke(link)}
                    disabled={unavailable || !!pending}
                  >
                    {pending === link.id
                      ? t("Revocando…")
                      : t("Revocar enlace")}
                  </Button>
                  {unavailable && confirming !== link.id && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setConfirming(link.id)}
                      disabled={!!pending}
                    >
                      {t("Eliminar enlace")}
                    </Button>
                  )}
                </div>
                {unavailable && confirming === link.id && (
                  <div
                    className="grid gap-3 rounded-lg border border-destructive/60 p-3 text-sm"
                    role="group"
                  >
                    <p className="break-words">
                      {t("¿Eliminar este enlace y su historial de envíos?")}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="destructive"
                        onClick={() => void remove(link)}
                        disabled={!!pending}
                      >
                        {pending === link.id
                          ? t("Eliminando…")
                          : t("Eliminar enlace")}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setConfirming(null)}
                        disabled={!!pending}
                      >
                        {t("Cancelar")}
                      </Button>
                    </div>
                  </div>
                )}
                {showingQr && <PublicLinkQr url={url} fileBase={fileBase} />}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="public-form-help">
          {t("Aún no hay enlaces publicados para este formulario.")}
        </p>
      )}
    </section>
  );
}
