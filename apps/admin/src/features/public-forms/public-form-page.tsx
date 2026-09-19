import { useEffect, useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import "./public-forms.css";
import { mountAltcha } from "./altcha-widget";

const publicDefinition = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    description: z.string().optional(),
    kind: z.enum(["record", "quote"]),
    captchaProvider: z.enum(["turnstile", "altcha"]).default("turnstile"),
    siteKey: z.string().min(1).optional(),
    fields: z
      .array(
        z.object({
          name: z
            .string()
            .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/)
            .refine(
              (name) =>
                !["__proto__", "constructor", "prototype"].includes(name),
            ),
          label: z.string(),
          type: z.enum([
            "text",
            "number",
            "email",
            "date",
            "boolean",
            "select",
          ]),
          required: z.boolean(),
          options: z
            .array(z.object({ value: z.string(), label: z.string() }))
            .optional(),
        }),
      )
      .max(100)
      .refine(
        (fields) =>
          new Set(fields.map((field) => field.name)).size === fields.length,
      ),
  })
  .refine(
    (value) => value.captchaProvider === "altcha" || Boolean(value.siteKey),
  );
type Definition = z.infer<typeof publicDefinition>;
type Turnstile = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}
let captchaScript: Promise<Turnstile> | undefined;
function loadCaptcha(): Promise<Turnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (captchaScript) return captchaScript;
  captchaScript = new Promise<Turnstile>((resolve, reject) => {
    const script = document.createElement("script");
    script.src =
      "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    const timeout = window.setTimeout(() => fail(), 20000);
    const fail = () => {
      window.clearTimeout(timeout);
      script.remove();
      reject(new Error("Captcha unavailable"));
    };
    script.onload = () => {
      window.clearTimeout(timeout);
      if (window.turnstile) resolve(window.turnstile);
      else fail();
    };
    script.onerror = fail;
    document.head.append(script);
  }).catch((error) => {
    captchaScript = undefined;
    throw error;
  });
  return captchaScript;
}
function publicError(status: number) {
  if (status === 503)
    return "Este formulario no está disponible temporalmente. Inténtalo más tarde o contacta a quien compartió el enlace.";
  if (status === 404 || status === 410)
    return "Este enlace ya no está disponible. Pide un enlace nuevo a quien lo compartió.";
  if (status === 429)
    return "Se alcanzó el límite de envíos. Inténtalo más tarde.";
  if (status === 400 || status === 403 || status === 422)
    return "No se pudo validar el envío. Revisa los campos y completa de nuevo la verificación.";
  return "No pudimos confirmar el envío. Puedes reintentar con la misma solicitud después de verificarte de nuevo.";
}

