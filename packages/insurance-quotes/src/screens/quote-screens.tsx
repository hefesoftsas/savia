import { useEffect, useState } from "react";
import type { PluginApi } from "@savia/crm-shared/plugin-api";
import {
  mergeInsuranceSettings,
  type InsurancePackageSettings,
} from "../configuration";
import {
  APPLICANT_SOURCE_OPTIONS,
  defaultClientMapping,
} from "../client-mapping";
import { insuranceLookupFlowCatalog } from "../savia-request-bundle";
import { InsuranceQuoteWizard } from "./quote-wizard";
import "./quote-screens.css";

type ScreenProps = { savia: PluginApi };

function useInsuranceSettings(savia: PluginApi) {
  const [settings, setSettings] = useState<InsurancePackageSettings | null>(
    null,
  );
  const [version, setVersion] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    savia.settings
      .get<InsurancePackageSettings>()
      .then((snapshot) => {
        if (!active) return;
        setSettings(mergeInsuranceSettings(snapshot.value));
        setVersion(snapshot.version);
      })
      .catch(
        () =>
          active && setError("No se pudo cargar la configuración de Seguros."),
      );
    return () => {
      active = false;
    };
  }, [savia]);

  return { error, setError, settings, setSettings, version, setVersion };
}

function QuoteScreen({ savia, wizard }: ScreenProps & { wizard: boolean }) {
  const { error, settings } = useInsuranceSettings(savia);

  return (
    <>
      {error ? <p role="alert">{error}</p> : null}
      {!settings ? <p role="status">Cargando configuración…</p> : null}
      {settings ? <InsuranceQuoteWizard entry={wizard ? "wizard" : "direct"} savia={savia} settings={settings} /> : null}
    </>
  );
}

export function InsuranceQuoteWorkspaceScreen({ savia }: ScreenProps) {
  return <QuoteScreen savia={savia} wizard={false} />;
}

export function InsuranceQuoteWizardScreen({ savia }: ScreenProps) {
  return <QuoteScreen savia={savia} wizard />;
}

