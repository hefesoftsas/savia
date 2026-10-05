import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { AppServices } from "@/app-services";
import type {
  WhatsappNativeAssets,
  WhatsappNativeConfiguration,
  WhatsappNativeReply,
  WhatsappNativeState,
} from "@/api/whatsapp-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IntegrationGroup } from "@/features/personal-integrations/integration-ui";

const flags = [
  ["replyButtons", "Respuestas con botones"],
  ["listMessages", "Mensajes de lista"],
  ["mediaUnderstanding", "Comprensión de medios"],
  ["readReceipts", "Confirmaciones de lectura"],
  ["typingIndicator", "Indicador de escritura"],
] as const;

const resourceEditors = [
  ["flows", "Flows (JSON; cada Flow incluye flowId y screen)"],
  ["catalogs", "Catálogos y productos (JSON)"],
  ["templates", "Plantillas aprobadas (JSON)"],
  ["media", "Medios subidos (JSON)"],
  ["locations", "Ubicaciones guardadas (JSON)"],
] as const;
const kindLabels: Record<WhatsappNativeReply["kind"], string> = {
  text: "Texto",
  buttons: "Botones",
  list: "Lista",
  flow: "Formulario",
  catalog: "Catálogo",
  media: "Medio",
  location: "Ubicación",
  template: "Plantilla",
};

type ResourceKey = (typeof resourceEditors)[number][0];
const initialJson = () => JSON.stringify([], null, 2);

