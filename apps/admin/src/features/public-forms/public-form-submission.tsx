import { useAppLocale, useMessages, intlLocale } from "@/i18n/core";
import { publicFormsMessages } from "@/i18n/locales/public-forms";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { mountAltcha } from "./altcha-widget";

export type PublicSubmissionDefinition = {
  id: string;
  captchaProvider: "turnstile" | "altcha" | "disabled";
  siteKey?: string;
};

/** Token sent when the API runs with local CAPTCHA bypass (never in preview/production). */
export const LOCAL_CAPTCHA_TOKEN = "local-bypass";

export type PublicSubmissionValues = Record<string, string | number | boolean>;

export type PublicSubmissionController = {
  formRef: React.RefObject<HTMLFormElement | null>;
  captchaElementRef: React.RefObject<HTMLDivElement | null>;
  captcha: string;
  captchaError: string;
  error: string;
  pending: boolean;
  uncertain: boolean;
  duplicate: boolean;
  receipt?: { reference: string; result?: unknown };
  submit(values: PublicSubmissionValues): Promise<void>;
  startNew(): void;
};

export type TurnstileApi = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let captchaScript: Promise<TurnstileApi> | undefined;

export function loadCaptcha(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (captchaScript) return captchaScript;
  captchaScript = new Promise<TurnstileApi>((resolve, reject) => {
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

export function publicError(status: number) {
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

/** Shared anonymous submission lifecycle: CAPTCHA, idempotency, retry, receipt. */
export function usePublicFormSubmission({
  definition,
  endpoint,
}: {
  definition: PublicSubmissionDefinition;
  endpoint: string;
}): PublicSubmissionController {
  const locale = useAppLocale();
  const captchaElement = useRef<HTMLDivElement>(null);
  const widget = useRef<{ api: TurnstileApi; id: string } | null>(null);
  const altchaWidget = useRef<Awaited<ReturnType<typeof mountAltcha>> | null>(
    null,
  );
  const retryProof = useRef(false);
  const form = useRef<HTMLFormElement | null>(null);
  const busy = useRef(false);
  const alive = useRef(true);
  const submission = useRef<{
    id: string;
    values: PublicSubmissionValues;
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
    if (!retryProof.current) setCaptcha("");
    let active = true;
    if (definition.captchaProvider === "disabled") {
      // Local development bypass: the API skips verification, so no widget
      // is mounted and the submit action is available immediately.
      if (active) setCaptcha(LOCAL_CAPTCHA_TOKEN);
      return () => {
        active = false;
      };
    }
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
          locale,
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
          language: locale,
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
    locale,
    definition.id,
    definition.siteKey,
    definition.captchaProvider,
    endpoint,
    receipt,
    duplicate,
  ]);

  async function submit(values: PublicSubmissionValues) {
    if (busy.current || !captcha || receipt || duplicate) return;
    if (!submission.current) {
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
        if (definition.captchaProvider === "disabled")
          setCaptcha(LOCAL_CAPTCHA_TOKEN);
        else if (retryProof.current) setCaptcha(captcha);
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

  return {
    formRef: form,
    captchaElementRef: captchaElement,
    captcha,
    captchaError,
    error,
    pending,
    uncertain,
    duplicate,
    receipt,
    submit,
    startNew,
  };
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

export function SafeResult({ result }: { result: unknown }) {
  const t = useMessages(publicFormsMessages);
  const locale = useAppLocale();
  const projection = quoteProjection.safeParse(result);
  if (projection.success) {
    const { quotes, unavailable } = projection.data;
    const money = new Intl.NumberFormat(intlLocale(locale), {
      style: "currency",
      currency: "COP",
      maximumFractionDigits: 2,
    });
    return (
      <section
        className="public-quote-results"
        aria-label={t("Resultados de cotización")}
      >
        <h3>{t("Resultados de cotización")}</h3>
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
                    ? t("Valor por confirmar")
                    : money.format(quote.premiumTotal)}
                  {quote.premiumTotal !== null && <span> COP</span>}
                </p>
                {quote.coverages.length > 0 && (
                  <ul aria-label={t("Coberturas")}>
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
            {t(
              "No hay cotizaciones disponibles en este resultado. Contacta a quien compartió el formulario.",
            )}
          </p>
        )}
        {unavailable > 0 && (
          <p className="public-form-help">
            {t(
              unavailable === 1
                ? "%{count} resultado no está disponible."
                : "%{count} resultados no están disponibles.",
              { count: unavailable },
            )}
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
