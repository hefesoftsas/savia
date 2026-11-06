import { useMessages } from "@/i18n/core";
import { studioMessages } from "@/i18n/locales/studio";
import { RequestMappingEditor } from "./request-mapping-editor";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDesigner } from "@form-eng/designer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ArrowDown, ArrowUp, Check, Plus, Trash2 } from "lucide-react";
import type { WizardConfig } from "@savia/studio-shared/metadata";
import {
  DistributionSettings,
  type StudioLayout,
} from "./distribution-settings";
import { RequestPageResultsEditor } from "./request-page-results-editor";
import { WizardStepAssignmentCanvas } from "./wizard-step-assignment-canvas";
import { StudioHelpTooltip } from "./studio-help-tooltip";
import "./wizard.css";

const SETUP_FLOW = [
  {
    id: "mode",
    title: "Modo del formulario",
    lede: "Elige si el usuario avanza por pasos o completa una sola pantalla.",
  },
  {
    id: "structure",
    title: "Pasos del wizard",
    lede: "Nombra cada paso y ordénalos. Dos pasos como mínimo.",
    wizardOnly: true,
  },
  {
    id: "assignment",
    title: "Campos por paso",
    lede: "Arrastra cada campo al paso donde debe aparecer.",
    wizardOnly: true,
  },
  {
    id: "layout",
    title: "Distribución",
    lede: "Columnas, secciones visuales y pipeline opcional.",
  },
  {
    id: "connections",
    title: "Conexiones",
    lede: "Conecta los campos con Savia Request y consulta sus respuestas guardadas.",
    requestPageOnly: true,
  },
  {
    id: "results",
    title: "Resultados",
    lede: "Columnas, etiquetas de cotización y botón principal de la pestaña Resultados.",
    requestPageOnly: true,
  },
] as const;