function makeIdempotencyKey(): string {
  return globalThis.crypto.randomUUID();
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function mediaCategory(
  mimeType: string,
): "image" | "audio" | "video" | "document" {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  return "document";
}

export function WhatsappNativeSettings({
  services,
  tenantId,
}: {
  services: Pick<AppServices, "whatsapp">;
  tenantId: number;
}) {
  const [state, setState] = useState<WhatsappNativeState | null>(null);
  const [assets, setAssets] = useState<WhatsappNativeAssets | null>(null);
  const [rawResources, setRawResources] = useState<Record<ResourceKey, string>>(
    {
      flows: initialJson(),
      catalogs: initialJson(),
      templates: initialJson(),
      media: initialJson(),
      locations: initialJson(),
    },
  );
  const [flowSelection, setFlowSelection] = useState("");
  const [flowScreen, setFlowScreen] = useState("");
  const [templateSelection, setTemplateSelection] = useState("");
  const [to, setTo] = useState("");
  const [kind, setKind] = useState<WhatsappNativeReply["kind"]>("text");
  const [messageText, setMessageText] = useState("");
  const [resourceKey, setResourceKey] = useState("");
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [optionsJson, setOptionsJson] = useState(
    '[{"id":"option_1","title":"Opción 1"}]',
  );
  const [templateParameters, setTemplateParameters] = useState("");
  const [consent, setConsent] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setLoading(true);
    void services.whatsapp
      .getNative(tenantId)
      .then((next) => {
        if (!current) return;
        setState(next);
        setRawResources({
          flows: JSON.stringify(next.configuration.flows, null, 2),
          catalogs: JSON.stringify(next.configuration.catalogs, null, 2),
          templates: JSON.stringify(next.configuration.templates, null, 2),
          media: JSON.stringify(next.configuration.media, null, 2),
          locations: JSON.stringify(next.configuration.locations, null, 2),
        });
      })
      .catch((error: unknown) => {
        if (current)
          setFeedback(
            error instanceof Error
              ? error.message
              : "No se pudo cargar la configuración nativa.",
          );
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [services.whatsapp, tenantId]);

  const configuration = state?.configuration;
  const resourcesForKind = useMemo(() => {
    if (!configuration) return [];
    try {
      const resourceKeyByKind: Partial<
        Record<WhatsappNativeReply["kind"], ResourceKey>
      > = {
        flow: "flows",
        catalog: "catalogs",
        template: "templates",
        media: "media",
        location: "locations",
      };
      const resourceKey = resourceKeyByKind[kind];
      return resourceKey
        ? (JSON.parse(rawResources[resourceKey]) as Array<{
            key: string;
            label: string;
            products?: Array<{ id: string; label: string }>;
          }>)
        : [];
    } catch {
      return [];
    }
  }, [configuration, kind, rawResources]);

  const selectedCatalog =
    kind === "catalog"
      ? resourcesForKind.find((resource) => resource.key === resourceKey)
      : undefined;

  function parsedConfiguration(): WhatsappNativeConfiguration {
    if (!configuration)
      throw new Error("La configuración aún no está cargada.");
    const parsed = { ...configuration };
    for (const [key] of resourceEditors) {
      const value: unknown = JSON.parse(rawResources[key]);
      if (!Array.isArray(value))
        throw new Error(`${key} debe ser una lista JSON.`);
      parsed[key] = value as never;
    }
    return parsed;
  }

  async function save() {
    if (!configuration || busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      const saved = await services.whatsapp.updateNative({
        agencyId: tenantId,
        configuration: parsedConfiguration(),
      });
      setState({ ...state!, configuration: saved, configured: true });
      setFeedback("Configuración nativa guardada para este tenant.");
    } catch (error) {
      setFeedback(
        error instanceof Error
          ? error.message
          : "No se pudo guardar la configuración.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function loadAssets() {
    setBusy(true);
    setFeedback(null);
    try {
      setAssets(await services.whatsapp.listNativeAssets(tenantId));
      setFeedback("Se cargaron los recursos publicados disponibles en Meta.");
    } catch (error) {
      setFeedback(
        error instanceof Error
          ? error.message
          : "No se pudieron cargar los recursos de Meta.",
      );
    } finally {
      setBusy(false);
    }
  }

  function addPublishedFlow() {
    const selected = assets?.flows.find((flow) => flow.id === flowSelection);
    if (!selected || !flowScreen.trim()) return;
    try {
      const current = JSON.parse(
        rawResources.flows,
      ) as WhatsappNativeConfiguration["flows"];
      const key = slug(selected.name) || `flow-${selected.id}`;
      setRawResources((value) => ({
        ...value,
        flows: JSON.stringify(
          [
            ...current.filter((flow) => flow.key !== key),
            {
              key,
              label: selected.name,
              flowId: selected.id,
              screen: flowScreen.trim(),
            },
          ],
          null,
          2,
        ),
      }));
      setFeedback(
        `Flow publicado “${selected.name}” añadido. Confirma el screen ID antes de guardar.`,
      );
    } catch {
      setFeedback("Corrige primero el JSON de Flows.");
    }
  }

  function addPublishedTemplate() {
    const selected = assets?.templates.find(
      (template) => template.id === templateSelection,
    );
    if (!selected?.supported || selected.status.toUpperCase() !== "APPROVED")
      return;
    try {
      const current = JSON.parse(
        rawResources.templates,
      ) as WhatsappNativeConfiguration["templates"];
      const key = `${slug(selected.name)}-${selected.language.toLowerCase()}`;
      setRawResources((value) => ({
        ...value,
        templates: JSON.stringify(
          [
            ...current.filter((template) => template.key !== key),
            {
              key,
              label: selected.name,
              name: selected.name,
              language: selected.language,
              parameterCount: selected.parameterCount,
            },
          ],
          null,
          2,
        ),
      }));
      setFeedback(`Plantilla aprobada “${selected.name}” añadida.`);
    } catch {
      setFeedback("Corrige primero el JSON de plantillas.");
    }
  }

  async function uploadMedia() {
    if (!file || busy) return;
    setBusy(true);
    try {
      const uploaded = await services.whatsapp.uploadNativeMedia(
        tenantId,
        file,
      );
      const current = JSON.parse(
        rawResources.media,
      ) as WhatsappNativeConfiguration["media"];
      const key = slug(file.name) || `media-${uploaded.mediaId}`;
      setRawResources((value) => ({
        ...value,
        media: JSON.stringify(
          [
            ...current,
            {
              key,
              label: file.name,
              mediaId: uploaded.mediaId,
              type: mediaCategory(uploaded.type),
              filename: uploaded.filename,
            },
          ],
          null,
          2,
        ),
      }));
      setFeedback(
        "Medio subido. Guarda la configuración para registrarlo como recurso del tenant.",
      );
      setFile(null);
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : "No se pudo subir el archivo.",
      );
    } finally {
      setBusy(false);
    }
  }

  function downloadFlow(flowJson: unknown, title: string) {
    const blob = new Blob([JSON.stringify(flowJson, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${slug(title) || "whatsapp-flow"}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function sendNativeTest() {
    if (!to.trim() || busy) return;
    setBusy(true);
    setConsent(false);
    setFeedback(null);
    try {
      let reply: WhatsappNativeReply;
      if (kind === "text") reply = { kind, text: messageText.trim() };
      else if (kind === "buttons")
        reply = {
          kind,
          text: messageText.trim(),
          options: JSON.parse(optionsJson),
        };
      else if (kind === "list")
        reply = {
          kind,
          text: messageText.trim(),
          buttonLabel: "Ver opciones",
          options: JSON.parse(optionsJson),
        };
      else if (kind === "flow")
        reply = { kind, text: messageText.trim(), resourceKey };
      else if (kind === "catalog")
        reply = {
          kind,
          text: messageText.trim(),
          resourceKey,
          productIds: selectedProductIds,
        };
      else if (kind === "media")
        reply = { kind, resourceKey, caption: messageText.trim() || undefined };
      else if (kind === "location") reply = { kind, resourceKey };
      else
        reply = {
          kind,
          resourceKey,
          parameters: templateParameters
            .split("\n")
            .filter((item) => item.length > 0),
        };
      const result = await services.whatsapp.sendNativeMessage({
        agencyId: tenantId,
        to: to.trim(),
        reply,
        idempotencyKey: makeIdempotencyKey(),
        consent,
      });
      setFeedback(`Mensaje nativo aceptado (${result.messageId}).`);
    } catch (error) {
      setFeedback(
        error instanceof Error
          ? error.message
          : "No se pudo enviar la prueba nativa.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (loading)
    return (
      <IntegrationGroup title="Capacidades nativas de WhatsApp">
        <li className="px-5 py-4 text-sm text-muted-foreground">
          Cargando configuración del tenant…
        </li>
      </IntegrationGroup>
    );
  if (!state || !configuration)
    return (
      <IntegrationGroup title="Capacidades nativas de WhatsApp">
        <li className="px-5 py-4 text-sm" role="status">
          {feedback ?? "No se pudo cargar la configuración."}
        </li>
      </IntegrationGroup>
    );

  return (
    <IntegrationGroup title="Capacidades nativas de WhatsApp">
      <li className="space-y-5 px-5 py-4">
        <p className="text-sm text-muted-foreground">
          Configuración aislada por tenant. Las capacidades se envían solo al
          pulsar una acción de prueba y requieren consentimiento explícito.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {flags.map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={configuration[key]}
                onChange={(event) => {
                  const enabled = event.target.checked;
                  setState({
                    ...state,
                    configuration: {
                      ...configuration,
                      [key]: enabled,
                      ...(key === "typingIndicator" && enabled
                        ? { readReceipts: true }
                        : {}),
                    },
                  });
                }}
                disabled={
                  busy ||
                  (key === "readReceipts" && configuration.typingIndicator)
                }
              />
              {label}
            </label>
          ))}
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          Imágenes y PDF requieren que el modelo del asistente admita visión y
          archivos. Para transcribir audio, configura un modelo compatible en{" "}
          <Link
            className="font-medium text-primary underline"
            to="/assistant-configuration"
          >
            Configurar transcripción
          </Link>
          .
        </p>

        <div className="space-y-3 rounded-lg border p-3">
          <div>
            <h3 className="text-sm font-medium">Recursos publicados de Meta</h3>
            <p className="text-xs text-muted-foreground">
              Carga solo recursos reales disponibles para el número conectado;
              los cambios no se guardan hasta pulsar Guardar.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void loadAssets()}
            disabled={busy}
          >
            Cargar recursos de Meta
          </Button>
          {assets ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="block text-xs">
                  Flows publicados
                  <select
                    className="mt-1 h-9 w-full rounded-md border bg-background px-2"
                    value={flowSelection}
                    onChange={(event) => setFlowSelection(event.target.value)}
                  >
                    <option value="">Selecciona un Flow</option>
                    {assets.flows.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} · {item.status}
                      </option>
                    ))}
                  </select>
                </label>
                <Input
                  aria-label="Pantalla final del Flow"
                  placeholder="Screen ID final"
                  value={flowScreen}
                  onChange={(event) => setFlowScreen(event.target.value)}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={addPublishedFlow}
                  disabled={!flowSelection || !flowScreen.trim()}
                >
                  Añadir Flow publicado
                </Button>
              </div>
              <div className="space-y-2">
                <label className="block text-xs">
                  Plantillas aprobadas
                  <select
                    className="mt-1 h-9 w-full rounded-md border bg-background px-2"
                    value={templateSelection}
                    onChange={(event) =>
                      setTemplateSelection(event.target.value)
                    }
                  >
                    <option value="">Selecciona una plantilla</option>
                    {assets.templates
                      .filter(
                        (item) =>
                          item.supported &&
                          item.status.toUpperCase() === "APPROVED",
                      )
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} · {item.language}
                        </option>
                      ))}
                  </select>
                </label>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={addPublishedTemplate}
                  disabled={!templateSelection}
                >
                  Añadir plantilla aprobada
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        {resourceEditors.map(([key, label]) => (
          <label key={key} className="block text-sm">
            <span className="mb-1 block font-medium">{label}</span>
            <textarea
              className="min-h-24 w-full rounded-md border bg-background px-3 py-2 font-mono text-xs"
              value={rawResources[key]}
              onChange={(event) =>
                setRawResources({ ...rawResources, [key]: event.target.value })
              }
              disabled={busy}
              spellCheck={false}
            />
          </label>
        ))}
        <div className="flex flex-wrap items-center gap-2">
          <input
            aria-label="Archivo de medio"
            type="file"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            disabled={busy}
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => void uploadMedia()}
            disabled={!file || busy}
          >
            Subir medio
          </Button>
          <Button size="sm" onClick={() => void save()} disabled={busy}>
            {busy ? "Procesando…" : "Guardar configuración nativa"}
          </Button>
        </div>

        {state.contributions.length > 0 ? (
          <div className="space-y-2 rounded-lg border p-3">
            <h3 className="text-sm font-medium">
              Flows aportados por soluciones
            </h3>
            {state.contributions.map((item) => (
              <div
                key={`${item.pluginId}:${item.bundleId}`}
                className="flex flex-wrap items-center justify-between gap-2 text-sm"
              >
                <span>
                  {item.title}{" "}
                  <span className="text-xs text-muted-foreground">
                    {item.pluginId} · {item.solutionId}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => downloadFlow(item.flowJson, item.title)}
                >
                  Descargar Flow JSON
                </Button>
              </div>
            ))}
          </div>
        ) : null}

        <div className="space-y-3 rounded-lg border p-3">
          <div>
            <h3 className="text-sm font-medium">Probar mensaje nativo</h3>
            <p className="text-xs text-muted-foreground">
              El envío requiere consentimiento marcado y genera una clave de
              idempotencia nueva. No se envía al guardar configuración.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Destino</span>
              <Input
                value={to}
                onChange={(event) => {
                  setTo(event.target.value);
                  setConsent(false);
                }}
                placeholder="+573001234567"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Tipo</span>
              <select
                className="h-9 w-full rounded-md border bg-background px-3"
                value={kind}
                onChange={(event) => {
                  setKind(event.target.value as WhatsappNativeReply["kind"]);
                  setResourceKey("");
                  setSelectedProductIds([]);
                  setMessageText("");
                }}
              >
                {[
                  "text",
                  "buttons",
                  "list",
                  "flow",
                  "catalog",
                  "media",
                  "location",
                  "template",
                ].map((value) => (
                  <option key={value} value={value}>
                    {kindLabels[value as WhatsappNativeReply["kind"]]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {["text", "buttons", "list", "flow", "catalog"].includes(kind) && (
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Texto</span>
              <Input
                value={messageText}
                onChange={(event) => setMessageText(event.target.value)}
                placeholder="Mensaje de prueba"
              />
            </label>
          )}
          {kind === "media" && (
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Caption (opcional)</span>
              <Input
                value={messageText}
                onChange={(event) => setMessageText(event.target.value)}
                placeholder="Descripción del medio"
              />
            </label>
          )}
          {(kind === "buttons" || kind === "list") && (
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Opciones (JSON)</span>
              <textarea
                className="min-h-20 w-full rounded-md border bg-background px-3 py-2 font-mono text-xs"
                value={optionsJson}
                onChange={(event) => setOptionsJson(event.target.value)}
              />
            </label>
          )}
          {["flow", "catalog", "media", "location", "template"].includes(
            kind,
          ) && (
            <label className="block text-sm">
              <span className="mb-1 block font-medium">
                Recurso configurado
              </span>
              <select
                className="h-9 w-full rounded-md border bg-background px-3"
                value={resourceKey}
                onChange={(event) => {
                  setResourceKey(event.target.value);
                  setSelectedProductIds([]);
                }}
              >
                <option value="">Selecciona un recurso</option>
                {resourcesForKind.map((resource) => (
                  <option key={resource.key} value={resource.key}>
                    {resource.label} ({resource.key})
                  </option>
                ))}
              </select>
            </label>
          )}
          {kind === "catalog" && selectedCatalog?.products ? (
            <label className="block text-sm">
              <span className="mb-1 block font-medium">
                Productos del catálogo
              </span>
              <select
                aria-label="Productos del catálogo"
                className="min-h-20 w-full rounded-md border bg-background px-3 py-2"
                multiple
                value={selectedProductIds}
                onChange={(event) =>
                  setSelectedProductIds(
                    Array.from(
                      event.currentTarget.selectedOptions,
                      (option) => option.value,
                    ),
                  )
                }
              >
                {selectedCatalog.products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.label} ({product.id})
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {kind === "template" && (
            <label className="block text-sm">
              <span className="mb-1 block font-medium">
                Parámetros (uno por línea)
              </span>
              <textarea
                className="min-h-16 w-full rounded-md border bg-background px-3 py-2"
                value={templateParameters}
                onChange={(event) => setTemplateParameters(event.target.value)}
              />
            </label>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />
            Confirmo consentimiento del destinatario para este mensaje de prueba
          </label>
          <Button
            size="sm"
            variant="outline"
            disabled={
              busy ||
              !consent ||
              !to.trim() ||
              (kind !== "text" &&
                !resourceKey &&
                !["buttons", "list"].includes(kind)) ||
              (kind === "catalog" && selectedProductIds.length === 0)
            }
            onClick={() => void sendNativeTest()}
          >
            Enviar prueba nativa
          </Button>
        </div>
        {feedback ? (
          <p role="status" className="text-sm">
            {feedback}
          </p>
        ) : null}
      </li>
    </IntegrationGroup>
  );
}
