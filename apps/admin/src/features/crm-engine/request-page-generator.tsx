import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "./api";
import { requestPageApi } from "./request-page-api";
import {
  generateRequestPage,
  requestFieldName,
  requestOperations,
  type RequestOperation,
} from "@savia/crm-shared/request-page";
import type { CrmObject } from "@savia/crm-shared/metadata";
export default function RequestPageGenerator({
  onCreated,
}: {
  onCreated: (object: CrmObject) => Promise<void>;
}) {
  const [document, setDocument] = useState<unknown>();
  const [operations, setOperations] = useState<RequestOperation[]>([]);
  const [selected, setSelected] = useState<string[]>([]),
    [lookups, setLookups] = useState<string[]>([]);
  const [label, setLabel] = useState("Cotizador"),
    [name, setName] = useState("cotizador");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    requestPageApi("/openapi.json").then(
      (doc) => {
        if (!active) return;
        setDocument(doc);
        setOperations(requestOperations(doc));
      },
      (e) => active && setError(e.message),
    );
    return () => {
      active = false;
    };
  }, []);
  const submitOperations = operations.filter(
    (operation) =>
      operation.kind !== "lookup" &&
      operation.kind !== "vehicle_lookup" &&
      operation.kind !== "auth",
  );
  const lookupOperations = operations.filter(
    (operation) =>
      operation.kind === "lookup" &&
      Object.values(operation.input).some(
        (schema) => schema["x-savia-field"]?.output,
      ),
  );
  const selectedFields = new Set(
    selected.flatMap((id) => {
      const operation = submitOperations.find(
        (candidate) => candidate.id === id,
      );
      return operation
        ? Object.keys(operation.input).map(requestFieldName)
        : [];
    }),
  );
  const lookupOptions = lookupOperations.map((operation) => ({
    operation,
    missingFields: Object.entries(operation.input)
      .map(([key, schema]) =>
        requestFieldName(schema["x-savia-field"]?.bind ?? key),
      )
      .filter((field) => !selectedFields.has(field)),
  }));
  const availableLookupIds = lookupOptions
    .filter(({ missingFields }) => !missingFields.length)
    .map(({ operation }) => operation.id);
  const availableLookupIdKey = availableLookupIds.join("|");
  useEffect(() => {
    setLookups((current) => {
      const next = current.filter((id) => availableLookupIds.includes(id));
      return next.length === current.length ? current : next;
    });
  }, [availableLookupIdKey]);
  const selectedLabel =
    selected.length === 1
      ? "1 operación seleccionada"
      : `${selected.length} operaciones seleccionadas`;
  return (
    <section
      className="mx-auto max-w-4xl space-y-6"
      aria-label="Generar página desde Savia request"
    >
      <header>
        <h1 className="text-2xl font-semibold">Página desde Savia request</h1>
        <p className="mt-2 text-muted-foreground">
          Selecciona los requests. Sus contratos OpenAPI generan el formulario y
          las acciones de la página.
        </p>
      </header>
      <form
        className="space-y-6 rounded-xl border bg-card p-6"
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true);
          setError("");
          try {
            const object = generateRequestPage(document, {
              name,
              label,
              operationIds: selected,
              lookupIds: lookups.filter((id) =>
                availableLookupIds.includes(id),
              ),
            });
            const saved = await api<{ data: CrmObject }>(
              "/objects",
              "POST",
              object,
            );
            window.dispatchEvent(new Event("savia-crm-objects-changed"));
            await onCreated(saved.data);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-2">
            Nombre de la página
            <Input
              required
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </label>
          <label className="grid gap-2">
            Identificador
            <Input
              required
              pattern="[a-z][a-z0-9_]{0,47}"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        </div>
        <fieldset className="space-y-3">
          <legend className="mb-3 font-semibold">
            Operaciones al enviar el formulario
          </legend>
          <div className="grid max-h-52 gap-3 overflow-y-auto pr-1 md:max-h-[min(42dvh,30rem)] md:grid-cols-2">
            {submitOperations.map((o) => (
              <label
                key={o.id}
                className="flex items-center gap-3 rounded-md border p-3"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(o.id)}
                  onChange={(e) => {
                    setError("");
                    setSelected((v) =>
                      e.target.checked
                        ? [...v, o.id]
                        : v.filter((id) => id !== o.id),
                    );
                  }}
                />
                <span>
                  {o.label}
                  <small className="block text-muted-foreground">
                    {Object.keys(o.input).length} campos de entrada
                  </small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="space-y-3">
          <legend className="mb-3 font-semibold">
            Consultas para completar campos
          </legend>
          <div className="grid max-h-56 gap-3 overflow-y-auto pr-1 md:grid-cols-2">
            {lookupOptions.map(({ operation, missingFields }) => (
              <label
                key={operation.id}
                className={
                  "flex items-center gap-3 rounded-md border p-3 " +
                  (missingFields.length ? "cursor-not-allowed opacity-60" : "")
                }
              >
                <input
                  type="checkbox"
                  disabled={Boolean(missingFields.length)}
                  checked={lookups.includes(operation.id)}
                  onChange={(e) => {
                    setError("");
                    setLookups((v) =>
                      e.target.checked
                        ? [...v, operation.id]
                        : v.filter((id) => id !== operation.id),
                    );
                  }}
                />
                <span>
                  {operation.label}
                  {missingFields.length ? (
                    <small className="block text-muted-foreground">
                      Selecciona una cotización compatible para activarla.
                    </small>
                  ) : null}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3">
          <p
            role="status"
            aria-live="polite"
            className="text-sm text-muted-foreground"
          >
            {selectedLabel}
          </p>
          <Button
            disabled={!document || !selected.length || busy}
            type="submit"
          >
            {busy ? "Generando…" : "Generar página"}
          </Button>
        </div>
      </form>
    </section>
  );
}
