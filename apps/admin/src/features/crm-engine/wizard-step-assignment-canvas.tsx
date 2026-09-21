import { fieldTypeLabel } from "./field-type-icons";
import { useMessages, useAppLocale } from "@/i18n/core";
import { studioMessages } from "@/i18n/locales/studio";
import {
  useMemo,
  useCallback,
  useState,
  useRef,
  useLayoutEffect,
  useEffect,
} from "react";
import { useDesigner } from "@form-eng/designer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowUp,
  ArrowDown,
  ChevronDown,
  GripVertical,
  Trash2,
} from "lucide-react";
import type { WizardConfig } from "@savia/crm-shared/metadata";

const dragType = "application/x-savia-wizard-step-field";
const landDurationMs = 420;
const flipDurationMs = 280;

function zoneKey(stepId: string) {
  return stepId || "unassigned";
}

function fieldStepId(step: unknown, stepIds: Set<string>): string | undefined {
  return typeof step === "string" && stepIds.has(step) ? step : undefined;
}

function resolvedStepId(
  fields: Record<string, { config?: { step?: string } }>,
  fieldId: string,
  stepIds: Set<string>,
): string {
  return fieldStepId(fields[fieldId]?.config?.step, stepIds) ?? "";
}

export function buildWizardStepFieldOrder(
  fieldOrder: string[],
  fields: Record<string, { config?: { step?: string } }>,
  sourceId: string,
  targetStepId: string,
  stepIds: Set<string>,
  beforeId?: string,
): string[] {
  const order = fieldOrder.filter((id) => id !== sourceId);
  let insertAt = order.length;

  if (beforeId) {
    const targetIndex = order.indexOf(beforeId);
    insertAt = targetIndex < 0 ? order.length : targetIndex;
  } else {
    let lastInStep = -1;
    order.forEach((id, index) => {
      if (resolvedStepId(fields, id, stepIds) === targetStepId) {
        lastInStep = index;
      }
    });
    if (lastInStep >= 0) insertAt = lastInStep + 1;
  }

  order.splice(insertAt, 0, sourceId);
  return order;
}

function playFlip(
  list: HTMLUListElement,
  before: Map<string, DOMRect>,
  reducedMotion: boolean,
) {
  if (reducedMotion) return;

  list.querySelectorAll("[data-field-id]").forEach((node) => {
    const id = node.getAttribute("data-field-id");
    if (!id || !before.has(id)) return;

    const first = before.get(id)!;
    const last = node.getBoundingClientRect();
    const dx = first.left - last.left;
    const dy = first.top - last.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;

    const element = node as HTMLElement;
    element.style.transition = "none";
    element.style.transform = `translate(${dx}px, ${dy}px)`;
    requestAnimationFrame(() => {
      element.style.transition = `transform ${flipDurationMs}ms cubic-bezier(0.16, 1, 0.3, 1)`;
      element.style.transform = "";
      const onEnd = () => {
        element.style.transition = "";
        element.removeEventListener("transitionend", onEnd);
      };
      element.addEventListener("transitionend", onEnd);
    });
  });
}

function captureZonePositions(list: HTMLUListElement | null) {
  const positions = new Map<string, DOMRect>();
  if (!list) return positions;
  list.querySelectorAll("[data-field-id]").forEach((node) => {
    const id = node.getAttribute("data-field-id");
    if (id) positions.set(id, node.getBoundingClientRect());
  });
  return positions;
}

