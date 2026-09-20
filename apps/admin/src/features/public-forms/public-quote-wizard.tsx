import { useMessages } from "@/i18n/core";
import { publicFormsMessages } from "@/i18n/locales/public-forms";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  SafeResult,
  usePublicFormSubmission,
  type PublicSubmissionValues,
} from "./public-form-submission";
import type { PublicFormDefinition } from "./public-form-page";
import "./public-quote-wizard.css";

export type PublicQuoteFormProps = {
  definition: PublicFormDefinition;
  endpoint: string;
};

type QuoteField = PublicFormDefinition["fields"][number];

const APPLICANT_STEP_NAMES = new Set([
  "applicant_documentType",
  "applicant_documentNumber",
  "applicant_firstName",
  "applicant_surname",
  "applicant_secondSurname",
  "applicant_gender",
  "applicant_birthDate",
]);

const CONTACT_STEP_NAMES = new Set([
  "applicant_city",
  "applicant_address",
  "applicant_phone",
  "applicant_email",
]);

function stepsFor(
  fields: QuoteField[],
  titles: { vehicle: string; applicant: string; contact: string },
) {
  return [
    {
      id: "vehicle",
      title: titles.vehicle,
      fields: fields.filter((f) => f.name.startsWith("vehicle_")),
    },
    {
      id: "applicant",
      title: titles.applicant,
      fields: fields.filter((f) => APPLICANT_STEP_NAMES.has(f.name)),
    },
    {
      id: "contact",
      title: titles.contact,
      fields: fields.filter((f) => CONTACT_STEP_NAMES.has(f.name)),
    },
  ];
}

