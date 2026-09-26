import { useAppLocale } from "@/i18n/core";
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
  /** Current submission identity for progress polling; null before submit. */
  submissionId: string | null;
  completeFromStatus(id: string, value: unknown): void;
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
  if (status === 502)
    return "No se pudo completar la cotización. Intenta más tarde o contacta a quien compartió el enlace.";
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
  const activePost = useRef<AbortController | null>(null);
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
  const [submissionId, setSubmissionId] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<{
    reference: string;
    result?: unknown;
  }>();

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      activePost.current?.abort();
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

  function completeFromStatus(id: string, value: unknown) {
    if (!alive.current || submission.current?.id !== id) return;
    const parsed = z
      .object({
        ok: z.literal(true),
        reference: z.string(),
        result: z.unknown().optional(),
      })
      .safeParse(value);
    if (!parsed.success) return;
    setReceipt(parsed.data);
    setPending(false);
    setUncertain(false);
    setError("");
    busy.current = false;
    activePost.current?.abort();
  }

  async function submit(values: PublicSubmissionValues) {
    if (busy.current || !captcha || receipt || duplicate) return;
    if (!submission.current) {
      submission.current = { id: crypto.randomUUID(), values };
    }
    setSubmissionId(submission.current.id);
    busy.current = true;
    setPending(true);
    setError("");
    const id = submission.current.id;
    const abort = new AbortController();
    activePost.current = abort;
    const timeout = window.setTimeout(() => abort.abort(), 180_000);
    let keepProof = false;
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        signal: abort.signal,
        credentials: "omit",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submissionId: submission.current.id,
          token: captcha,
          values: submission.current.values,
        }),
      });
      if (!alive.current || submission.current?.id !== id) return;
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
      if (alive.current && submission.current?.id === id) setReceipt(result);
    } catch {
      if (!busy.current || submission.current?.id !== id) return;
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
      window.clearTimeout(timeout);
      if (activePost.current === abort) activePost.current = null;
      if (submission.current?.id !== id) return;
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
    setSubmissionId(null);
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
    submissionId,
    completeFromStatus,
    submit,
    startNew,
  };
}

export const quoteProjection = z.object({
  quotes: z
    .array(
      z.object({
        flowId: z.string().optional(),
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