export function WizardStepAssignmentCanvas({
  wizard,
  onChange,
  view = "full",
}: {
  wizard: WizardConfig;
  onChange: (wizard: WizardConfig) => void;
  view?: "full" | "assignment";
}) {
  const t = useMessages(studioMessages);
  const locale = useAppLocale();
  const { state, updateField, reorderFields } = useDesigner();
  const [draggingFieldId, setDraggingFieldId] = useState<string | null>(null);
  const [dropTargetZoneId, setDropTargetZoneId] = useState<string | null>(null);
  const [dropTargetFieldId, setDropTargetFieldId] = useState<string | null>(
    null,
  );
  const [landedFieldId, setLandedFieldId] = useState<string | null>(null);
  const [openZones, setOpenZones] = useState<Set<string>>(() => new Set());
  const dragGhostRef = useRef<HTMLElement | null>(null);
  const landTimerRef = useRef<number | null>(null);
  const zoneListRefs = useRef<Map<string, HTMLUListElement>>(new Map());
  const flipBeforeRef = useRef<Map<string, Map<string, DOMRect>>>(new Map());
  const flipZoneIdsRef = useRef<string[]>([]);
  const shouldFlipRef = useRef(false);
  const stepIds = useMemo(
    () => new Set(wizard.steps.map((step) => step.id)),
    [wizard.steps],
  );
  const visibleFields = useMemo(
    () =>
      state.fieldOrder.filter(
        (name) => state.fields[name] && !state.fields[name].hidden,
      ),
    [state.fieldOrder, state.fields],
  );
  const groups = useMemo(() => {
    const steps = wizard.steps.map((step, index) => ({
      id: step.id,
      index,
      label: `${index + 1}. ${step.title}`,
      step,
    }));
    const hasUnassigned = visibleFields.some(
      (name) => !fieldStepId(state.fields[name].config?.step, stepIds),
    );
    if (!hasUnassigned) return steps;
    return [
      ...steps,
      {
        id: "",
        index: -1,
        label: t("Sin paso"),
        step: null,
      },
    ];
  }, [wizard.steps, visibleFields, state.fields, stepIds, t]);

  useEffect(() => {
    if (view === "assignment") return;
    setOpenZones((current) => {
      const valid = new Set(groups.map((group) => zoneKey(group.id)));
      const kept = new Set([...current].filter((key) => valid.has(key)));
      if (kept.size) return kept;
      const first = groups.find((group) => group.id);
      return first ? new Set([zoneKey(first.id)]) : kept;
    });
  }, [groups, view]);

  const fieldsByStep = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const group of wizard.steps) {
      map.set(group.id, []);
    }
    map.set("", []);
    for (const name of visibleFields) {
      const resolved =
        fieldStepId(state.fields[name].config?.step, stepIds) ?? "";
      const bucket = map.get(resolved);
      if (bucket) bucket.push(name);
      else map.get("")!.push(name);
    }
    return map;
  }, [visibleFields, state.fields, stepIds, wizard.steps]);

  const assignStep = useCallback(
    (fieldId: string, stepId: string | undefined) => {
      const current = fieldStepId(state.fields[fieldId].config?.step, stepIds);
      const next = stepId || undefined;
      if (current === next) return false;
      updateField(fieldId, {
        config: {
          ...state.fields[fieldId].config,
          step: next,
        },
      });
      return true;
    },
    [state.fields, stepIds, updateField],
  );

  const captureFlip = useCallback((zoneIds: string[]) => {
    const unique = [...new Set(zoneIds)];
    const snapshot = new Map<string, Map<string, DOMRect>>();
    for (const zoneId of unique) {
      snapshot.set(
        zoneId,
        captureZonePositions(zoneListRefs.current.get(zoneId) ?? null),
      );
    }
    flipBeforeRef.current = snapshot;
    flipZoneIdsRef.current = unique;
    shouldFlipRef.current = true;
  }, []);

  const moveField = useCallback(
    (sourceId: string, zoneId: string, beforeId?: string) => {
      const currentStep = resolvedStepId(state.fields, sourceId, stepIds);
      const nextOrder = buildWizardStepFieldOrder(
        state.fieldOrder,
        state.fields,
        sourceId,
        zoneId,
        stepIds,
        beforeId,
      );
      const orderChanged =
        nextOrder.length !== state.fieldOrder.length ||
        nextOrder.some((id, index) => id !== state.fieldOrder[index]);
      const stepChanged = currentStep !== zoneId;

      if (!orderChanged && !stepChanged) return;

      captureFlip([currentStep, zoneId]);

      if (stepChanged) {
        assignStep(sourceId, zoneId || undefined);
      }
      if (orderChanged) {
        reorderFields(nextOrder);
      }
    },
    [
      assignStep,
      captureFlip,
      reorderFields,
      state.fieldOrder,
      state.fields,
      stepIds,
    ],
  );

  useLayoutEffect(() => {
    if (!shouldFlipRef.current) return;
    shouldFlipRef.current = false;

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    for (const zoneId of flipZoneIdsRef.current) {
      const list = zoneListRefs.current.get(zoneId);
      const before = flipBeforeRef.current.get(zoneId);
      if (list && before) playFlip(list, before, reducedMotion);
    }

    flipZoneIdsRef.current = [];
    flipBeforeRef.current = new Map();
  }, [state.fieldOrder, state.fields]);

  const acceptDrag = useCallback((event: React.DragEvent) => {
    if (event.dataTransfer.types.includes(dragType)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    }
  }, []);

  const clearDragState = useCallback(() => {
    setDraggingFieldId(null);
    setDropTargetZoneId(null);
    setDropTargetFieldId(null);
    dragGhostRef.current?.remove();
    dragGhostRef.current = null;
  }, []);

  const markLanded = useCallback((fieldId: string) => {
    setLandedFieldId(fieldId);
    if (landTimerRef.current) window.clearTimeout(landTimerRef.current);
    landTimerRef.current = window.setTimeout(() => {
      setLandedFieldId(null);
      landTimerRef.current = null;
    }, landDurationMs);
  }, []);

  const toggleZone = useCallback((stepId: string) => {
    const key = zoneKey(stepId);
    setOpenZones((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const expandZone = useCallback((stepId: string) => {
    setOpenZones((current) => new Set(current).add(zoneKey(stepId)));
  }, []);

  const isZoneOpen = useCallback(
    (stepId: string) =>
      openZones.has(zoneKey(stepId)) ||
      (draggingFieldId !== null && dropTargetZoneId === stepId),
    [draggingFieldId, dropTargetZoneId, openZones],
  );

  const startDrag = useCallback(
    (fieldId: string, event: React.DragEvent<HTMLButtonElement>) => {
      event.dataTransfer.setData(dragType, fieldId);
      event.dataTransfer.effectAllowed = "move";
      setDraggingFieldId(fieldId);

      const card = event.currentTarget.closest(".wizard-step-field-card");
      if (!(card instanceof HTMLElement)) return;

      const rect = card.getBoundingClientRect();
      const ghost = card.cloneNode(true) as HTMLElement;
      ghost.classList.add("wizard-step-field-card--drag-preview");
      ghost.style.width = `${rect.width}px`;
      ghost.style.position = "fixed";
      ghost.style.top = "-1000px";
      ghost.style.left = "0";
      ghost.style.pointerEvents = "none";
      document.body.appendChild(ghost);
      dragGhostRef.current = ghost;
      event.dataTransfer.setDragImage(
        ghost,
        Math.max(16, event.clientX - rect.left),
        Math.max(16, event.clientY - rect.top),
      );
    },
    [],
  );

  const moveStep = useCallback(
    (index: number, offset: number) => {
      const steps = [...wizard.steps];
      [steps[index], steps[index + offset]] = [
        steps[index + offset],
        steps[index],
      ];
      onChange({ ...wizard, steps });
    },
    [onChange, wizard],
  );

  const removeStep = useCallback(
    (id: string) => {
      if (wizard.steps.length <= 2) return;
      const steps = wizard.steps.filter((step) => step.id !== id);
      visibleFields
        .filter((name) => state.fields[name].config?.step === id)
        .forEach((name) =>
          updateField(name, {
            config: { ...state.fields[name].config, step: steps[0].id },
          }),
        );
      onChange({ ...wizard, steps });
    },
    [onChange, state.fields, updateField, visibleFields, wizard],
  );

  const assignmentOnly = view === "assignment";

  useEffect(() => {
    if (!assignmentOnly) return;
    setOpenZones(new Set(groups.map((group) => zoneKey(group.id))));
  }, [assignmentOnly, groups]);

  const showStepActions = !assignmentOnly;
  const showStepMeta = !assignmentOnly;

  return (
    <div
      className={
        assignmentOnly
          ? "wizard-step-zones-wrap wizard-step-zones-wrap--assignment"
          : "wizard-step-zones-wrap"
      }
    >
      <div
        className="wizard-step-zones"
        aria-label={t("Pasos del wizard y asignación de campos")}
      >
        {groups.map((group) => {
          const ids = fieldsByStep.get(group.id) ?? [];
          const key = zoneKey(group.id);
          return (
            <details
              key={key}
              role="region"
              className={[
                group.id
                  ? "wizard-step-zone"
                  : "wizard-step-zone wizard-step-zone--unassigned",
                draggingFieldId && dropTargetZoneId === group.id
                  ? "wizard-step-zone--drop-target"
                  : "",
                draggingFieldId ? "wizard-step-zone--dragging" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              open={isZoneOpen(group.id)}
              aria-label={t("%{v1} (%{v2} campos)", {
                v1: group.label,
                v2: ids.length,
              })}
              onDragEnter={(event) => {
                if (!event.dataTransfer.types.includes(dragType)) return;
                setDropTargetZoneId(group.id);
                expandZone(group.id);
              }}
              onDragLeave={(event) => {
                if (
                  event.currentTarget.contains(
                    event.relatedTarget as Node | null,
                  )
                ) {
                  return;
                }
                setDropTargetZoneId((current) =>
                  current === group.id ? null : current,
                );
              }}
              onDragOver={acceptDrag}
              onDrop={(event) => {
                const fieldId = event.dataTransfer.getData(dragType);
                if (!fieldId || !event.dataTransfer.types.includes(dragType)) {
                  return;
                }
                event.preventDefault();
                event.stopPropagation();
                expandZone(group.id);
                moveField(fieldId, group.id);
                markLanded(fieldId);
                clearDragState();
              }}
            >
              <summary
                className="wizard-step-zone-summary"
                onClick={(event) => {
                  event.preventDefault();
                  toggleZone(group.id);
                }}
              >
                <ChevronDown
                  size={16}
                  className="wizard-step-zone-chevron"
                  aria-hidden="true"
                />
                <span className="wizard-step-zone-title-text">
                  {group.label}
                </span>
                <span className="wizard-step-zone-count">
                  {ids.length} {ids.length === 1 ? t("campo") : t("campos")}
                </span>
                {showStepActions && group.step && (
                  <div
                    className="wizard-step-zone-actions"
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                  >
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      aria-label={t("Subir paso %{v1}", {
                        v1: group.index + 1,
                      })}
                      disabled={group.index === 0}
                      onClick={() => moveStep(group.index, -1)}
                    >
                      <ArrowUp size={14} />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      aria-label={t("Bajar paso %{v1}", {
                        v1: group.index + 1,
                      })}
                      disabled={group.index === wizard.steps.length - 1}
                      onClick={() => moveStep(group.index, 1)}
                    >
                      <ArrowDown size={14} />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      aria-label={t("Eliminar paso %{v1}", {
                        v1: group.index + 1,
                      })}
                      disabled={wizard.steps.length <= 2}
                      onClick={() => removeStep(group.id)}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                )}
              </summary>
              <div className="wizard-step-zone-body">
                {showStepMeta && group.step && (
                  <div className="wizard-step-zone-meta">
                    <label className="studio-control wizard-step-zone-title-field">
                      <span className="sr-only">
                        {t("Título del paso")} {group.index + 1}
                      </span>
                      <Input
                        aria-label={t("Título del paso %{v1}", {
                          v1: group.index + 1,
                        })}
                        maxLength={80}
                        value={group.step.title}
                        onChange={(event) =>
                          onChange({
                            ...wizard,
                            steps: wizard.steps.map((step) =>
                              step.id === group.id
                                ? { ...step, title: event.target.value }
                                : step,
                            ),
                          })
                        }
                      />
                    </label>
                    <details className="wizard-step-zone-desc">
                      <summary>{t("Descripción (opcional)")}</summary>
                      <Textarea
                        rows={2}
                        maxLength={300}
                        value={group.step.description ?? ""}
                        onChange={(event) =>
                          onChange({
                            ...wizard,
                            steps: wizard.steps.map((step) =>
                              step.id === group.id
                                ? { ...step, description: event.target.value }
                                : step,
                            ),
                          })
                        }
                      />
                    </details>
                  </div>
                )}
                {!ids.length && (
                  <p className="wizard-step-zone-empty">
                    {t("Arrastra campos aquí")}
                  </p>
                )}
                <ul
                  className="wizard-step-zone-list"
                  ref={(node) => {
                    if (node) zoneListRefs.current.set(key, node);
                    else zoneListRefs.current.delete(key);
                  }}
                >
                  {ids.map((name) => {
                    const field = state.fields[name];
                    const current =
                      fieldStepId(field.config?.step, stepIds) ?? "";
                    return (
                      <li
                        key={name}
                        data-field-id={name}
                        className={
                          draggingFieldId &&
                          dropTargetFieldId === name &&
                          draggingFieldId !== name
                            ? "wizard-step-field-drop-target"
                            : undefined
                        }
                        onDragEnter={(event) => {
                          if (!event.dataTransfer.types.includes(dragType))
                            return;
                          if (draggingFieldId && draggingFieldId !== name) {
                            setDropTargetFieldId(name);
                            setDropTargetZoneId(group.id);
                          }
                        }}
                        onDragOver={acceptDrag}
                        onDrop={(event) => {
                          const fieldId = event.dataTransfer.getData(dragType);
                          if (
                            !fieldId ||
                            !event.dataTransfer.types.includes(dragType) ||
                            fieldId === name
                          ) {
                            return;
                          }
                          event.preventDefault();
                          event.stopPropagation();
                          moveField(fieldId, group.id, name);
                          markLanded(fieldId);
                          clearDragState();
                        }}
                      >
                        <div
                          className={[
                            "wizard-step-field-card",
                            draggingFieldId === name
                              ? "wizard-step-field-card--dragging"
                              : "",
                            landedFieldId === name
                              ? "wizard-step-field-card--landed"
                              : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          tabIndex={0}
                        >
                          <div className="wizard-step-field-card-row">
                            <button
                              type="button"
                              className="wizard-step-field-grip"
                              draggable
                              aria-label={t("Arrastrar %{v1}", {
                                v1: field.label,
                              })}
                              onDragStart={(event) => startDrag(name, event)}
                              onDragEnd={clearDragState}
                            >
                              <GripVertical size={15} aria-hidden="true" />
                            </button>
                            <div className="wizard-step-field-card-body">
                              <span className="wizard-step-field-card-label">
                                {field.label}
                              </span>
                              <span className="wizard-step-field-card-meta">
                                {fieldTypeLabel(field.type, locale)}
                                {field.required ? t("· Obligatorio") : ""}
                              </span>
                            </div>
                          </div>
                          <select
                            className="wizard-step-field-move"
                            aria-label={t("Mover %{v1} a paso", {
                              v1: field.label,
                            })}
                            value={current}
                            onChange={(event) => {
                              assignStep(name, event.target.value || undefined);
                              markLanded(name);
                            }}
                          >
                            <option value="">{t("Sin paso")}</option>
                            {wizard.steps.map((step, index) => (
                              <option key={step.id} value={step.id}>
                                {index + 1}. {step.title}
                              </option>
                            ))}
                          </select>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}
