import { Attachments } from "./attachments";
import { linkedFields } from "./linked-fields";
import { validateFields } from "./schema";
import type { Field } from "./types";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { PluginApi } from "@savia/crm-shared/plugin-api";
import { errorMessage, money, text, today, type WorkRecord } from "./data";
import type { WorkbenchConfig } from "./types";

export function RecordEditor({
  config,
  record,
  savia,
  onClose,
  onSaved,
}: {
  config: WorkbenchConfig;
  record: WorkRecord | null;
  savia: PluginApi;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    record ? { ...record } : { ...config.defaults },
  );
  const [extraFields, setExtraFields] = useState<Field[]>([]);
  const [linksLoading, setLinksLoading] = useState(true);
  const [linksError, setLinksError] = useState("");
  useEffect(() => {
    let alive = true;
    linkedFields(savia, config.object, config.fields, record ?? {})
      .then((fields) => {
        if (alive) setExtraFields(fields);
      })
      .catch((cause) => {
        if (alive) setLinksError(errorMessage(cause));
      })
      .finally(() => {
        if (alive) setLinksLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [savia, config, record]);
  const allFields = [...config.fields, ...extraFields];
  const [mode, setMode] = useState("details");
  const [payment, setPayment] = useState("");
  const [paymentDate, setPaymentDate] = useState(today);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const change = (key: string, value: unknown) =>
    setValues((current) => ({ ...current, [key]: value }));
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || linksLoading || linksError) return;
    setError("");
    let patch: Record<string, unknown>;
    try {
      if (mode === "payment" && record && config.payment)
        patch = config.payment.patch(record, payment, paymentDate);
      else {
        patch = Object.fromEntries(
          allFields.map((field) => {
            const value = values[field.key];
            return [
              field.key,
              field.type === "number"
                ? value === "" || value == null
                  ? null
                  : Number(value)
                : typeof value === "string"
                  ? value.trim() || null
                  : (value ?? null),
            ];
          }),
        );
        const problem =
          config.validate(patch) ?? validateFields(extraFields, patch);
        if (problem) throw new Error(problem);
      }
      if (record && !Number.isInteger(record._version))
        throw new Error(
          "Falta la versión del registro. Cierra el panel y actualiza antes de editar.",
        );
      setBusy(true);
      const collection = savia.collections.collection<WorkRecord>(
        config.object,
      );
      if (record)
        await collection.update(record.id, patch, { version: record._version });
      else await collection.create(patch);
      onSaved();
    } catch (cause) {
      setError(
        errorMessage(cause) +
          " Tus cambios siguen en el formulario. Si el registro cambió, ciérralo y actualiza la lista antes de reintentar.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <aside className="iw-editor" aria-labelledby="iw-editor-title">
      <header className="iw-editor-heading">
        <div>
          <p>{record ? "Gestión del registro" : "Nuevo registro"}</p>
          <h2 id="iw-editor-title" ref={heading} tabIndex={-1}>
            {record ? text(record.name) : config.singular}
          </h2>
        </div>
        <button
          type="button"
          aria-label="Cerrar panel"
          disabled={busy}
          onClick={onClose}
        >
          Cerrar
        </button>
      </header>
      {record && config.payment && (
        <div className="iw-editor-tabs" aria-label="Tipo de gestión">
          <button
            type="button"
            aria-pressed={mode === "details"}
            disabled={busy}
            onClick={() => {
              setMode("details");
              setError("");
            }}
          >
            Datos y seguimiento
          </button>
          <button
            type="button"
            aria-pressed={mode === "payment"}
            disabled={
              busy ||
              config.payment.balance(record) === null ||
              config.payment.balance(record) === 0
            }
            onClick={() => {
              setMode("payment");
              setError("");
            }}
          >
            Registrar abono
          </button>
        </div>
      )}
      <form onSubmit={save}>
        {error && (
          <div role="alert" className="iw-error">
            {error}
          </div>
        )}
        {linksLoading ? <p role="status">Cargando vínculos…</p> : null}
        {linksError ? (
          <p role="alert">
            {linksError} Cierra el panel y actualiza la lista para reintentar.
          </p>
        ) : null}
        <fieldset disabled={busy || linksLoading || !!linksError}>
          {mode === "payment" && record && config.payment ? (
            <>
              <div className="iw-payment-balance">
                <span>Saldo pendiente</span>
                <strong>{money(config.payment.balance(record))}</strong>
                <p>Registra un pago recibido. Esta acción no mueve dinero.</p>
              </div>
              <label htmlFor="iw-payment">
                Valor del abono (COP)
                <input
                  id="iw-payment"
                  type="number"
                  min="0.01"
                  step="0.01"
                  max={config.payment.balance(record) ?? undefined}
                  required
                  value={payment}
                  onChange={(event) => setPayment(event.target.value)}
                />
              </label>
              <label htmlFor="iw-payment-date">
                Fecha del pago
                <input
                  id="iw-payment-date"
                  type="date"
                  required
                  value={paymentDate}
                  onChange={(event) => setPaymentDate(event.target.value)}
                />
              </label>
            </>
          ) : (
            allFields.map((field) => (
              <div
                key={field.key}
                className={field.type === "textarea" ? "iw-wide" : undefined}
              >
                <label htmlFor={`iw-field-${field.key}`}>
                  {field.label}
                  {(field.required ||
                    field.requiredStages?.includes(text(values.stage))) && (
                    <span aria-hidden="true"> *</span>
                  )}
                </label>
                {field.type === "select" ? (
                  <select
                    id={`iw-field-${field.key}`}
                    aria-describedby={
                      field.help ? `iw-help-${field.key}` : undefined
                    }
                    value={String(values[field.key] ?? "")}
                    required={
                      field.required ||
                      field.requiredStages?.includes(text(values.stage))
                    }
                    onChange={(event) => change(field.key, event.target.value)}
                  >
                    {!field.required && (
                      <option value="">Sin especificar</option>
                    )}
                    {field.options?.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : field.type === "textarea" ? (
                  <textarea
                    id={`iw-field-${field.key}`}
                    aria-describedby={
                      field.help ? `iw-help-${field.key}` : undefined
                    }
                    rows={4}
                    required={
                      field.required ||
                      field.requiredStages?.includes(text(values.stage))
                    }
                    maxLength={field.maxLength ?? 10000}
                    value={String(values[field.key] ?? "")}
                    onChange={(event) => change(field.key, event.target.value)}
                  />
                ) : (
                  <input
                    id={`iw-field-${field.key}`}
                    aria-describedby={
                      field.help ? `iw-help-${field.key}` : undefined
                    }
                    type={field.type ?? "text"}
                    required={
                      field.required ||
                      field.requiredStages?.includes(text(values.stage))
                    }
                    min={field.min}
                    max={field.max}
                    step={field.type === "number" ? "0.01" : undefined}
                    maxLength={field.maxLength ?? 200}
                    value={String(values[field.key] ?? "").slice(
                      0,
                      field.type === "date" ? 10 : undefined,
                    )}
                    onChange={(event) => change(field.key, event.target.value)}
                  />
                )}
                {field.help && (
                  <small id={`iw-help-${field.key}`}>{field.help}</small>
                )}
              </div>
            ))
          )}
        </fieldset>
        <footer className="iw-editor-footer">
          <button type="button" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button
            className="iw-primary"
            type="submit"
            disabled={busy || linksLoading || !!linksError}
          >
            {busy
              ? "Guardando…"
              : mode === "payment"
                ? "Guardar abono"
                : "Guardar cambios"}
          </button>
        </footer>
      </form>
      {record && config.recordActions?.({ savia, record, onSaved })}
      {record && (
        <Attachments
          savia={savia}
          object={config.object}
          recordId={record.id}
        />
      )}
    </aside>
  );
}
