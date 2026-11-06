import { useMessages, useAppLocale } from "@/i18n/core";
import { publicFormsMessages } from "@/i18n/locales/public-forms";
import { useEffect, useState, type FormEvent } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import "./public-forms.css";
import { publicError, usePublicFormSubmission } from "./public-form-submission";
import { PublicQuoteForm } from "./public-quote-wizard";

const publicQuotePresentation = z
  .object({
    renderer: z.literal("insurance-quote-wizard"),
    entry: z.enum(["wizard", "direct"]),
    products: z
      .array(z.object({ flowId: z.string(), label: z.string() }).strict())
      .min(1)
      .max(20),
  })
  .strict();

const publicFormLogo = z
  .string()
  .max(720_000)
  .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/)
  .optional();

function isSafePublicLogo(value: string | undefined): value is string {
  return (
    typeof value === "string" &&
    value.length <= 720_000 &&
    /^data:image\/(png|jpeg|webp);base64,/.test(value)
  );
}

/** Optional per-link logo shown above the public form heading. */
export function PublicFormLogo({ src, alt }: { src: string; alt: string }) {
  if (!isSafePublicLogo(src)) return null;
  return (
    <img
      src={src}
      alt={alt}
      className="public-form-logo"
      loading="lazy"
      decoding="async"
    />
  );
}

const publicDefinition = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    description: z.string().optional(),
    kind: z.enum(["record", "quote"]),
    logoImage: publicFormLogo,
    captchaProvider: z
      .enum(["turnstile", "altcha", "disabled"])
      .default("turnstile"),
    siteKey: z.string().min(1).optional(),
    presentation: publicQuotePresentation.optional(),
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
    (value) =>
      value.captchaProvider === "altcha" ||
      value.captchaProvider === "disabled" ||
      Boolean(value.siteKey),
  );
export type PublicFormDefinition = z.infer<typeof publicDefinition>;
type Definition = PublicFormDefinition;

/** Standalone entry: intentionally imports no admin services, session or local data modules. */
export function PublicFormPage({ token }: { token: string }) {
  const t = useMessages(publicFormsMessages);
  const locale = useAppLocale();
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
    <main className="public-form-page" lang={locale}>
      <div className="public-form-shell">
        {!isSafePublicLogo(definition?.logoImage) && (
          <p className="public-form-brand">Savia</p>
        )}
        {loading ? (
          <p role="status">{t("Cargando formulario…")}</p>
        ) : error ? (
          <div role="alert" className="public-form-notice">
            <h1>{t("Formulario no disponible")}</h1>
            <p>
              {Object.hasOwn(publicFormsMessages, error)
                ? t(error as keyof typeof publicFormsMessages)
                : error}
            </p>
          </div>
        ) : definition ? (
          definition.kind === "quote" &&
          definition.presentation?.renderer === "insurance-quote-wizard" ? (
            <PublicQuoteForm
              key={token}
              definition={definition}
              endpoint={endpoint}
            />
          ) : (
            <SubmissionForm
              key={token}
              definition={definition}
              endpoint={endpoint}
            />
          )
        ) : null}
        <footer className="public-form-footer">
          {t("Formulario compartido mediante Savia.")}
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
  const t = useMessages(publicFormsMessages);
  const controller = usePublicFormSubmission({ definition, endpoint });
  const {
    formRef,
    captchaElementRef,
    captcha,
    captchaError,
    error,
    pending,
    uncertain,
    duplicate,
    receipt,
  } = controller;
  const [parseError, setParseError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!formRef.current?.reportValidity()) return;
    if (!captcha || receipt || duplicate) return;
    const values: Record<string, string | number | boolean> = {};
    const data = new FormData(formRef.current);
    for (const field of definition.fields) {
      const value = data.get(field.name);
      if (field.type === "boolean")
        values[field.name] = value === (field.required ? "true" : "on");
      else if (typeof value === "string" && value !== "") {
        if (field.type === "number") {
          const number = Number(value);
          if (!Number.isFinite(number)) {
            setParseError(
              t("Revisa el campo %{field}.", { field: field.label }),
            );
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
    setParseError("");
    await controller.submit(values);
  }

  function startNew() {
    setParseError("");
    controller.startNew();
  }

  const visibleError = parseError || error;

  return (
    <>
      <header className="public-form-heading">
        {isSafePublicLogo(definition.logoImage) && (
          <PublicFormLogo src={definition.logoImage} alt={definition.title} />
        )}
        <h1>{definition.title}</h1>
        {definition.description && <p>{definition.description}</p>}
      </header>
      {receipt ? (
        <section
          aria-labelledby="public-form-success"
          className="public-form-notice"
          role="status"
        >
          <h2 id="public-form-success">{t("Solicitud recibida")}</h2>
          <p>
            {t(
              "Conserva esta referencia para consultar con quien compartió el formulario.",
            )}
          </p>
          <p className="public-form-reference">{receipt.reference}</p>
          {typeof receipt.result === "string" ||
          typeof receipt.result === "number" ? (
            <p>{String(receipt.result)}</p>
          ) : null}
          <Button type="button" variant="outline" onClick={startNew}>
            {t("Iniciar otro envío")}
          </Button>
        </section>
      ) : duplicate ? (
        <section className="public-form-notice" role="status">
          <h2>{t("Envío registrado")}</h2>
          <p>
            {t(
              "Este envío ya fue recibido o está en proceso. No lo vuelvas a enviar.",
            )}
          </p>
          <p>
            {t(
              "Si necesitas confirmar el resultado, contacta a quien compartió el enlace.",
            )}
          </p>
          <Button type="button" variant="outline" onClick={startNew}>
            {t("Iniciar otro envío")}
          </Button>
        </section>
      ) : (
        <form
          ref={formRef}
          onSubmit={submit}
          className="public-form-fields"
          aria-busy={pending}
        >
          <p className="public-form-help">
            {t("Los campos marcados con * son obligatorios.")}
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
                    <option value="">{t("Selecciona una opción")}</option>
                    <option value="true">{t("Sí")}</option>
                    <option value="false">{t("No")}</option>
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
                    <option value="">{t("Selecciona una opción")}</option>
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
          <div
            ref={captchaElementRef}
            aria-label={t("Verificación de seguridad")}
          />
          {captchaError && (
            <p role="alert" className="public-form-error">
              {Object.hasOwn(publicFormsMessages, captchaError)
                ? t(captchaError as keyof typeof publicFormsMessages)
                : captchaError}
            </p>
          )}
          {visibleError && (
            <p role="alert" className="public-form-error">
              {Object.hasOwn(publicFormsMessages, visibleError)
                ? t(visibleError as keyof typeof publicFormsMessages)
                : visibleError}
            </p>
          )}
          <Button type="submit" disabled={!captcha || pending}>
            {pending
              ? t("Enviando…")
              : uncertain
                ? t("Reintentar el mismo envío")
                : t("Enviar solicitud")}
          </Button>
          {!captcha && !captchaError && (
            <p className="public-form-help">
              {t("Completa la verificación de seguridad para enviar.")}
            </p>
          )}
        </form>
      )}
    </>
  );
}
