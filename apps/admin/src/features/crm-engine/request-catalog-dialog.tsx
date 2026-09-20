import { useMessages } from "@/i18n/core";
import { automationMessages } from "@/i18n/locales/automation";
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  requestOperations,
  requestFieldName,
  type RequestPageConfig,
  type RequestOperation,
} from "@savia/crm-shared/request-page";
import { requestPageApi } from "./request-page-api";

export function RequestCatalogDialog({
  config,
  fields,
  onAdd,
}: {
  config: RequestPageConfig;
  fields: Record<string, { label?: string }>;
  onAdd: (config: RequestPageConfig, id: string) => void;
}) {
  const t = useMessages(automationMessages);

  const [open, setOpen] = useState(false);
  const [catalog, setCatalog] = useState<RequestOperation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [id, setId] = useState("");
  const [kind, setKind] = useState<"submit" | "lookup">("submit");
  const [input, setInput] = useState<Record<string, string>>({});
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError("");
    setCatalog([]);
    requestPageApi("/openapi.json")
      .then((document) => {
        if (active) setCatalog(requestOperations(document));
      })
      .catch((error) => {
        if (active)
          setError(
            error instanceof Error
              ? error.message
              : t("No se pudo cargar el catálogo."),
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, retry]);
  const available = catalog.filter(
    (op) =>
      op.kind !== "auth" &&
      Object.keys(op.input).length > 0 &&
      !config.actions.some((action) => action.id === op.id),
  );
  const operation = available.find((op) => op.id === id);
  const valid =
    operation &&
    Object.keys(operation.input).every(
      (key) => input[key] && fields[input[key]],
    ) &&
    config.actions.length < 20;
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-8"
            aria-label={t("Agregar request")}
            disabled={config.actions.length >= 20}
            onClick={() => {
              setId("");
              setQuery("");
              setInput({});
              setKind("submit");
              setOpen(true);
            }}
          >
            <Plus size={14} aria-hidden="true" className="text-primary" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left" sideOffset={6}>
          {t("Agregar request")}
        </TooltipContent>
      </Tooltip>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t("Conectar un request")}</DialogTitle>
            <DialogDescription>
              {t(
                "Selecciona una operación y conecta sus entradas con campos existentes. Se guardará al publicar; no se ejecutará ahora.",
              )}
            </DialogDescription>
          </DialogHeader>
          {loading ? (
            <p role="status">{t("Cargando catálogo de Savia Request…")}</p>
          ) : error ? (
            <div>
              <p role="alert">{error}</p>
              <Button
                type="button"
                variant="outline"
                onClick={() => setRetry((value) => value + 1)}
              >
                {t("Reintentar")}
              </Button>
            </div>
          ) : (
            <>
              <label className="studio-control">
                <span>{t("Buscar request")}</span>
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <label className="studio-control">
                <span>{t("Request disponible")}</span>
                <select
                  value={id}
                  onChange={(event) => {
                    const next = available.find(
                      (op) => op.id === event.target.value,
                    );
                    setId(event.target.value);
                    setInput(
                      Object.fromEntries(
                        Object.keys(next?.input ?? {}).map((key) => [
                          key,
                          fields[requestFieldName(key)]
                            ? requestFieldName(key)
                            : "",
                        ]),
                      ),
                    );
                  }}
                >
                  <option value="">{t("Selecciona un request")}</option>
                  {available
                    .filter(
                      (op) =>
                        op.id === id ||
                        (op.label + " " + op.id)
                          .toLowerCase()
                          .includes(query.toLowerCase()),
                    )
                    .map((op) => (
                      <option key={op.id} value={op.id}>
                        {op.label} ({op.id})
                      </option>
                    ))}
                </select>
              </label>
              {!available.length && (
                <p>
                  {t(
                    "No hay requests adicionales con entradas disponibles para esta página.",
                  )}
                </p>
              )}
              {operation && (
                <>
                  <label className="studio-control">
                    <span>{t("Cómo se ejecuta")}</span>
                    <select
                      value={kind}
                      onChange={(event) =>
                        setKind(event.target.value as "submit" | "lookup")
                      }
                    >
                      <option value="submit">
                        {t("Con el botón principal")}
                      </option>
                      <option value="lookup">
                        {t("Como consulta junto a un campo")}
                      </option>
                    </select>
                  </label>
                  {kind === "lookup" && (
                    <p className="text-sm text-muted-foreground">
                      {t(
                        "El botón aparecerá junto al campo conectado a la primera entrada. Las salidas y eventos se configuran en las propiedades de ese campo.",
                      )}
                    </p>
                  )}
                  <h4 className="font-semibold">{t("Entradas del request")}</h4>
                  {Object.keys(operation.input).map((key) => (
                    <label key={key} className="studio-control">
                      <span>{key}</span>
                      <select
                        aria-label={t("Conectar %{key}", { key: key })}
                        value={input[key] ?? ""}
                        onChange={(event) =>
                          setInput((current) => ({
                            ...current,
                            [key]: event.target.value,
                          }))
                        }
                      >
                        <option value="">{t("Selecciona un campo")}</option>
                        {Object.entries(fields).map(([name, field]) => (
                          <option key={name} value={name}>
                            {field.label ?? name} ({name})
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                  {!valid && (
                    <p className="text-sm text-muted-foreground">
                      {t(
                        "Conecta todas las entradas. Si falta un campo, créalo en Diseñar antes de agregar este request.",
                      )}
                    </p>
                  )}
                </>
              )}
            </>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              {t("Cancelar")}
            </Button>
            <Button
              type="button"
              disabled={!valid || loading || !!error}
              onClick={() => {
                if (!valid || !operation) return;
                onAdd(
                  {
                    ...config,
                    actions: [
                      ...config.actions,
                      {
                        id: operation.id,
                        operationId: operation.operationId,
                        label: operation.label,
                        kind,
                        input: Object.fromEntries(
                          Object.keys(operation.input).map((key) => [
                            key,
                            input[key],
                          ]),
                        ),
                        output: {},
                      },
                    ],
                  },
                  operation.id,
                );
                setOpen(false);
              }}
            >
              {t("Conectar request")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
