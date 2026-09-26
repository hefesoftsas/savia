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
  usePublicFormSubmission,
  type PublicSubmissionValues,
} from "./public-form-submission";
import {
  PublicComparison,
  PublicReceiptResult,
  parseStatusItems,
  type PublicComparisonItem,
} from "./public-comparison";
import type { PublicFormDefinition } from "./public-form-page";
import "./public-quote-wizard.css";

export type PublicQuoteFormProps = {
  definition: PublicFormDefinition;
  endpoint: string;
};

function isSafeQuoteLogo(value: string | undefined): value is string {
  return (
    typeof value === "string" &&
    value.length <= 720_000 &&
    /^data:image\/(png|jpeg|webp);base64,/.test(value)
  );
}

function QuoteLogo({ src, alt }: { src: string | undefined; alt: string }) {
  if (!isSafeQuoteLogo(src)) return null;
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

type FieldErrors = Record<string, string>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Client mirror of the server quote validation so the wizard names the exact
 * failing field instead of showing the generic submission error. The server
 * remains the final validator.
 */
function validateWizardFields(
  fields: QuoteField[],
  values: Record<string, string | boolean>,
  t: (key: "Revisa el campo %{field}.", params: { field: string }) => string,
  now: Date = new Date(),
): FieldErrors {
  const errors: FieldErrors = {};
  const fail = (field: QuoteField) => {
    errors[field.name] = t("Revisa el campo %{field}.", {
      field: field.label,
    });
  };
  for (const field of fields) {
    const raw = values[field.name];
    if (field.type === "boolean") {
      if (field.required && raw !== "true" && raw !== "false") fail(field);
      continue;
    }
    if (raw === undefined || raw === "") {
      if (field.required) fail(field);
      continue;
    }
    if (field.type === "number") {
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        fail(field);
        continue;
      }
      if (field.name === "vehicle_productionYear") {
        const year = n;
        if (
          !Number.isInteger(year) ||
          year < 1900 ||
          year > now.getFullYear() + 1
        )
          fail(field);
      } else if (field.name === "vehicle_declaredValue") {
        if (n <= 0 || Math.abs(n) > 1e12) fail(field);
      } else if (field.name === "vehicle_accessoriesValue") {
        if (n < 0 || Math.abs(n) > 1e12) fail(field);
      }
      continue;
    }
    const text = String(raw);
    if (text.length > 200) {
      fail(field);
      continue;
    }
    if (
      field.type === "select" &&
      field.options &&
      !field.options.some((option) => option.value === text)
    ) {
      fail(field);
      continue;
    }
    if (field.type === "email" && !EMAIL_PATTERN.test(text)) fail(field);
    if (field.name === "applicant_birthDate") {
      const birth = new Date(text);
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(text) ||
        !Number.isFinite(birth.getTime()) ||
        birth.toISOString().slice(0, 10) !== text ||
        birth.getTime() > now.getTime()
      ) {
        fail(field);
        continue;
      }
      let age = now.getFullYear() - birth.getFullYear();
      const month = now.getMonth() - birth.getMonth();
      if (month < 0 || (month === 0 && now.getDate() < birth.getDate())) age--;
      if (age <= 15) fail(field);
    }
  }
  return errors;
}