export default function StudioSettingsWizard({
  studio,
  setStudio,
  pageName,
}: {
  pageName?: string;
  studio: StudioLayout;
  setStudio: (studio: StudioLayout) => void;
}) {
  const t = useMessages(studioMessages);
  const { state, updateField } = useDesigner();
  const [activeIndex, setActiveIndex] = useState(0);
  const [visitedStepIds, setVisitedStepIds] = useState<Set<string>>(
    () => new Set(),
  );
  const headingRef = useRef<HTMLHeadingElement>(null);
  const wizard = studio.wizard;
  const fields = useMemo(
    () => state.fieldOrder.filter((name) => state.fields[name]),
    [state.fieldOrder, state.fields],
  );

  const flow = useMemo(
    () =>
      SETUP_FLOW.filter((step) => {
        if ("wizardOnly" in step && step.wizardOnly && !wizard?.enabled) {
          return false;
        }
        if (
          "requestPageOnly" in step &&
          step.requestPageOnly &&
          !studio.requestPage
        ) {
          return false;
        }
        return true;
      }),
    [studio.requestPage, wizard?.enabled],
  );

  const current = flow[activeIndex] ?? flow[0];

  useEffect(() => {
    if (activeIndex > flow.length - 1)
      setActiveIndex(Math.max(0, flow.length - 1));
  }, [activeIndex, flow.length]);

  useEffect(() => {
    const id = flow[activeIndex]?.id;
    if (!id) return;
    setVisitedStepIds((current) => new Set(current).add(id));
  }, [activeIndex, flow]);

  const setWizard = useCallback(
    (next: WizardConfig) => setStudio({ ...studio, wizard: next }),
    [setStudio, studio],
  );

  const enableWizard = useCallback(
    (enabled: boolean) => {
      if (wizard) {
        setWizard({ ...wizard, enabled });
        return;
      }
      const steps = [
        { id: "step_1", title: t("Datos principales"), description: "" },
        { id: "step_2", title: t("Detalles"), description: "" },
      ];
      fields.forEach((name, index) =>
        updateField(name, {
          config: {
            ...state.fields[name].config,
            step: index === 0 ? steps[0].id : steps[1].id,
          },
        }),
      );
      setWizard({ enabled, steps });
    },
    [fields, setWizard, state.fields, updateField, wizard, t],
  );

  const moveStep = useCallback(
    (index: number, offset: number) => {
      if (!wizard) return;
      const steps = [...wizard.steps];
      [steps[index], steps[index + offset]] = [
        steps[index + offset],
        steps[index],
      ];
      setWizard({ ...wizard, steps });
    },
    [setWizard, wizard],
  );

  const removeStep = useCallback(
    (id: string) => {
      if (!wizard || wizard.steps.length <= 2) return;
      const steps = wizard.steps.filter((step) => step.id !== id);
      fields
        .filter((name) => state.fields[name].config?.step === id)
        .forEach((name) =>
          updateField(name, {
            config: { ...state.fields[name].config, step: steps[0].id },
          }),
        );
      setWizard({ ...wizard, steps });
    },
    [fields, setWizard, state.fields, updateField, wizard, t],
  );

  function focusHeading() {
    requestAnimationFrame(() => headingRef.current?.focus());
  }

  function goToStep(index: number) {
    if (index < 0 || index >= flow.length || index === activeIndex) return;
    setActiveIndex(index);
    focusHeading();
  }

  return (
    <div className="studio-setup-shell">
      <aside
        className="studio-setup-rail"
        aria-label={t("Pasos de configuración")}
      >
        <p className="studio-setup-rail-label">{t("Configuración")}</p>
        <ol className="studio-setup-rail-list">
          {flow.map((step, index) => {
            const currentStep = index === activeIndex;
            const visited = visitedStepIds.has(step.id) && !currentStep;
            return (
              <li key={step.id}>
                <button
                  type="button"
                  className={[
                    "studio-setup-rail-step",
                    visited ? "studio-setup-rail-step--complete" : "",
                    currentStep ? "studio-setup-rail-step--current" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  aria-current={currentStep ? "step" : undefined}
                  onClick={() => goToStep(index)}
                >
                  <span className="studio-setup-rail-number" aria-hidden="true">
                    {visited ? <Check size={14} /> : index + 1}
                  </span>
                  <span className="studio-setup-rail-text">
                    {t(step.title)}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </aside>

      <div className="studio-setup-main">
        <header className="studio-setup-main-header">
          <p className="studio-setup-progress">
            {t("Paso")} {activeIndex + 1} {t("de")} {flow.length}
          </p>
          <div className="studio-setup-title-row">
            <h3 ref={headingRef} tabIndex={-1} className="studio-setup-title">
              {t(current.title)}
            </h3>
            <StudioHelpTooltip
              label={t("Ayuda sobre %{v1}", {
                v1: t(current.title).toLowerCase(),
              })}
            >
              {t(current.lede)}
            </StudioHelpTooltip>
          </div>
        </header>

        <div
          className={
            current.id === "assignment" ||
            current.id === "layout" ||
            current.id === "results"
              ? "studio-setup-panel studio-setup-panel--wide"
              : "studio-setup-panel"
          }
        >
          {current.id === "mode" && (
            <div className="studio-setup-mode">
              <div className="studio-settings-toggle studio-setup-toggle">
                <Switch
                  id="wizard-enabled"
                  aria-label={t("Activar wizard")}
                  checked={wizard?.enabled ?? false}
                  onCheckedChange={(enabled) => enableWizard(enabled)}
                />
                <label htmlFor="wizard-enabled">
                  {t("Formulario por pasos (wizard)")}
                </label>
              </div>
              {wizard?.enabled && (
                <label className="studio-control studio-setup-experience">
                  <span>{t("Experiencia")}</span>
                  <select
                    value={wizard.presentation ?? "conversation"}
                    onChange={(e) =>
                      setWizard({
                        ...wizard,
                        presentation: e.target.value as
                          "conversation" | "steps",
                      })
                    }
                  >
                    <option value="conversation">
                      {t("Una pregunta a la vez")}
                    </option>
                    <option value="steps">
                      {t("Campos agrupados por paso")}
                    </option>
                  </select>
                </label>
              )}
              {!wizard?.enabled && (
                <p className="studio-field-help studio-setup-mode-note">
                  {t(
                    "Sin wizard verás solo distribución y secciones en el siguiente paso.",
                  )}
                </p>
              )}
            </div>
          )}

          {current.id === "structure" && wizard?.enabled && (
            <div className="wizard-step-structure-list">
              {wizard.steps.map((step, index) => (
                <article key={step.id} className="wizard-step-structure-card">
                  <div className="wizard-step-structure-heading">
                    <strong>
                      {t("Paso")} {index + 1}
                    </strong>
                    <div className="wizard-step-config-actions">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-8"
                        aria-label={t("Subir paso %{v1}", { v1: index + 1 })}
                        disabled={index === 0}
                        onClick={() => moveStep(index, -1)}
                      >
                        <ArrowUp size={15} />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-8"
                        aria-label={t("Bajar paso %{v1}", { v1: index + 1 })}
                        disabled={index === wizard.steps.length - 1}
                        onClick={() => moveStep(index, 1)}
                      >
                        <ArrowDown size={15} />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-8"
                        aria-label={t("Eliminar paso %{v1}", { v1: index + 1 })}
                        disabled={wizard.steps.length <= 2}
                        onClick={() => removeStep(step.id)}
                      >
                        <Trash2 size={15} />
                      </Button>
                    </div>
                  </div>
                  <label className="studio-control">
                    <span>{t("Título")}</span>
                    <Input
                      maxLength={80}
                      value={step.title}
                      onChange={(e) =>
                        setWizard({
                          ...wizard,
                          steps: wizard.steps.map((item) =>
                            item.id === step.id
                              ? { ...item, title: e.target.value }
                              : item,
                          ),
                        })
                      }
                    />
                  </label>
                  <label className="studio-control">
                    <span>{t("Descripción (opcional)")}</span>
                    <Textarea
                      rows={2}
                      maxLength={300}
                      value={step.description ?? ""}
                      onChange={(e) =>
                        setWizard({
                          ...wizard,
                          steps: wizard.steps.map((item) =>
                            item.id === step.id
                              ? { ...item, description: e.target.value }
                              : item,
                          ),
                        })
                      }
                    />
                  </label>
                </article>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={wizard.steps.length >= 12}
                onClick={() =>
                  setWizard({
                    ...wizard,
                    steps: [
                      ...wizard.steps,
                      {
                        id: `step_${crypto.randomUUID().slice(0, 8)}`,
                        title: t("Paso %{v1}", { v1: wizard.steps.length + 1 }),
                        description: "",
                      },
                    ],
                  })
                }
              >
                <Plus size={15} />
                {t("Añadir paso")}
              </Button>
            </div>
          )}

          {current.id === "assignment" && wizard?.enabled && (
            <WizardStepAssignmentCanvas
              wizard={wizard}
              onChange={setWizard}
              view="assignment"
            />
          )}

          {current.id === "layout" && (
            <DistributionSettings
              studio={studio}
              setStudio={setStudio}
              fields={state.fields}
              fieldOrder={state.fieldOrder}
              onClearSection={(sectionId) => {
                Object.entries(state.fields).forEach(([name, field]) => {
                  if (field.config?.section === sectionId)
                    updateField(name, {
                      config: { ...field.config, section: undefined },
                    });
                });
              }}
            />
          )}

          {current.id === "connections" && studio.requestPage && (
            <RequestMappingEditor
              pageName={pageName}
              fields={state.fields}
              config={studio.requestPage}
              onChange={(requestPage) => setStudio({ ...studio, requestPage })}
            />
          )}
          {current.id === "results" && studio.requestPage && (
            <RequestPageResultsEditor
              config={studio.requestPage}
              onChange={(requestPage) => setStudio({ ...studio, requestPage })}
            />
          )}
        </div>
      </div>
    </div>
  );
}
