import { useMessages } from "@/i18n/core";
import { publicFormsMessages } from "@/i18n/locales/public-forms";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
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

type CityMatch = { code: string; city: string; department: string };

const CITY_FIELDS = new Set(["vehicle_circulationCity", "applicant_city"]);

const CURRENCY_FIELDS = new Set([
  "vehicle_accessoriesValue",
  "vehicle_declaredValue",
]);

function formatCurrency(raw: string): string {
  const digits = raw.replace(/[^0-9]/g, "").slice(0, 12);
  if (!digits) return "";
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/**
 * DANE city autocomplete over public reference data. Selecting a suggestion
 * stores the city code; free text is still accepted and validated server-side.
 */
function CityAutocomplete({
  field,
  value,
  endpoint,
  onChange,
}: {
  field: QuoteField;
  value: string;
  endpoint: string;
  onChange: (value: string) => void;
}) {
  const t = useMessages(publicFormsMessages);
  const [suggestions, setSuggestions] = useState<CityMatch[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const alive = useRef(true);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      window.clearTimeout(timer.current);
    };
  }, []);
  const listId = `quote-${field.name}-cities`;

  function search(next: string) {
    onChange(next);
    window.clearTimeout(timer.current);
    // A digit-only value is already a city code: keep it verbatim instead of
    // searching it as a name fragment.
    if (next.trim().length < 2 || /^\d+$/.test(next.trim())) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    timer.current = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(
          `${endpoint}/cities?search=${encodeURIComponent(next.trim())}`,
          { credentials: "omit", cache: "no-store" },
        );
        if (!alive.current) return;
        if (response.ok) {
          const data = (await response.json()) as { matches?: unknown };
          const matches = Array.isArray(data.matches)
            ? (data.matches as Record<string, unknown>[])
                .filter(
                  (match) =>
                    typeof match.code === "string" &&
                    typeof match.city === "string" &&
                    match.code &&
                    match.city,
                )
                .slice(0, 20)
                .map((match) => ({
                  code: String(match.code),
                  city: String(match.city),
                  department:
                    typeof match.department === "string"
                      ? String(match.department)
                      : "",
                }))
            : [];
          if (!alive.current) return;
          setSuggestions(matches);
          setOpen(true);
        }
      } catch {
        // City codes stay manual when the reference lookup is unreachable.
      } finally {
        if (alive.current) setLoading(false);
      }
    }, 300);
  }

  return (
    <div className="public-quote-city">
      <Input
        id={`quote-${field.name}`}
        name={field.name}
        type="text"
        required={field.required}
        autoComplete="off"
        value={value}
        onChange={(e) => search(e.target.value)}
        onFocus={() => {
          if (suggestions.length) setOpen(true);
        }}
        onBlur={() => {
          window.setTimeout(() => {
            if (alive.current) setOpen(false);
          }, 150);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        aria-expanded={open}
        aria-controls={listId}
      />
      {loading && (
        <p role="status" className="public-form-help">
          {t("Consultando…")}
        </p>
      )}
      {open && !loading && suggestions.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          aria-label={t("Ciudades sugeridas")}
          className="public-quote-suggestions"
        >
          {suggestions.map((suggestion) => (
            <li key={suggestion.code} role="option" aria-selected="false">
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(suggestion.code);
                  setSuggestions([]);
                  setOpen(false);
                }}
              >
                {suggestion.city} ({suggestion.department})
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && !loading && suggestions.length === 0 && (
        <p role="status" className="public-form-help">
          {t("No se encontraron ciudades.")}
        </p>
      )}
    </div>
  );
}

/** Public-only quote wizard: no PluginApi, no private collections, no history. */
export function PublicQuoteForm({
  definition,
  endpoint,
}: PublicQuoteFormProps) {
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
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupFields, setLookupFields] = useState<string[]>([]);
  const [lookupNotice, setLookupNotice] = useState("");
  const lastLookedUpPlate = useRef("");

  function update(name: string, value: string | boolean) {
    setValues((prev) => ({ ...prev, [name]: value }));
    // A manually edited field is no longer considered autofilled.
    setLookupFields((prev) =>
      prev.includes(name) ? prev.filter((field) => field !== name) : prev,
    );
  }

  function updatePlate(value: string) {
    const upper = value.toUpperCase();
    // Changing the plate invalidates previously autofilled vehicle data,
    // mirroring the embedded quote wizard.
    setValues((prev) => {
      const next: Record<string, string | boolean> = {
        ...prev,
        vehicle_plate: upper,
      };
      for (const name of lookupFields) delete next[name];
      return next;
    });
    setLookupFields([]);
    setLookupNotice("");
  }

  async function lookupPlate() {
    const rawPlate = String(values["vehicle_plate"] ?? "")
      .trim()
      .toUpperCase();
    if (!rawPlate || lookingUp) return;
    setLookingUp(true);
    setLookupNotice("");
    try {
      const response = await fetch(`${endpoint}/vehicle-lookup`, {
        method: "POST",
        credentials: "omit",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plate: rawPlate }),
      });
      if (!response.ok) {
        setLookupNotice(
          response.status === 404
            ? t("No se encontraron datos para esa placa.")
            : t("No se pudo consultar la placa."),
        );
        return;
      }
      const data = (await response.json()) as {
        plate?: unknown;
        fasecoldaCode?: unknown;
        productionYear?: unknown;
        declaredValue?: unknown;
        accessoriesValue?: unknown;
      };
      if (data.plate !== rawPlate) {
        setLookupNotice(t("No se encontraron datos para esa placa."));
        return;
      }
      const filled: Array<[string, unknown]> = [
        ["vehicle_fasecoldaCode", data.fasecoldaCode],
        ["vehicle_productionYear", data.productionYear],
        ["vehicle_declaredValue", data.declaredValue],
        ["vehicle_accessoriesValue", data.accessoriesValue],
      ];
      const names: string[] = [];
      setValues((prev) => {
        const next: Record<string, string | boolean> = {
          ...prev,
          vehicle_plate: rawPlate,
        };
        for (const [name, value] of filled) {
          if (
            value !== undefined &&
            value !== null &&
            String(value).trim() !== ""
          ) {
            next[name] = String(value);
            names.push(name);
          }
        }
        return next;
      });
      setLookupFields(names);
      lastLookedUpPlate.current = rawPlate;
    } catch {
      setLookupNotice(t("No se pudo consultar la placa."));
    } finally {
      setLookingUp(false);
    }
  }

  function autoLookupPlate() {
    const plate = String(values["vehicle_plate"] ?? "").trim();
    if (
      plate &&
      plate.length >= 5 &&
      plate.toUpperCase() !== lastLookedUpPlate.current &&
      !lookingUp
    ) {
      void lookupPlate();
    }
  }

  function lookupPlateOnEnter(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && String(values["vehicle_plate"] ?? "")) {
      event.preventDefault();
      void lookupPlate();
    }
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
    setLookingUp(false);
    setLookupFields([]);
    setLookupNotice("");
    lastLookedUpPlate.current = "";
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
          setParseError(t("Revisa el campo %{field}.", { field: field.label }));
          return;
        }
        submitValues[field.name] = n;
      } else {
        if (
          field.type === "select" &&
          field.options &&
          !field.options.some((o) => o.value === String(raw))
        ) {
          setParseError(t("Revisa el campo %{field}.", { field: field.label }));
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
        <p>
          {t(
            "Conserva esta referencia para consultar con quien compartió el formulario.",
          )}
        </p>
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
          <fieldset disabled={pending || uncertain || lookingUp}>
            <div className="public-quote-grid">
              {current.fields.map((field) => (
                <div className="public-form-field" key={field.name}>
                  <label htmlFor={`quote-${field.name}`}>
                    {field.label}
                    {field.required ? " *" : ""}
                    {lookupFields.includes(field.name) && (
                      <span className="public-quote-synced">
                        {t("✓ Autocompletado")}
                      </span>
                    )}
                    {lookingUp &&
                      [
                        "vehicle_fasecoldaCode",
                        "vehicle_productionYear",
                        "vehicle_declaredValue",
                        "vehicle_accessoriesValue",
                      ].includes(field.name) && (
                        <span className="public-quote-syncing">
                          {t("Consultando…")}
                        </span>
                      )}
                  </label>
                  {field.name === "vehicle_plate" ? (
                    <div className="public-quote-plate">
                      <Input
                        id={`quote-${field.name}`}
                        name={field.name}
                        type="text"
                        required={field.required}
                        autoComplete="off"
                        value={String(values[field.name] ?? "")}
                        onChange={(e) => updatePlate(e.target.value)}
                        onBlur={autoLookupPlate}
                        onKeyDown={lookupPlateOnEnter}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        aria-label={t("Consultar placa")}
                        title={t("Consultar placa")}
                        disabled={
                          lookingUp || !String(values[field.name] ?? "").trim()
                        }
                        onClick={() => void lookupPlate()}
                        className="public-quote-plate-button"
                      >
                        {lookingUp ? (
                          <span
                            aria-hidden="true"
                            className="public-quote-spinner"
                          />
                        ) : (
                          <svg
                            aria-hidden="true"
                            fill="none"
                            height="15"
                            stroke="currentColor"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2.2"
                            viewBox="0 0 24 24"
                            width="15"
                          >
                            <circle cx="11" cy="11" r="8" />
                            <line x1="21" x2="16.65" y1="21" y2="16.65" />
                          </svg>
                        )}
                      </Button>
                    </div>
                  ) : CITY_FIELDS.has(field.name) ? (
                    <CityAutocomplete
                      field={field}
                      value={String(values[field.name] ?? "")}
                      endpoint={endpoint}
                      onChange={(next) => update(field.name, next)}
                    />
                  ) : field.type === "number" &&
                    CURRENCY_FIELDS.has(field.name) ? (
                    <div className="public-quote-currency">
                      <span aria-hidden="true">$</span>
                      <Input
                        id={`quote-${field.name}`}
                        name={field.name}
                        type="text"
                        inputMode="numeric"
                        required={field.required}
                        autoComplete="off"
                        value={formatCurrency(String(values[field.name] ?? ""))}
                        onChange={(e) =>
                          update(
                            field.name,
                            e.target.value.replace(/[^0-9]/g, ""),
                          )
                        }
                      />
                    </div>
                  ) : field.type === "boolean" && field.required ? (
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
          {step === 0 && lookupNotice && (
            <p role="status" className="public-form-help">
              {lookupNotice}
            </p>
          )}

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