/** Standalone entry: intentionally imports no admin services, session or local data modules. */
export function PublicFormPage({ token }: { token: string }) {
  const [definition, setDefinition] = useState<Definition>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const endpoint = `${(import.meta.env.VITE_SAVIA_API_URL ?? window.location.origin).replace(/\/$/, "")}/api/public/forms/${encodeURIComponent(token)}`;
  useEffect(() => {
    const controller = new AbortController();
    setDefinition(undefined);
    setError("");
    setLoading(true);
    void fetch(endpoint, {
      credentials: "omit",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(publicError(response.status));
        const parsed = publicDefinition.safeParse(await response.json());
        if (!parsed.success)
          throw new Error(
            "El formulario no está disponible. Pide un enlace nuevo a quien lo compartió.",
          );
        if (!controller.signal.aborted) setDefinition(parsed.data);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error && cause.message !== "Failed to fetch"
              ? cause.message
              : "No se pudo cargar el formulario. Revisa tu conexión y recarga la página.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [endpoint]);
  return (
    <main className="public-form-page" lang="es">
      <div className="public-form-shell">
        <p className="public-form-brand">Savia</p>
        {loading ? (
          <p role="status">Cargando formulario…</p>
        ) : error ? (
          <div role="alert" className="public-form-notice">
            <h1>Formulario no disponible</h1>
            <p>{error}</p>
          </div>
        ) : definition ? (
          <SubmissionForm
            key={token}
            definition={definition}
            endpoint={endpoint}
          />
        ) : null}
        <footer className="public-form-footer">
          Formulario compartido mediante Savia.
        </footer>
      </div>
    </main>
  );
}
function SubmissionForm({
  definition,
  endpoint,
}: {
  definition: Definition;
  endpoint: string;
}) {
  const captchaElement = useRef<HTMLDivElement>(null);
  const widget = useRef<{ api: Turnstile; id: string } | null>(null);
  const altchaWidget = useRef<Awaited<ReturnType<typeof mountAltcha>> | null>(
    null,
  );
  const retryProof = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const busy = useRef(false);
  const alive = useRef(true);
  const submission = useRef<{
    id: string;
    values: Record<string, string | number | boolean>;
  } | null>(null);
  const [captcha, setCaptcha] = useState("");
  const [captchaError, setCaptchaError] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [duplicate, setDuplicate] = useState(false);
  const [receipt, setReceipt] = useState<{
    reference: string;
    result?: unknown;
  }>();
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (receipt || duplicate) return;
    let active = true;
    if (definition.captchaProvider === "altcha") {
      if (captchaElement.current)
        void mountAltcha(
          captchaElement.current,
          `${endpoint}/challenge`,
          (payload) => {
            if (active && !retryProof.current) {
              setCaptcha(payload);
              setCaptchaError("");
            }
          },
          (state) => {
            if (!active || retryProof.current) return;
            if (state !== "verified") setCaptcha("");
            if (state === "error")
              setCaptchaError(
                "No se pudo completar la verificación. Revisa tu conexión y vuelve a intentarlo.",
              );
          },
        )
          .then((instance) => {
            if (active) altchaWidget.current = instance;
            else instance.remove();
          })
          .catch(() => {
            if (active)
              setCaptchaError(
                "No se pudo cargar la verificación. Revisa tu conexión y recarga la página.",
              );
          });
      return () => {
        active = false;
        altchaWidget.current?.remove();
        altchaWidget.current = null;
      };
    }
    void loadCaptcha()
      .then((api) => {
        if (!active || !captchaElement.current) return;
        const id = api.render(captchaElement.current, {
          sitekey: definition.siteKey,
          action: "public_submit",
          cData: definition.id,
          language: "es",
          size: "flexible",
          callback: (value: string) => {
            if (active) {
              setCaptcha(value);
              setCaptchaError("");
            }
          },
          "expired-callback": () => {
            if (active) setCaptcha("");
          },
          "error-callback": () => {
            if (active) {
              setCaptcha("");
              setCaptchaError(
                "No se pudo completar la verificación. Revisa tu conexión y vuelve a intentarlo.",
              );
            }
          },
        });
        widget.current = { api, id };
      })
      .catch(() => {
        if (active)
          setCaptchaError(
            "No se pudo cargar la verificación. Revisa tu conexión y recarga la página.",
          );
      });
    return () => {
      active = false;
      if (widget.current) {
        widget.current.api.remove(widget.current.id);
        widget.current = null;
      }
    };
  }, [
    definition.id,
    definition.siteKey,
    definition.captchaProvider,
    endpoint,
    receipt,
    duplicate,
  ]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      busy.current ||
      !captcha ||
      receipt ||
      duplicate ||
      !form.current?.reportValidity()
    )
      return;
    const values: Record<string, string | number | boolean> = {};
    if (!submission.current) {
      const data = new FormData(form.current);
      for (const field of definition.fields) {
        const value = data.get(field.name);
        if (field.type === "boolean")
          values[field.name] = value === (field.required ? "true" : "on");
        else if (typeof value === "string" && value !== "") {
          if (field.type === "number") {
            const number = Number(value);
            if (!Number.isFinite(number)) {
              setError(`Revisa el campo ${field.label}.`);
              return;
            }
            values[field.name] = number;
          } else if (
            field.type !== "select" ||
            field.options?.some((option) => option.value === value)
          )
            values[field.name] = value;
        }
      }
      submission.current = { id: crypto.randomUUID(), values };
    }
    busy.current = true;
    setPending(true);
    setError("");
    let keepProof = false;
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "omit",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submissionId: submission.current.id,
          token: captcha,
          values: submission.current.values,
        }),
      });
      if (!alive.current) return;
      if (response.status === 409) {
        setDuplicate(true);
        return;
      }
      if (!response.ok) {
        if (response.status >= 500) {
          setUncertain(true);
          keepProof = true;
        } else if (!uncertain) submission.current = null;
        setError(publicError(response.status));
        return;
      }
      const result = z
        .object({
          ok: z.literal(true),
          reference: z.string(),
          result: z.unknown().optional(),
        })
        .parse(await response.json());
      if (alive.current) setReceipt(result);
    } catch {
      keepProof = true;
      if (alive.current) {
        setUncertain(true);
        setError(
          definition.captchaProvider === "altcha"
            ? "No pudimos confirmar el envío. Puedes reintentar el mismo envío."
            : "No pudimos confirmar el envío. Puedes reintentar con la misma solicitud después de verificarte de nuevo.",
        );
      }
    } finally {
      busy.current = false;
      if (alive.current) {
        setPending(false);
        retryProof.current =
          definition.captchaProvider === "altcha" && keepProof;
        if (retryProof.current) setCaptcha(captcha);
        else {
          setCaptcha("");
          altchaWidget.current?.reset();
          if (widget.current) widget.current.api.reset(widget.current.id);
        }
      }
    }
  }
  function startNew() {
    retryProof.current = false;
    submission.current = null;
    setReceipt(undefined);
    setDuplicate(false);
    setUncertain(false);
    setError("");
    setCaptcha("");
    form.current?.reset();
  }
  return (
    <>
      <header className="public-form-heading">
        <h1>{definition.title}</h1>
        {definition.description && <p>{definition.description}</p>}
      </header>
      {receipt ? (
        <section
          aria-labelledby="public-form-success"
          className="public-form-notice"
          role="status"
        >
          <h2 id="public-form-success">Solicitud recibida</h2>
          <p>
            Conserva esta referencia para consultar con quien compartió el
            formulario.
          </p>
          <p className="public-form-reference">{receipt.reference}</p>
          <SafeResult result={receipt.result} />
          <Button type="button" variant="outline" onClick={startNew}>
            Iniciar otro envío
          </Button>
        </section>
      ) : duplicate ? (
        <section className="public-form-notice" role="status">
          <h2>Envío registrado</h2>
          <p>
            Este envío ya fue recibido o está en proceso. No lo vuelvas a
            enviar.
          </p>
          <p>
            Si necesitas confirmar el resultado, contacta a quien compartió el
            enlace.
          </p>
          <Button type="button" variant="outline" onClick={startNew}>
            Iniciar otro envío
          </Button>
        </section>
      ) : (
        <form
          ref={form}
          onSubmit={submit}
          className="public-form-fields"
          aria-busy={pending}
        >
          <p className="public-form-help">
            Los campos marcados con * son obligatorios.
          </p>
          <fieldset disabled={pending || uncertain}>
            {definition.fields.map((field) => (
              <div className="public-form-field" key={field.name}>
                <label htmlFor={`public-${field.name}`}>
                  {field.label}
                  {field.required ? " *" : ""}
                </label>
                {field.type === "boolean" && field.required ? (
                  <select
                    id={`public-${field.name}`}
                    name={field.name}
                    required
                    defaultValue=""
                  >
                    <option value="">Selecciona una opción</option>
                    <option value="true">Sí</option>
                    <option value="false">No</option>
                  </select>
                ) : field.type === "boolean" ? (
                  <input
                    id={`public-${field.name}`}
                    name={field.name}
                    type="checkbox"
                    required={field.required}
                  />
                ) : field.type === "select" ? (
                  <select
                    id={`public-${field.name}`}
                    name={field.name}
                    required={field.required}
                    defaultValue=""
                  >
                    <option value="">Selecciona una opción</option>
                    {field.options?.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input
                    id={`public-${field.name}`}
                    name={field.name}
                    type={field.type}
                    required={field.required}
                    step={field.type === "number" ? "any" : undefined}
                    autoComplete="off"
                  />
                )}
              </div>
            ))}
          </fieldset>
          <div ref={captchaElement} aria-label="Verificación de seguridad" />
          {captchaError && (
            <p role="alert" className="public-form-error">
              {captchaError}
            </p>
          )}
          {error && (
            <p role="alert" className="public-form-error">
              {error}
            </p>
          )}
          <Button type="submit" disabled={!captcha || pending}>
            {pending
              ? "Enviando…"
              : uncertain
                ? "Reintentar el mismo envío"
                : "Enviar solicitud"}
          </Button>
          {!captcha && !captchaError && (
            <p className="public-form-help">
              Completa la verificación de seguridad para enviar.
            </p>
          )}
        </form>
      )}
    </>
  );
}
const quoteProjection = z.object({
  quotes: z
    .array(
      z.object({
        insurer: z.string(),
        product: z.string(),
        premiumTotal: z.number().finite().positive().max(1e12).nullable(),
        currency: z.literal("COP"),
        coverages: z.array(z.string()).max(50),
      }),
    )
    .max(20),
  unavailable: z.number().int().nonnegative(),
});
function SafeResult({ result }: { result: unknown }) {
  const projection = quoteProjection.safeParse(result);
  if (projection.success) {
    const { quotes, unavailable } = projection.data;
    const money = new Intl.NumberFormat("es-CO", {
      style: "currency",
      currency: "COP",
      maximumFractionDigits: 2,
    });
    return (
      <section
        className="public-quote-results"
        aria-label="Resultados de cotización"
      >
        <h3>Resultados de cotización</h3>
        {quotes.length ? (
          <ul>
            {quotes.map((quote, index) => (
              <li key={index}>
                <div className="public-quote-heading">
                  <h4>{quote.insurer}</h4>
                  <p>{quote.product}</p>
                </div>
                <p className="public-quote-price">
                  {quote.premiumTotal === null
                    ? "Valor por confirmar"
                    : money.format(quote.premiumTotal)}
                  {quote.premiumTotal !== null && <span> COP</span>}
                </p>
                {quote.coverages.length > 0 && (
                  <ul aria-label="Coberturas">
                    {quote.coverages.map((coverage, coverageIndex) => (
                      <li key={coverageIndex}>{coverage}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p>
            No hay cotizaciones disponibles en este resultado. Contacta a quien
            compartió el formulario.
          </p>
        )}
        {unavailable > 0 && (
          <p className="public-form-help">
            {unavailable}{" "}
            {unavailable === 1
              ? "resultado no está disponible"
              : "resultados no están disponibles"}
            .
          </p>
        )}
      </section>
    );
  }
  if (typeof result === "string" || typeof result === "number")
    return <p>{String(result)}</p>;
  // Unknown result structures stay hidden; only the public quote projection is displayed.
  return null;
}
