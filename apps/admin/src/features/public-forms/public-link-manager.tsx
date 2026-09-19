import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
/** Protected controls; the caller supplies the existing authenticated transport. */
export function PublicLinkManager({
  domainId,
  objectName,
  kind,
  request,
}: Props) {
  const id = useId();
  const [links, setLinks] = useState<PublicLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<string>();
  const [confirmed, setConfirmed] = useState(false);
  const [dailyLimit, setDailyLimit] = useState(25);
  const [expiresAt, setExpiresAt] = useState("");
  const [returnResult, setReturnResult] = useState(false);
  const busy = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    setLoading(true);
    setError("");
    setLinks([]);
    setNotice("");
    setConfirmed(false);
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
  return (
    <section
      className="public-link-manager"
      aria-labelledby={`${id}-heading`}
      lang="es"
    >
      <header>
        <h2 id={`${id}-heading`}>Enlace público</h2>
        <p className="public-form-help">
          Comparte este formulario para recibir{" "}
          {kind === "quote" ? "solicitudes de cotización" : "solicitudes"} sin
          iniciar sesión. Cada envío requiere una verificación de seguridad.
        </p>
      </header>
      <form onSubmit={publish} aria-busy={pending === "publish"}>
        <div className="public-link-fields">
          <div className="public-form-field">
            <label htmlFor={`${id}-expires`}>Vence el (opcional)</label>
            <Input
              id={`${id}-expires`}
              type="datetime-local"
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
              disabled={!!pending}
            />
          </div>
          <div className="public-form-field">
            <label htmlFor={`${id}-limit`}>Máximo de envíos al día</label>
            <Input
              id={`${id}-limit`}
              type="number"
              min={1}
              max={1000}
              step={1}
              required
              value={dailyLimit}
              onChange={(event) => setDailyLimit(Number(event.target.value))}
              disabled={!!pending}
            />
          </div>
        </div>
        {kind === "quote" && (
          <label className="public-link-confirm">
            <input
              type="checkbox"
              checked={returnResult}
              onChange={(event) => setReturnResult(event.target.checked)}
              disabled={!!pending}
            />
            Mostrar el resultado público de la cotización al finalizar.
          </label>
        )}
        <label className="public-link-confirm">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            disabled={!!pending}
          />
          Publicar la versión actual del formulario. Los cambios posteriores
          requieren un enlace nuevo.
        </label>
        <Button type="submit" disabled={!confirmed || !!pending || loading}>
          {pending === "publish" ? "Publicando…" : "Publicar enlace"}
        </Button>
      </form>
      {error && (
        <p role="alert" className="public-form-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {loading ? (
        <p role="status">Cargando enlaces…</p>
      ) : links.length ? (
        <ul className="public-link-list">
          {links.map((link) => {
            const expired =
              !!link.expiresAt &&
              new Date(link.expiresAt).getTime() <= Date.now();
            const unavailable = !!link.revokedAt || expired;
            return (
              <li key={link.id}>
                <div className="public-link-details">
                  <strong>
                    {link.revokedAt
                      ? "Revocado"
                      : expired
                        ? "Vencido"
                        : "Activo"}
                  </strong>
                  <span>{link.dailyLimit} envíos al día</span>
                  <span>
                    {link.expiresAt
                      ? `Vence: ${new Date(link.expiresAt).toLocaleString("es")}`
                      : "Sin vencimiento"}
                  </span>
                </div>
                <Input
                  aria-label="Dirección del enlace público"
                  value={linkUrl(link)}
                  readOnly
                  onFocus={(event) => event.target.select()}
                />
                <div className="public-link-actions">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void copy(link)}
                    disabled={unavailable}
                  >
                    Copiar enlace
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => void revoke(link)}
                    disabled={unavailable || !!pending}
                  >
                    {pending === link.id ? "Revocando…" : "Revocar enlace"}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="public-form-help">
          Aún no hay enlaces publicados para este formulario.
        </p>
      )}
    </section>
  );
}