/** Public-only quote wizard: no PluginApi, no private collections, no history. */
export function PublicQuoteForm({ definition, endpoint }: PublicQuoteFormProps) {
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

  const products =
    definition.presentation?.renderer === "insurance-quote-wizard"
      ? definition.presentation.products
      : [];
  const heading =
    definition.presentation?.entry === "direct"
      ? t("Cotizador de seguros")
      : t("Cotizador por pasos");
  const eyebrow = t("SEGUROS · AUTOS LIVIANOS");

  const steps = stepsFor(definition.fields, {
    vehicle: t("Vehículo"),
    applicant: t("Solicitante y conductor"),
    contact: t("Contacto y cotización"),
  });
  const [step, setStep] = useState(0);
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [parseError, setParseError] = useState("");

  function update(name: string, value: string | boolean) {
    setValues((prev) => ({ ...prev, [name]: value }));
  }

  function goNext() {
    if (!formRef.current?.reportValidity()) return;
    setParseError("");
    setStep((s) => Math.min(s + 1, steps.length - 1));
  }

  function goPrev() {
    setParseError("");
    setStep((s) => Math.max(s - 1, 0));
  }

  function handleStartNew() {
    setStep(0);
    setValues({});
    setParseError("");
    controller.startNew();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!formRef.current?.reportValidity()) return;
    const submitValues: PublicSubmissionValues = {};
    for (const field of definition.fields) {
      const raw = values[field.name];
      if (field.type === "boolean") {
        if (field.required) {
          if (raw === "true") submitValues[field.name] = true;
          else if (raw === "false") submitValues[field.name] = false;
          // Required empty is blocked by reportValidity; omit otherwise.
        } else {
          submitValues[field.name] = Boolean(raw);
        }
      } else if (raw === undefined || raw === "") {
        continue;
      } else if (field.type === "number") {
        const n = Number(raw);
        if (!Number.isFinite(n)) {
          setParseError(
            t("Revisa el campo %{field}.", { field: field.label }),
          );
          return;
        }
        submitValues[field.name] = n;
      } else {
        if (
          field.type === "select" &&
          field.options &&
          !field.options.some((o) => o.value === String(raw))
        ) {
          setParseError(
            t("Revisa el campo %{field}.", { field: field.label }),
          );
          return;
        }
        submitValues[field.name] = String(raw);
      }
    }
    if (
      typeof submitValues["vehicle_plate"] === "string" &&
      submitValues["vehicle_plate"]
    ) {
      submitValues["vehicle_plate"] = String(
        submitValues["vehicle_plate"],
      ).toUpperCase();
    }
    setParseError("");
    await controller.submit(submitValues);
  }

  const visibleError = parseError || error;
  const current = steps[step] ?? steps[0];

  if (receipt) {
    return (
      <section
        aria-labelledby="public-quote-success"
        className="public-quote-notice"
        role="status"
      >
        <p className="public-quote-eyebrow">{eyebrow}</p>
        <h1 id="public-quote-success">{t("Solicitud recibida")}</h1>
        <p>{t("Conserva esta referencia para consultar con quien compartió el formulario.")}</p>
        <p className="public-form-reference">{receipt.reference}</p>
        <SafeResult result={receipt.result} />
        <Button type="button" variant="outline" onClick={handleStartNew}>
          {t("Iniciar otro envío")}
        </Button>
      </section>
    );
  }

  if (duplicate) {
    return (
      <section className="public-quote-notice" role="status">
        <p className="public-quote-eyebrow">{eyebrow}</p>
        <h2>{t("Envío registrado")}</h2>
        <p>{t("Este envío ya fue recibido o está en proceso. No lo vuelvas a enviar.")}</p>
        <p>{t("Si necesitas confirmar el resultado, contacta a quien compartió el enlace.")}</p>
        <Button type="button" variant="outline" onClick={handleStartNew}>
          {t("Iniciar otro envío")}
        </Button>
      </section>
    );
  }

  return (
    <section className="public-quote" aria-label={heading}>
      <div className="public-quote-shell">
        <p className="public-quote-eyebrow">{eyebrow}</p>
        <h1 className="public-quote-title">{heading}</h1>
        <p className="public-quote-products">
          {products.length === 1
            ? t("%{count} producto", { count: products.length })
            : t("%{count} productos", { count: products.length })}
        </p>
        <ol className="public-quote-steps">
          {steps.map((s, index) => (
            <li
              key={s.id}
              aria-current={index === step ? "step" : undefined}
              data-active={index === step}
              data-done={index < step}
            >
              <span className="public-quote-step-index">{index + 1}</span>
              <span>{s.title}</span>
            </li>
          ))}
        </ol>

        <form
          ref={formRef}
          onSubmit={handleSubmit}
          className="public-quote-form"
          aria-busy={pending}
        >
          <p className="public-form-help">
            {t("Los campos marcados con * son obligatorios.")}
          </p>
          <fieldset disabled={pending || uncertain}>
            <div className="public-quote-grid">
              {current.fields.map((field) => (
                <div className="public-form-field" key={field.name}>
                  <label htmlFor={`quote-${field.name}`}>
                    {field.label}
                    {field.required ? " *" : ""}
                  </label>
                  {field.type === "boolean" && field.required ? (
                    <select
                      id={`quote-${field.name}`}
                      name={field.name}
                      required
                      value={String(values[field.name] ?? "")}
                      onChange={(e) => update(field.name, e.target.value)}
                    >
                      <option value="">{t("Selecciona una opción")}</option>
                      <option value="true">{t("Sí")}</option>
                      <option value="false">{t("No")}</option>
                    </select>
                  ) : field.type === "boolean" ? (
                    <input
                      id={`quote-${field.name}`}
                      name={field.name}
                      type="checkbox"
                      checked={Boolean(values[field.name])}
                      onChange={(e) => update(field.name, e.target.checked)}
                    />
                  ) : field.type === "select" ? (
                    <select
                      id={`quote-${field.name}`}
                      name={field.name}
                      required={field.required}
                      value={String(values[field.name] ?? "")}
                      onChange={(e) => update(field.name, e.target.value)}
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
                      id={`quote-${field.name}`}
                      name={field.name}
                      type={field.type}
                      required={field.required}
                      step={field.type === "number" ? "any" : undefined}
                      autoComplete="off"
                      value={String(values[field.name] ?? "")}
                      onChange={(e) => update(field.name, e.target.value)}
                    />
                  )}
                </div>
              ))}
            </div>
          </fieldset>

          <div
            ref={captchaElementRef}
            aria-label={t("Verificación de seguridad")}
            hidden={step !== steps.length - 1}
          />
          {step === steps.length - 1 && captchaError && (
            <p role="alert" className="public-form-error">
              {Object.hasOwn(publicFormsMessages, captchaError)
                ? t(captchaError as keyof typeof publicFormsMessages)
                : captchaError}
            </p>
          )}
          {step === steps.length - 1 && visibleError && (
            <p role="alert" className="public-form-error">
              {Object.hasOwn(publicFormsMessages, visibleError)
                ? t(visibleError as keyof typeof publicFormsMessages)
                : visibleError}
            </p>
          )}

          <div className="public-quote-actions">
            {step > 0 && (
              <Button type="button" variant="outline" onClick={goPrev}>
                {t("Anterior")}
              </Button>
            )}
            {step < steps.length - 1 && (
              <Button type="button" onClick={goNext}>
                {t("Siguiente paso")}
              </Button>
            )}
            {step === steps.length - 1 && (
              <Button type="submit" disabled={!captcha || pending}>
                {pending
                  ? t("Enviando…")
                  : uncertain
                    ? t("Reintentar el mismo envío")
                    : t("Enviar solicitud")}
              </Button>
            )}
          </div>
          {step === steps.length - 1 && !captcha && !captchaError && (
            <p className="public-form-help">
              {t("Completa la verificación de seguridad para enviar.")}
            </p>
          )}
        </form>
      </div>
    </section>
  );
}