function stepsFor(
  fields: QuoteField[],
  titles: { vehicle: string; applicant: string; contact: string },
) {
  const vehicle = fields.filter((f) => f.name.startsWith("vehicle_"));
  const applicant = fields.filter((f) => APPLICANT_STEP_NAMES.has(f.name));
  const contact = fields.filter((f) => CONTACT_STEP_NAMES.has(f.name));
  // Future definition fields outside the known sets stay visible in the
  // final step instead of failing validation invisibly.
  const known = new Set(
    [...vehicle, ...applicant, ...contact].map((f) => f.name),
  );
  const extra = fields.filter((f) => !known.has(f.name));
  return [
    {
      id: "vehicle",
      title: titles.vehicle,
      fields: vehicle,
    },
    {
      id: "applicant",
      title: titles.applicant,
      fields: applicant,
    },
    {
      id: "contact",
      title: titles.contact,
      fields: [...contact, ...extra],
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
  error,
  disabled,
}: {
  field: QuoteField;
  value: string;
  endpoint: string;
  onChange: (value: string) => void;
  error?: string;
  disabled?: boolean;
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
  // A stale dropdown must never linger over the waiting state or receipt:
  // the whole step is disabled while quoting.
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
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
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `quote-${field.name}-error` : undefined}
        onChange={(e) => search(e.target.value)}
        onFocus={() => {
          if (!disabled && suggestions.length) setOpen(true);
        }}
        onBlur={() => {
          window.setTimeout(() => {
            if (alive.current) setOpen(false);
          }, 150);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
          else if (
            e.key === "Enter" &&
            suggestions.length > 0 &&
            suggestions[0]
          ) {
            e.preventDefault();
            onChange(suggestions[0].code);
            setSuggestions([]);
            setOpen(false);
          }
        }}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        placeholder={t("Buscar ciudad (ej. Bogotá, Medellín, Cali)...")}
      />
      {value && (
        <button
          type="button"
          className="public-quote-city-clear"
          aria-label={t("Limpiar ciudad seleccionada")}
          title={t("Limpiar")}
          onClick={() => {
            onChange("");
            setSuggestions([]);
            setOpen(false);
            document.getElementById(`quote-${field.name}`)?.focus();
          }}
        >
          <span aria-hidden="true">×</span>
        </button>
      )}
      {error && (
        <p
          id={`quote-${field.name}-error`}
          role="alert"
          className="public-quote-field-error"
        >
          {error}
        </p>
      )}
      {loading && (
        <p role="status" className="public-form-help">
          {t("Consultando…")}
        </p>
      )}
      {open && !disabled && !loading && suggestions.length > 0 && (
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
                <span>
                  {suggestion.city} ({suggestion.department})
                </span>
                <span className="public-quote-suggestion-code">
                  {suggestion.code}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && !disabled && !loading && suggestions.length === 0 && (
        <p role="status" className="public-form-help">
          {t("No se encontraron ciudades.")}
        </p>
      )}
    </div>
  );
}

const AGE_PRESETS = [20, 25, 30, 35, 45, 55, 65];

function ageOf(birth: string, now: Date = new Date()): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birth)) return null;
  const date = new Date(birth);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== birth
  )
    return null;
  let age = now.getFullYear() - date.getFullYear();
  const month = now.getMonth() - date.getMonth();
  if (month < 0 || (month === 0 && now.getDate() < date.getDate())) age--;
  return age >= 0 ? age : null;
}

function birthDateFromAge(age: number, now: Date = new Date()): string {
  return `${now.getFullYear() - age}-06-15`;
}

/**
 * Age quick presets mirroring the embedded quote wizard: picking a chip
 * fills the birth date instead of typing it.
 */
