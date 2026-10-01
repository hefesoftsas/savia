import { usePluginLocale } from "@savia/studio-shared/plugin-locale-react";
import { useWorkbenchMessages } from "./localization";
import { Attachments } from "./attachments";
import { Drawer } from "./drawer";
import { linkedFields } from "./linked-fields";
import { RecordLookup } from "./record-lookup";
import { validateFields } from "./schema";
import type { Field } from "./types";
import { useEffect, useId, useRef, useState, type SyntheticEvent } from "react";
import type { PluginApi, PluginRecordReceipt } from "@savia/studio-shared/plugin-api";
import { errorMessage, money, text, today, type WorkRecord } from "./data";
import type { WorkbenchConfig } from "./types";

export function RecordEditor({
  config,
  record,
  savia,
  onClose,
  onSaved,
  embedded = false,
  operationBusy = false,
}: {
  config: WorkbenchConfig;
  record: WorkRecord | null;
  savia: PluginApi;
  onClose: () => void;
  onSaved: (receipt?: PluginRecordReceipt<WorkRecord>) => void;
  embedded?: boolean;
  operationBusy?: boolean;
}) {
  const formId = useId();
  const locale = usePluginLocale();
  const t = useWorkbenchMessages(config.messages);

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
  const extrasByKey = new Map(extraFields.map((field) => [field.key, field]));
  const configuredKeys = new Set(config.fields.map((field) => field.key));
  const allFields = [
    ...config.fields.map((field) => ({ ...field, ...extrasByKey.get(field.key) })),
    ...extraFields.filter((field) => !configuredKeys.has(field.key)),
  ];
  const [mode, setMode] = useState(
    savia.ui?.panel?.request.params.mode ?? "details",
  );
  const [payment, setPayment] = useState("");
  const [paymentDate, setPaymentDate] = useState(today);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const initial = useRef(JSON.stringify(values));
  const initialPaymentDate = useRef(paymentDate);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (embedded)
      formRef.current
        ?.querySelector<HTMLElement>("input,select,textarea")
        ?.focus();
  }, [embedded]);
  const dirty =
    JSON.stringify(values) !== initial.current ||
    payment !== "" ||
    paymentDate !== initialPaymentDate.current;
  useEffect(() => {
    if (embedded)
      savia.ui?.setPanelState({
        dirty,
        busy: busy || operationBusy,
      });
  }, [savia, embedded, dirty, busy, operationBusy]);
  const Frame = embedded ? EmbeddedEditor : Drawer;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const change = (key: string, value: unknown) =>
    setValues((current) => ({ ...current, [key]: value }));
  async function save(event: SyntheticEvent) {
    event.preventDefault();
    if (busy || linksLoading || linksError) return;
    setError("");
    let patch: Record<string, unknown>;
    let version = record?._version;
    setBusy(true);
    try {
      if (mode === "payment" && record && config.payment) {
        const current = await savia.collections.collection<WorkRecord>(config.object).get(record.id);
        if (!Number.isInteger(current._version)) throw new Error(t("Falta la versión del registro. Cierra el panel y actualiza antes de editar."));
        version = current._version;
        patch = config.payment.patch(current, payment, paymentDate);
      } else {
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
          config.validate(patch) ?? validateFields(extraFields, patch, locale);
        if (problem) throw new Error(problem);
      }
      if (record && !savia.localRecords && !Number.isInteger(record._version))
        throw new Error(
          t(
            "Falta la versión del registro. Cierra el panel y actualiza antes de editar.",
          ),
        );
      setBusy(true);
      if (mode !== "payment" && savia.localRecords) {
        const collection = savia.localRecords.collection<WorkRecord>(config.object);
        const receipt = record
          ? await collection.update(record.id, patch, { version: record._version })
          : await collection.create(patch);
        onSaved(receipt);
      } else {
        const collection = savia.collections.collection<WorkRecord>(config.object);
        if (record) await collection.update(record.id, patch, { version });
        else await collection.create(patch);
        onSaved();
      }
    } catch (cause) {
      setError(
        errorMessage(cause) +
          t(
            " Tus cambios siguen en el formulario. Si el registro cambió, ciérralo y actualiza la lista antes de reintentar.",
          ),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Frame labelledBy="iw-editor-title" onClose={busy ? () => {} : onClose}>
      {!embedded && (
        <header className="iw-editor-heading">
          <div>
            <p>{record ? t("Gestión del registro") : t("Nuevo registro")}</p>
            <h2 id="iw-editor-title" ref={heading} tabIndex={-1}>
              {record ? text(record.name) : config.singular}
            </h2>
          </div>
          <button
            type="button"
            aria-label={t("Cerrar panel")}
            disabled={busy || operationBusy}
            onClick={onClose}
          >
            {t("Cerrar")}{" "}
          </button>
        </header>
      )}
      {record && config.payment && (
        <div className="iw-editor-tabs" aria-label={t("Tipo de gestión")}>
          <button
            type="button"
            aria-pressed={mode === "details"}
            disabled={busy || operationBusy}
            onClick={() => {
              setMode("details");
              setError("");
            }}
          >
            {t("Datos y seguimiento")}{" "}
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
            {t("Registrar abono")}{" "}
          </button>
        </div>
      )}
      <div className="iw-editor-body">
        <form
          ref={formRef}
          id={formId}
          onSubmit={save}
          onKeyDown={(event) => {
            // The isolated shell intentionally has no allow-forms permission.
            // Handle input Enter without invoking native form navigation.
            if (
              event.key === "Enter" &&
              event.target instanceof HTMLInputElement &&
              event.target.type !== "file" &&
              !event.target.closest("[data-iw-lookup-picker]")
            ) {
              event.preventDefault();
              if (formRef.current?.reportValidity()) void save(event);
            }
          }}
        >
          {error && (
            <div role="alert" className="iw-error">
              {error}
            </div>
          )}
          {linksLoading ? (
            <p role="status">{t("Cargando vínculos…")} </p>
          ) : null}
          {linksError ? (
            <p role="alert">
              {linksError}{" "}
              {t("Cierra el panel y actualiza la lista para reintentar.")}{" "}
            </p>
          ) : null}
          <fieldset disabled={busy || operationBusy}>
            {mode === "payment" && record && config.payment ? (
              <>
                <div className="iw-payment-balance">
                  <span>{t("Saldo pendiente")} </span>
                  <strong>
                    {money(config.payment.balance(record), locale)}
                  </strong>
                  <p>
                    {t(
                      "Registra un pago recibido. Esta acción no mueve dinero.",
                    )}{" "}
                  </p>
                </div>
                <label htmlFor="iw-payment">
                  {t("Valor del abono (COP)")}{" "}
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
                  {t("Fecha del pago")}{" "}
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
              allFields.filter((field) => !field.hidden).map((field) => (
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
                  {field.lookup === true && field.lookupConfig ? (
                    <RecordLookup
                      savia={savia}
                      fieldKey={field.key}
                      label={field.label}
                      mapping={field.lookupConfig}
                      snapshot={String(values[field.key] ?? "")}
                      referenceId={String(values[field.lookupConfig.idField] ?? "")}
                      disabled={busy || operationBusy}
                      t={t}
                      onSelect={(id, label) =>
                        setValues((current) => ({
                          ...current,
                          [field.key]: label,
                          [field.lookupConfig!.idField]: id,
                        }))
                      }
                      onClear={() =>
                        setValues((current) => ({
                          ...current,
                          [field.key]: null,
                          [field.lookupConfig!.idField]: null,
                        }))
                      }
                    />
                  ) : field.type === "select" ? (
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
                      onChange={(event) =>
                        change(field.key, event.target.value)
                      }
                    >
                      {!field.required && (
                        <option value="">{t("Sin especificar")} </option>
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
                      onChange={(event) =>
                        change(field.key, event.target.value)
                      }
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
                      onChange={(event) =>
                        change(field.key, event.target.value)
                      }
                    />
                  )}
                  {field.help && (
                    <small id={`iw-help-${field.key}`}>{field.help}</small>
                  )}
                </div>
              ))
            )}
          </fieldset>
        </form>
        {record && config.recordActions?.({ savia, record, onSaved })}
        {record && (
          <Attachments
            savia={savia}
            object={config.object}
            recordId={record.id}
          />
        )}
      </div>
      <footer className="iw-editor-footer">
        <button
          type="button"
          onClick={onClose}
          disabled={busy || operationBusy}
        >
          {t("Cancelar")}{" "}
        </button>
        <button
          className="iw-primary"
          type="button"
          form={formId}
          onClick={(event) => {
            if (formRef.current?.reportValidity()) void save(event);
          }}
          disabled={busy || operationBusy || linksLoading || !!linksError}
        >
          {busy
            ? t("Guardando…")
            : mode === "payment"
              ? t("Guardar abono")
              : t("Guardar cambios")}
        </button>
      </footer>
    </Frame>
  );
}

function EmbeddedEditor({
  children,
}: {
  children: React.ReactNode;
  labelledBy: string;
  onClose: () => void;
}) {
  return <div className="iw-drawer iw-embedded-editor">{children}</div>;
}