function ClientMappingPanel({
  savia,
  draft,
  updateDraft,
}: {
  savia: PluginApi;
  draft: InsurancePackageSettings;
  updateDraft: (
    change: (current: InsurancePackageSettings) => InsurancePackageSettings,
  ) => void;
}) {
  const [crmCollections, setCrmCollections] = useState<
    Array<{ name: string; label?: string }>
  >([]);
  const [collectionFields, setCollectionFields] = useState<string[]>([]);
  const mapping = draft.clientMapping;

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const list = await savia.collections.list();
        if (active && Array.isArray(list)) setCrmCollections(list);
      } catch {
        // Sin lista de colecciones: se usa entrada de texto.
      }
    })();
    return () => {
      active = false;
    };
  }, [savia]);

  useEffect(() => {
    let active = true;
    setCollectionFields([]);
    if (!mapping.collection.trim()) return;
    (async () => {
      try {
        const definition = await savia.collections
          .collection(mapping.collection.trim())
          .describe();
        const fields = (
          definition as
            | { config?: { fields?: Record<string, unknown> } }
            | undefined
        )?.config?.fields;
        if (active && fields && typeof fields === "object") {
          setCollectionFields(Object.keys(fields));
        }
      } catch {
        // Sin descripción: se escribe el campo a mano.
      }
    })();
    return () => {
      active = false;
    };
  }, [savia, mapping.collection]);

  const setMapping = (
    change: (
      current: InsurancePackageSettings["clientMapping"],
    ) => InsurancePackageSettings["clientMapping"],
  ) =>
    updateDraft((current) => ({
      ...current,
      clientMapping: change(current.clientMapping),
    }));

  const rows = Object.entries(mapping.fieldMap);

  return (
    <section className="insurance-admin__panel" aria-label="Mapeo de cliente">
      <div className="insurance-admin__panel-heading">
        <div>
          <h2>Mapeo de cliente</h2>
          <p className="insurance-admin__subtle">
            El paso Solicitante y conductor guarda o actualiza el cliente en
            esta colección al cotizar.
          </p>
        </div>
        <span
          className="insurance-admin__help"
          title="Colección destino y equivalencia de campos. El campo de coincidencia evita duplicados."
          aria-label="Ayuda sobre mapeo de cliente"
        >
          ?
        </span>
      </div>
      <div className="insurance-admin__lookup">
        <label className="insurance-admin__field">
          <span>Colección destino</span>
          {crmCollections.length > 0 ? (
            <select
              aria-label="Colección destino del cliente"
              value={mapping.collection}
              onChange={(event) =>
                setMapping((current) => ({
                  ...current,
                  collection: event.target.value,
                }))
              }
            >
              {!crmCollections.some(
                (collection) => collection.name === mapping.collection,
              ) ? (
                <option value={mapping.collection}>
                  {mapping.collection}
                </option>
              ) : null}
              {crmCollections.map((collection) => (
                <option key={collection.name} value={collection.name}>
                  {collection.label && collection.label !== collection.name
                    ? `${collection.label} (${collection.name})`
                    : collection.name}
                </option>
              ))}
            </select>
          ) : (
            <input
              aria-label="Colección destino del cliente"
              value={mapping.collection}
              onChange={(event) =>
                setMapping((current) => ({
                  ...current,
                  collection: event.target.value,
                }))
              }
              placeholder="Ej. clientes"
            />
          )}
        </label>
        <label className="insurance-admin__field">
          <span>Campo de coincidencia</span>
          <input
            aria-label="Campo de coincidencia"
            value={mapping.matchField}
            onChange={(event) =>
              setMapping((current) => ({
                ...current,
                matchField: event.target.value,
              }))
            }
            placeholder="Ej. documento"
            list="insurance-mapping-match-fields"
          />
          <datalist id="insurance-mapping-match-fields">
            {collectionFields.map((field) => (
              <option key={field} value={field} />
            ))}
          </datalist>
        </label>
      </div>
      <div className="insurance-mapping-rows" role="group" aria-label="Equivalencia de campos">
        {rows.map(([collectionField, source]) => (
          <div className="insurance-mapping-row" key={collectionField}>
            <label className="insurance-admin__field">
              <span>Campo en {mapping.collection || "la colección"}</span>
              <input
                aria-label="Campo de la colección"
                value={collectionField}
                onChange={(event) => {
                  const nextKey = event.target.value.trim();
                  if (!nextKey || nextKey === collectionField) return;
                  if (mapping.fieldMap[nextKey] !== undefined) return;
                  setMapping((current) => {
                    const next: Record<string, string> = {};
                    for (const [key, value] of Object.entries(
                      current.fieldMap,
                    )) {
                      next[key === collectionField ? nextKey : key] = value;
                    }
                    return { ...current, fieldMap: next };
                  });
                }}
                list="insurance-mapping-collection-fields"
                placeholder="Ej. telefono"
              />
            </label>
            <label className="insurance-admin__field">
              <span>Campo del solicitante</span>
              <select
                aria-label={`Origen para ${collectionField}`}
                value={source}
                onChange={(event) =>
                  setMapping((current) => ({
                    ...current,
                    fieldMap: {
                      ...current.fieldMap,
                      [collectionField]: event.target.value,
                    },
                  }))
                }
              >
                {!APPLICANT_SOURCE_OPTIONS.some(
                  (option) => option.value === source,
                ) ? (
                  <option value={source}>{source}</option>
                ) : null}
                {APPLICANT_SOURCE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              aria-label={`Quitar mapeo de ${collectionField}`}
              className="insurance-mapping-remove"
              onClick={() =>
                setMapping((current) => {
                  const next = { ...current.fieldMap };
                  delete next[collectionField];
                  return { ...current, fieldMap: next };
                })
              }
              title={`Quitar mapeo de ${collectionField}`}
              type="button"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <datalist id="insurance-mapping-collection-fields">
        {collectionFields.map((field) => (
          <option key={field} value={field} />
        ))}
      </datalist>
      <div className="insurance-mapping-footer">
        <button
          className="insurance-mapping-add"
          onClick={() =>
            setMapping((current) => {
              let index = Object.keys(current.fieldMap).length + 1;
              let key = `campo-${index}`;
              while (current.fieldMap[key] !== undefined) {
                index += 1;
                key = `campo-${index}`;
              }
              return {
                ...current,
                fieldMap: { ...current.fieldMap, [key]: "firstName" },
              };
            })
          }
          title="Agregar una equivalencia de campo"
          type="button"
        >
          + Agregar campo
        </button>
        <button
          className="insurance-mapping-reset"
          onClick={() =>
            setMapping(() => ({
              ...defaultClientMapping,
              fieldMap: { ...defaultClientMapping.fieldMap },
            }))
          }
          title="Volver al mapeo de Clientes por defecto"
          type="button"
        >
          Restablecer
        </button>
      </div>
    </section>
  );
}

export function InsurancePackageAdminScreen({ savia }: ScreenProps) {
  const { error, settings, setError, setSettings, setVersion, version } =
    useInsuranceSettings(savia);
  const [draft, setDraft] = useState<InsurancePackageSettings | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  const saveSettings = async () => {
    if (!draft) return;
    setSavingSettings(true);
    setError("");
    try {
      const snapshot = await savia.settings.replace(draft, version);
      const next = mergeInsuranceSettings(snapshot.value);
      setSettings(next);
      setDraft(next);
      setVersion(snapshot.version);
    } catch {
      setError(
        "La configuración cambió. Recarga la página e intenta nuevamente.",
      );
    } finally {
      setSavingSettings(false);
    }
  };

  const updateDraft = (change: (current: InsurancePackageSettings) => InsurancePackageSettings) => {
    setDraft((current) => (current ? change(current) : current));
  };

  const moveProduct = (id: string, direction: -1 | 1) =>
    updateDraft((current) => {
      const ordered = [...current.products].sort((left, right) => left.rank - right.rank);
      const index = ordered.findIndex((product) => product.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= ordered.length) return current;
      const source = ordered[index];
      const destination = ordered[target];
      return {
        ...current,
        products: current.products.map((product) =>
          product.id === source.id
            ? { ...product, rank: destination.rank }
            : product.id === destination.id
              ? { ...product, rank: source.rank }
              : product,
        ),
      };
    });

  return (
    <main className="extension-policy-screen" aria-label="Administrar Seguros">
      <header className="extension-policy-heading">
        <div>
          <p className="extension-policy-eyebrow">Seguros</p>
          <h1>Administrar Seguros</h1>
          <p className="extension-policy-empty">
            Controla qué se cotiza en este tenant.
          </p>
        </div>
      </header>
      {error ? (
        <p className="extension-policy-error" role="alert">
          {error}
        </p>
      ) : null}
      {!settings ? (
        <p className="extension-policy-empty" role="status">
          Cargando configuración…
        </p>
      ) : null}
      {draft ? (
        <div className="insurance-admin">
          <section
            className="insurance-admin__panel"
            aria-label="Disponibilidad del paquete"
          >
            <div className="insurance-admin__panel-heading">
              <div>
                <h2>Pantallas</h2>
              </div>
              <span
                className="insurance-admin__help"
                title="Los cambios se aplican al guardar."
                aria-label="Ayuda sobre pantallas"
              >
                ?
              </span>
            </div>
            <div className="insurance-admin__toggles">
              <label>
                <input
                  type="checkbox"
                  checked={draft.quotePages.direct}
                  onChange={(event) =>
                    updateDraft((current) => ({
                      ...current,
                      quotePages: {
                        ...current.quotePages,
                        direct: event.target.checked,
                      },
                    }))
                  }
                />
                <span>Cotizador</span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={draft.quotePages.wizard}
                  onChange={(event) =>
                    updateDraft((current) => ({
                      ...current,
                      quotePages: {
                        ...current.quotePages,
                        wizard: event.target.checked,
                      },
                    }))
                  }
                />
                <span>Cotizador por pasos</span>
              </label>
            </div>
          </section>

          <section className="insurance-admin__panel" aria-label="Productos">
            <div className="insurance-admin__panel-heading">
              <div>
                <h2>Productos</h2>
              </div>
              <span
                className="insurance-admin__help"
                title="Los productos activos se ejecutan juntos al cotizar. Usa las flechas para ordenar las tarjetas."
                aria-label="Ayuda sobre productos"
              >
                ?
              </span>
            </div>
            <details className="insurance-admin__products-disclosure">
              <summary>
                {draft.products.filter((product) => product.enabled).length} de {draft.products.length} activos
              </summary>
              <div className="insurance-admin__products">
                {[...draft.products].sort((left, right) => left.rank - right.rank).map((product, index) => (
                  <article key={product.id} className="insurance-admin__product">
                    <label className="insurance-admin__product-name">
                      <input
                        type="checkbox"
                        checked={product.enabled}
                        onChange={(event) =>
                          updateDraft((current) => ({
                            ...current,
                            products: current.products.map((item) =>
                              item.id === product.id
                                ? { ...item, enabled: event.target.checked }
                                : item,
                            ),
                          }))
                        }
                      />
                      <span>{product.label}</span>
                    </label>
                    <div className="insurance-admin__product-actions">
                      <button aria-label={`Subir ${product.label}`} disabled={index === 0} onClick={() => moveProduct(product.id, -1)} title="Subir" type="button">↑</button>
                      <button aria-label={`Bajar ${product.label}`} disabled={index === draft.products.length - 1} onClick={() => moveProduct(product.id, 1)} title="Bajar" type="button">↓</button>
                    </div>
                  </article>
                ))}
              </div>
            </details>
          </section>

          <ClientMappingPanel
            savia={savia}
            draft={draft}
            updateDraft={updateDraft}
          />

          <section className="insurance-admin__panel" aria-label="Consulta de placa">
            <div className="insurance-admin__panel-heading">
              <div>
                <h2>Consulta de placa</h2>
              </div>
            </div>
            <div className="insurance-admin__lookup">
              <label>
                <input
                  type="checkbox"
                  checked={draft.vehicleLookup.enabled}
                  onChange={(event) =>
                    updateDraft((current) => ({
                      ...current,
                      vehicleLookup: {
                        ...current.vehicleLookup,
                        enabled: event.target.checked,
                      },
                    }))
                  }
                />
                <span>Habilitar consulta</span>
              </label>
              <label className="insurance-admin__field">
                <span>Flow de consulta de placa</span>
                <select
                  aria-label="Flow de consulta de placa"
                  value={draft.vehicleLookup.flowId}
                  onChange={(event) =>
                    updateDraft((current) => ({
                      ...current,
                      vehicleLookup: {
                        ...current.vehicleLookup,
                        flowId: event.target.value as InsurancePackageSettings["vehicleLookup"]["flowId"],
                      },
                    }))
                  }
                >
                  {insuranceLookupFlowCatalog.map((flow) => (
                    <option key={flow.id} value={flow.id}>
                      {flow.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="insurance-admin__actions">
              <button
                type="button"
                onClick={() => void saveSettings()}
                disabled={savingSettings}
                title={
                  savingSettings
                    ? "Guardando la configuración…"
                    : "Guardar productos, mapeo de cliente y consulta de placa"
                }
              >
                {savingSettings ? "Guardando…" : "Guardar cambios"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