function BirthAgeChips({
  value,
  onPick,
}: {
  value: string;
  onPick: (isoDate: string) => void;
}) {
  const t = useMessages(publicFormsMessages);
  const age = ageOf(value);
  const label = t("Edad:");
  return (
    <div className="public-quote-age">
      <p className="public-quote-age-label">
        {label}{" "}
        <strong>
          {age !== null ? t("%{p0} años", { p0: age }) : t("Seleccionar")}
        </strong>
      </p>
      <div className="public-quote-age-chips" role="group" aria-label={label}>
        {AGE_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            className="public-quote-age-chip"
            data-selected={age === preset}
            aria-pressed={age === preset}
            onClick={() => onPick(birthDateFromAge(preset))}
          >
            {preset}
          </button>
        ))}
      </div>
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
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [elapsed, setElapsed] = useState(0);
  const [progress, setProgress] = useState<PublicComparisonItem[] | null>(null);
  const lastStep = step === steps.length - 1;

  useEffect(() => {
    if (!controller.pending || !lastStep) return;
    setElapsed(0);
    const timer = window.setInterval(() => {
      setElapsed((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [controller.pending, lastStep]);

  // Progressive results while providers respond: poll the anonymous status
  // endpoint (3s keeps well under the burst limiter) and paint finished
  // insurers as cards instead of a bare spinner. The first poll waits a full
  // interval so fast submissions never emit one. Failures keep the last
  // known progress; the submit response stays the source of truth.
  useEffect(() => {
    if (!controller.pending || !lastStep || !controller.submissionId) return;
    const submissionId = controller.submissionId;
    let stopped = false;
    const load = async () => {
      try {
        const response = await fetch(
          `${endpoint}/status/${encodeURIComponent(submissionId)}`,
          { credentials: "omit", cache: "no-store" },
        );
        if (stopped || !response.ok) return;
        const data = (await response.json()) as { items?: unknown };
        if (!stopped && Array.isArray(data.items))
          setProgress(parseStatusItems(data.items));
      } catch {
        // Keep the previous progress; the submit lifecycle reports errors.
      }
    };
    const timer = window.setInterval(load, 3000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [controller.pending, controller.submissionId, endpoint, lastStep]);
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupFields, setLookupFields] = useState<string[]>([]);

  function focusFirstError(errors: FieldErrors, fields: QuoteField[]) {
    const first = fields.find((field) => errors[field.name]);
    if (first) document.getElementById(`quote-${first.name}`)?.focus();
  }

  function clearFieldError(name: string) {
    setFieldErrors((prev) => {
      if (!prev[name]) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  }
  const [lookupNotice, setLookupNotice] = useState("");
  const lastLookedUpPlate = useRef("");

  function update(name: string, value: string | boolean) {
    setValues((prev) => ({ ...prev, [name]: value }));
    clearFieldError(name);
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
    lastLookedUpPlate.current = "";
    clearFieldError("vehicle_plate");
  }

  async function lookupPlate() {
    const rawPlate = String(values["vehicle_plate"] ?? "")
      .trim()
      .toUpperCase();
    if (!rawPlate || lookingUp) return;
    // Mirror the server plate format so a typo names the field instead of
    // showing the generic lookup failure.
    if (!/^[A-Z0-9]{3,10}$/.test(rawPlate)) {
      const label =
        definition.fields.find((f) => f.name === "vehicle_plate")?.label ??
        "Placa";
      const message = t("Revisa el campo %{field}.", { field: label });
      setFieldErrors((prev) => ({ ...prev, vehicle_plate: message }));
      document.getElementById("quote-vehicle_plate")?.focus();
      return;
    }
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
    const plate = String(values["vehicle_plate"] ?? "")
      .trim()
      .toUpperCase();
    if (
      plate &&
      plate.length >= 3 &&
      plate !== lastLookedUpPlate.current &&
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

  /** Example placeholders mirroring the embedded quote wizard. */
  function placeholderFor(field: QuoteField): string | undefined {
    if (lookingUp && field.name === "vehicle_fasecoldaCode")
      return t("Consultando Fasecolda…");
    if (lookingUp && field.name === "vehicle_productionYear")
      return t("Consultando…");
    switch (field.name) {
      case "vehicle_fasecoldaCode":
        return t("Ej. 123456");
      case "vehicle_productionYear":
        return t("Ej. 2024");
      case "applicant_documentNumber":
        return t("Ej. 12345678");
      case "applicant_firstName":
        return t("Ej. Ana");
      case "applicant_surname":
        return t("Ej. Pérez");
      case "applicant_secondSurname":
        return t("Opcional");
      case "applicant_address":
        return t("Ej. Calle 1 # 2-3");
      case "applicant_phone":
        return t("Ej. 3001234567");
      case "applicant_email":
        return t("ejemplo@correo.com");
      default:
        return undefined;
    }
  }

  function goNext() {
    if (!formRef.current?.reportValidity()) return;
    const current = steps[step] ?? steps[0];
    const errors = validateWizardFields(current.fields, values, t);
    if (Object.keys(errors).length) {
      setFieldErrors((prev) => ({ ...prev, ...errors }));
      focusFirstError(errors, current.fields);
      return;
    }
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
    setProgress(null);
    setFieldErrors({});
    setLookingUp(false);
    setLookupFields([]);
    setLookupNotice("");
    lastLookedUpPlate.current = "";
    controller.startNew();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!formRef.current?.reportValidity()) return;
    const errors = validateWizardFields(definition.fields, values, t);
    if (Object.keys(errors).length) {
      setFieldErrors((prev) => ({ ...prev, ...errors }));
      const firstStep = steps.findIndex((s) =>
        s.fields.some((field) => errors[field.name]),
      );
      if (firstStep >= 0) setStep(firstStep);
      focusFirstError(errors, definition.fields);
      return;
    }
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
        <QuoteLogo src={definition.logoImage} alt={definition.title} />
        <p className="public-quote-eyebrow">{eyebrow}</p>
        <h1 id="public-quote-success">{t("Solicitud recibida")}</h1>
        <p>
          {t(
            "Conserva esta referencia para consultar con quien compartió el formulario.",
          )}
        </p>
        <p className="public-form-reference">{receipt.reference}</p>
        <PublicReceiptResult result={receipt.result} />
        <div className="public-quote-notice-actions">
          <Button
            type="button"
            variant="outline"
            onClick={() => window.print()}
          >
            {t("Descargar PDF")}
          </Button>
          <Button type="button" variant="outline" onClick={handleStartNew}>
            {t("Iniciar otro envío")}
          </Button>
        </div>
      </section>
    );
  }

  if (duplicate) {
    return (
      <section className="public-quote-notice" role="status">
        <QuoteLogo src={definition.logoImage} alt={definition.title} />
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
        <header className="public-quote-heading">
          <QuoteLogo src={definition.logoImage} alt={definition.title} />
          <p className="public-quote-eyebrow">{eyebrow}</p>
          <h1 className="public-quote-title">{heading}</h1>
          <p className="public-quote-products">
            {products.length === 1
              ? t("%{count} producto", { count: products.length })
              : t("%{count} productos", { count: products.length })}
          </p>
        </header>
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
              {current.fields.map((field) => {
                const error = fieldErrors[field.name];
                const errorId = `quote-${field.name}-error`;
                const invalidProps = {
                  "aria-invalid": error ? true : undefined,
                  "aria-describedby": error ? errorId : undefined,
                } as const;
                return (
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
                          placeholder={t("Ej. TESTCAR")}
                          {...invalidProps}
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
                            lookingUp ||
                            !String(values[field.name] ?? "").trim()
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
                        error={error}
                        disabled={pending || uncertain || lookingUp}
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
                          value={formatCurrency(
                            String(values[field.name] ?? ""),
                          )}
                          placeholder={
                            field.name === "vehicle_accessoriesValue"
                              ? "0"
                              : lookingUp
                                ? t("Consultando…")
                                : t("Ej. 50000000")
                          }
                          {...invalidProps}
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
                        {...invalidProps}
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
                        {...invalidProps}
                        onChange={(e) => update(field.name, e.target.checked)}
                      />
                    ) : field.type === "select" ? (
                      <select
                        id={`quote-${field.name}`}
                        name={field.name}
                        required={field.required}
                        value={String(values[field.name] ?? "")}
                        {...invalidProps}
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
                        placeholder={placeholderFor(field)}
                        {...invalidProps}
                        onChange={(e) => update(field.name, e.target.value)}
                      />
                    )}
                    {field.name === "applicant_birthDate" && (
                      <BirthAgeChips
                        value={String(values[field.name] ?? "")}
                        onPick={(iso) => update(field.name, iso)}
                      />
                    )}
                    {!CITY_FIELDS.has(field.name) && error && (
                      <p
                        id={errorId}
                        role="alert"
                        className="public-quote-field-error"
                      >
                        {error}
                      </p>
                    )}
                  </div>
                );
              })}
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

          {lastStep && pending && (
            <div
              role="status"
              aria-live="polite"
              className="public-quote-waiting"
            >
              <div className="public-quote-waiting-head">
                <span
                  aria-hidden="true"
                  className="public-quote-spinner public-quote-spinner--md"
                />
                <div>
                  <p>
                    <strong>{t("Cotizando con aseguradoras en vivo…")}</strong>
                  </p>
                  <p className="public-form-help">
                    {t(
                      "Estamos consultando las %{count} aseguradoras. Esto puede tardar unos minutos, no cierres ni recargues la página.",
                      { count: products.length },
                    )}
                  </p>
                  <p className="public-form-help">
                    {t("Han pasado %{count} segundos.", { count: elapsed })}
                  </p>
                </div>
              </div>
              <div aria-hidden="true" className="public-quote-progress">
                <div className="public-quote-progress-bar" />
              </div>
              {progress && progress.length > 0 ? (
                <PublicComparison items={progress} />
              ) : (
                <div aria-hidden="true" className="public-quote-skeletons">
                  {[0, 1, 2].map((skeleton) => (
                    <div key={skeleton} className="public-quote-skeleton-card">
                      <div className="public-quote-skeleton public-quote-skeleton--title" />
                      <div className="public-quote-skeleton public-quote-skeleton--price" />
                      <div className="public-quote-skeleton public-quote-skeleton--line" />
                      <div className="public-quote-skeleton public-quote-skeleton--line" />
                    </div>
                  ))}
                </div>
              )}
            </div>
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
