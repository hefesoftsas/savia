import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  LoaderCircle,
  PlusCircle,
  TableProperties,
} from "lucide-react";
import type { ApiClient } from "@/api/api-client";
import {
  createMyDayWidgetId,
  type MyDayWidget,
} from "@savia/studio-shared/my-day-widgets";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  describeWidgetCollection,
  listWidgetCollections,
  listWidgetDomains,
} from "./data";
import {
  availablePluginWidgets,
  listWidgetExtensions,
  type ExtensionInstallation,
} from "./plugins";
import { autoDetectWidgetConfig } from "./summarize";
import type {
  WidgetCollection,
  WidgetCollectionSchema,
  WidgetDomain,
} from "./types";

const AUTO = "__auto";

type Source = "collection" | "system";

export function AddWidgetDialog({
  open,
  onOpenChange,
  apiClient,
  onAdd,
  saving,
  existingKinds = [],
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  apiClient: ApiClient | undefined;
  onAdd: (widget: MyDayWidget) => Promise<boolean>;
  saving: boolean;
  existingKinds?: string[];
}) {
  const [source, setSource] = useState<Source>("collection");
  const [domains, setDomains] = useState<WidgetDomain[]>([]);
  const [domain, setDomain] = useState("");
  const [collections, setCollections] = useState<WidgetCollection[]>([]);
  const [collection, setCollection] = useState("");
  const [schema, setSchema] = useState<WidgetCollectionSchema | null>(null);
  const [kind, setKind] = useState<string>("summary");
  const [systemKind, setSystemKind] = useState<string>("agenda");
  const [extensions, setExtensions] = useState<
    ExtensionInstallation[] | undefined
  >(undefined);
  const [statusField, setStatusField] = useState(AUTO);
  const [amountField, setAmountField] = useState(AUTO);
  const [limit, setLimit] = useState("5");
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const hasAgenda = existingKinds.includes("agenda");
  const hasQuickTask = existingKinds.includes("quick_task");

  useEffect(() => {
    if (!open) return;
    setFeedback(null);
    setSource(hasAgenda && hasQuickTask ? "collection" : "collection");
    if (!hasAgenda) setSystemKind("agenda");
    else if (!hasQuickTask) setSystemKind("quick_task");
  }, [open, hasAgenda, hasQuickTask]);

  useEffect(() => {
    if (!open || !apiClient || source !== "collection") return;
    let active = true;
    setLoading(true);
    setFeedback(null);
    void listWidgetDomains(apiClient).then(
      (result) => {
        if (!active) return;
        setDomains(result);
        const preferred =
          result.find((entry) => entry.kind === "platform") ?? result[0];
        if (preferred) setDomain(preferred.apiBasePath);
        setLoading(false);
      },
      () => {
        if (!active) return;
        setFeedback("No pudimos cargar tus colecciones. Reintenta.");
        setLoading(false);
      },
    );
    return () => {
      active = false;
    };
  }, [open, apiClient, source]);

  useEffect(() => {
    if (!open || !apiClient || source !== "collection" || !domain) return;
    let active = true;
    setLoading(true);
    void Promise.allSettled([
      listWidgetCollections(apiClient, domain),
      listWidgetExtensions(apiClient, domain).catch(() => []),
    ]).then((results) => {
      if (!active) return;
      if (results[0].status === "fulfilled") {
        setCollections(results[0].value);
      } else {
        setFeedback("No pudimos cargar las colecciones de este dominio.");
      }
      setExtensions(results[1].status === "fulfilled" ? results[1].value : []);
      setCollection("");
      setSchema(null);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [open, apiClient, domain, source]);

  useEffect(() => {
    if (
      !open ||
      !apiClient ||
      source !== "collection" ||
      !domain ||
      !collection
    )
      return;
    let active = true;
    void describeWidgetCollection(apiClient, domain, collection).then(
      (result) => {
        if (!active || !result) return;
        setSchema(result);
        setStatusField(AUTO);
        setAmountField(AUTO);
      },
      () => {
        if (active) setFeedback("No pudimos leer esta colección.");
      },
    );
    return () => {
      active = false;
    };
  }, [open, apiClient, domain, collection, source]);

  const detected = useMemo(
    () => (schema ? autoDetectWidgetConfig(schema) : {}),
    [schema],
  );
  const dropdownFields = useMemo(
    () => schema?.fields.filter((field) => field.type === "Dropdown") ?? [],
    [schema],
  );
  const numericFields = useMemo(
    () =>
      schema?.fields.filter(
        (field) => field.type === "Number" || field.type === "Currency",
      ) ?? [],
    [schema],
  );
  const selected = collections.find((entry) => entry.name === collection);
  const pluginOptions = useMemo(
    () => availablePluginWidgets(collection, extensions),
    [collection, extensions],
  );
  const isPluginKind = kind.startsWith("plugin:");
  const needsGroup = kind === "chart";
  const needsDate = kind === "actions";
  const incompatible =
    schema !== null &&
    ((needsGroup && dropdownFields.length === 0) ||
      (needsDate &&
        schema.fields.every(
          (field) =>
            field.type !== "DateControl" &&
            field.type !== "DateTime" &&
            field.type !== "Time",
        )));

  async function save() {
    if (source === "system") {
      if (
        (systemKind === "agenda" && hasAgenda) ||
        (systemKind === "quick_task" && hasQuickTask)
      ) {
        setFeedback("Ese widget ya está en tu tablero.");
        return;
      }
      const widget = {
        id: systemKind,
        kind: systemKind,
      } as MyDayWidget;
      const ok = await onAdd(widget);
      if (ok) {
        onOpenChange(false);
        setCollection("");
        setSchema(null);
      }
      return;
    }
    if (!domain || !collection) {
      setFeedback("Elige un dominio y una colección.");
      return;
    }
    if (incompatible) {
      setFeedback(
        kind === "chart"
          ? "Esta colección no tiene campo de agrupación para graficar."
          : "Esta colección no tiene campo de fecha para detectar vencimientos.",
      );
      return;
    }
    const parsedLimit = Number(limit);
    const groupValue =
      statusField !== AUTO ? statusField : detected.statusField;
    const amountValue =
      amountField !== AUTO ? amountField : detected.amountField;
    const widget: MyDayWidget = {
      id: createMyDayWidgetId(),
      apiBasePath: domain as Extract<
        MyDayWidget,
        { apiBasePath: string }
      >["apiBasePath"],
      collection: collection as Extract<
        MyDayWidget,
        { collection: string }
      >["collection"],
      kind: kind as Extract<MyDayWidget, { apiBasePath: string }>["kind"],
      config: {
        ...(isPluginKind
          ? {}
          : {
              ...(kind === "chart"
                ? { ...(groupValue ? { groupField: groupValue } : {}) }
                : { ...(groupValue ? { statusField: groupValue } : {}) }),
              ...(amountValue ? { amountField: amountValue } : {}),
              ...(detected.dateField ? { dateField: detected.dateField } : {}),
            }),
        limit: Number.isInteger(parsedLimit) ? parsedLimit : 5,
        sort: "updated_at",
        order: "DESC",
      },
    };
    const ok = await onAdd(widget);
    if (ok) {
      onOpenChange(false);
      setCollection("");
      setSchema(null);
    }
  }

  const canSaveSystem =
    (systemKind === "agenda" && !hasAgenda) ||
    (systemKind === "quick_task" && !hasQuickTask);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Agregar widget</DialogTitle>
          <DialogDescription>
            Combina tu agenda con resúmenes de tus colecciones en un solo
            tablero. Todo se guarda automáticamente y puedes reordenarlo
            arrastrando.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {feedback ? (
            <p role="alert" className="text-sm text-destructive">
              {feedback}
            </p>
          ) : null}
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-muted/60 p-1.5">
            <Button
              type="button"
              variant={source === "collection" ? "default" : "ghost"}
              size="sm"
              className="gap-1.5"
              onClick={() => setSource("collection")}
            >
              <TableProperties className="size-4" aria-hidden="true" />
              Colección
            </Button>
            <Button
              type="button"
              variant={source === "system" ? "default" : "ghost"}
              size="sm"
              className="gap-1.5"
              onClick={() => setSource("system")}
            >
              <CalendarDays className="size-4" aria-hidden="true" />
              Agenda
            </Button>
          </div>

          {source === "system" ? (
            <div className="space-y-2">
              <Label htmlFor="widget-system">Widget del sistema</Label>
              <Select value={systemKind} onValueChange={setSystemKind}>
                <SelectTrigger id="widget-system" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="agenda" disabled={hasAgenda}>
                    <span className="flex items-center gap-2">
                      <CalendarDays className="size-4" aria-hidden="true" />
                      Agenda del día
                      {hasAgenda ? " (ya agregado)" : ""}
                    </span>
                  </SelectItem>
                  <SelectItem value="quick_task" disabled={hasQuickTask}>
                    <span className="flex items-center gap-2">
                      <PlusCircle className="size-4" aria-hidden="true" />
                      Crear tarea rápida
                      {hasQuickTask ? " (ya agregado)" : ""}
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-sm leading-6 text-muted-foreground">
                {systemKind === "agenda"
                  ? "Muestra tus eventos de Google Calendar y Outlook para hoy, con enlaces directos."
                  : "Formulario compacto para bloquear tiempo en tus calendarios conectados."}
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="widget-domain">Dominio</Label>
                <Select
                  value={domain}
                  onValueChange={setDomain}
                  disabled={loading || domains.length === 0}
                >
                  <SelectTrigger id="widget-domain" className="w-full">
                    <SelectValue placeholder="Elige un dominio" />
                  </SelectTrigger>
                  <SelectContent>
                    {domains.map((entry) => (
                      <SelectItem
                        key={entry.apiBasePath}
                        value={entry.apiBasePath}
                      >
                        {entry.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs leading-5 text-muted-foreground">
                  El dominio es el espacio de datos de origen. Solo verás
                  colecciones autorizadas para tu usuario.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="widget-collection">Colección</Label>
                <Select
                  value={collection}
                  onValueChange={setCollection}
                  disabled={loading || collections.length === 0}
                >
                  <SelectTrigger id="widget-collection" className="w-full">
                    <SelectValue placeholder="Elige una colección" />
                  </SelectTrigger>
                  <SelectContent>
                    {collections.map((entry) => (
                      <SelectItem key={entry.name} value={entry.name}>
                        {entry.label}
                        {typeof entry.count === "number"
                          ? ` (${entry.count})`
                          : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="widget-kind">Tipo de widget</Label>
                <Select value={kind} onValueChange={setKind}>
                  <SelectTrigger id="widget-kind" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="summary">
                      Resumen: total y conteo por estado
                    </SelectItem>
                    <SelectItem value="items">
                      Elementos: últimos registros
                    </SelectItem>
                    <SelectItem value="chart">
                      Gráfica: barras por estado
                    </SelectItem>
                    <SelectItem value="actions">
                      Acciones: vencidos y por vencer
                    </SelectItem>
                    {pluginOptions.map((option) => (
                      <SelectItem
                        key={`${option.extensionId}:${option.id}`}
                        value={`plugin:${option.extensionId}:${option.id}`}
                      >
                        ✦ {option.title.es}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {incompatible ? (
                <p role="alert" className="text-sm text-destructive">
                  {kind === "chart"
                    ? "Esta colección no tiene listas de opciones para agrupar. Elige otro tipo."
                    : "Esta colección no tiene campos de fecha. Elige otro tipo."}
                </p>
              ) : null}
              {needsDate && schema && !incompatible ? (
                <p className="text-sm text-muted-foreground">
                  Detectará vencimientos con el campo{" "}
                  {detected.dateField ?? "de fecha"}.
                </p>
              ) : null}
              {isPluginKind ? (
                <p className="text-sm text-muted-foreground">
                  Vista diseñada por la extensión. Se mostrará con tus permisos.
                </p>
              ) : null}
              {schema && !needsDate && !isPluginKind ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="widget-status">Agrupar por</Label>
                    <Select value={statusField} onValueChange={setStatusField}>
                      <SelectTrigger id="widget-status" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={AUTO}>
                          Automático
                          {detected.statusField
                            ? ` (${detected.statusField})`
                            : ""}
                        </SelectItem>
                        {dropdownFields.map((field) => (
                          <SelectItem key={field.name} value={field.name}>
                            {field.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="widget-amount">Sumar campo</Label>
                    <Select value={amountField} onValueChange={setAmountField}>
                      <SelectTrigger id="widget-amount" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={AUTO}>
                          Automático
                          {detected.amountField
                            ? ` (${detected.amountField})`
                            : ""}
                        </SelectItem>
                        {numericFields.map((field) => (
                          <SelectItem key={field.name} value={field.name}>
                            {field.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ) : null}
              <div className="space-y-2">
                <Label htmlFor="widget-limit">Elementos visibles</Label>
                <Select value={limit} onValueChange={setLimit}>
                  <SelectTrigger id="widget-limit" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="3">3</SelectItem>
                    <SelectItem value="5">5</SelectItem>
                    <SelectItem value="8">8</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {selected ? (
                <p className="text-sm text-muted-foreground">
                  Vista previa:{" "}
                  {kind === "summary"
                    ? "resumen"
                    : kind === "items"
                      ? "elementos"
                      : kind === "chart"
                        ? "gráfica"
                        : kind === "actions"
                          ? "acciones"
                          : (pluginOptions.find(
                              (option) =>
                                `plugin:${option.extensionId}:${option.id}` ===
                                kind,
                            )?.title.es ?? "extensión")}{" "}
                  de {selected.label}.
                </p>
              ) : null}
            </>
          )}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={() => void save()}
            disabled={
              saving ||
              (source === "system"
                ? !canSaveSystem
                : !collection || incompatible)
            }
          >
            {saving ? <LoaderCircle className="animate-spin" /> : null}
            Agregar widget
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
