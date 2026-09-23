import { useMessages, translateMessage } from "@/i18n/core";
import { studioMessages } from "@/i18n/locales/studio";
import {
  useMemo,
  useCallback,
  useState,
  useRef,
  useEffect,
  Fragment,
} from "react";
import { useDesigner } from "@form-eng/designer";
import { Button } from "@/components/ui/button";
import { ChevronDown, Copy, GripVertical, Trash2, Zap } from "lucide-react";
import {
  buildGroupedFieldOrder,
  designerFieldDragType,
  designerPaletteDragType,
  isDesignerFieldDrag,
  isPaletteFieldDrag,
  landDurationMs,
  mountGroupedDesignerDragGhost,
  readPaletteFieldType,
  resolveDropInsert,
  resolvedSectionId,
  type DropInsert,
} from "./designer-field-dnd";
import {
  lookupActionButtonSummary,
  lookupActionEventsSummary,
  resolveRequestActionLabel,
  type RequestPageConfig,
} from "@savia/studio-shared/request-page";
import { resolveFieldLabel } from "@savia/studio-shared/metadata";
import type { Condition } from "@savia/studio-shared/rules";
import { FieldTypeIcon, fieldTypeLabel } from "./field-type-icons";
import { useFieldLabelLocale } from "./localized-field-label-editor";

function zoneKey(sectionId: string) {
  return sectionId || "unassigned";
}

function fieldTypeMeta(
  field: { type: string; required?: boolean },
  locale: import("@/i18n/app-locale").AppLocale,
) {
  const parts = [fieldTypeLabel(field.type, locale)];
  if (field.required)
    parts.push(translateMessage(studioMessages, "Obligatorio", locale));
  return parts.join(" · ");
}

function DropInsertIndicator({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <li className="grouped-designer-insert-indicator" aria-hidden="true">
      <span className="grouped-designer-insert-indicator-line" />
    </li>
  );
}

export function GroupedDesignerCanvas({
  sections,
  requestPage,
  onPaletteDrop,
}: {
  sections: { id: string; label: string; visibleWhen?: Condition }[];
  requestPage?: RequestPageConfig;
  onPaletteDrop?: (
    type: string,
    sectionId: string,
    beforeFieldId?: string,
  ) => void;
}) {
  const t = useMessages(studioMessages);
  const labelLocale = useFieldLabelLocale();
  const {
    state,
    setSelected,
    reorderFields,
    updateField,
    duplicateField,
    removeField,
  } = useDesigner();
  const [draggingFieldId, setDraggingFieldId] = useState<string | null>(null);
  const [paletteDragActive, setPaletteDragActive] = useState(false);
  const [dropTargetZoneId, setDropTargetZoneId] = useState<string | null>(null);
  const [dropInsert, setDropInsert] = useState<DropInsert | null>(null);
  const [landedFieldId, setLandedFieldId] = useState<string | null>(null);
  const [openZones, setOpenZones] = useState<Set<string>>(() => new Set());
  const dragGhostRef = useRef<HTMLElement | null>(null);
  const landTimerRef = useRef<number | null>(null);
  const zoneListRefs = useRef<Map<string, HTMLUListElement>>(new Map());

  const sectionIds = useMemo(
    () => new Set(sections.map((section) => section.id)),
    [sections],
  );

  const groups = useMemo(() => {
    const hasUnassigned = state.fieldOrder.some((name) => {
      const field = state.fields[name];
      if (!field) return false;
      const section = field.config?.section;
      return typeof section !== "string" || !sectionIds.has(section);
    });
    const base = sections.map((section) => ({
      id: section.id,
      label: section.label,
    }));
    if (!hasUnassigned) return base;
    return [...base, { id: "", label: t("Sin sección") }];
  }, [sectionIds, sections, state.fieldOrder, state.fields, t]);

  const fieldsBySection = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const section of sections) map.set(section.id, []);
    map.set("", []);
    for (const name of state.fieldOrder) {
      const field = state.fields[name];
      if (!field) continue;
      const resolved = resolvedSectionId(state.fields, name, sectionIds);
      const bucket = map.get(resolved);
      if (bucket) bucket.push(name);
      else map.get("")!.push(name);
    }
    return map;
  }, [sectionIds, sections, state.fieldOrder, state.fields]);

  useEffect(() => {
    setOpenZones(new Set(groups.map((group) => zoneKey(group.id))));
  }, [groups]);

  const assignSection = useCallback(
    (fieldId: string, sectionId: string | undefined) => {
      const current = resolvedSectionId(state.fields, fieldId, sectionIds);
      const next = sectionId || undefined;
      if (current === next) return false;
      updateField(fieldId, {
        config: {
          ...state.fields[fieldId].config,
          section: next,
        },
      });
      return true;
    },
    [sectionIds, state.fields, updateField],
  );

  const moveField = useCallback(
    (sourceId: string, zoneId: string, beforeId?: string) => {
      const currentSection = resolvedSectionId(
        state.fields,
        sourceId,
        sectionIds,
      );
      const nextOrder = buildGroupedFieldOrder(
        state.fieldOrder,
        state.fields,
        sourceId,
        zoneId,
        sectionIds,
        beforeId,
      );
      const orderChanged =
        nextOrder.length !== state.fieldOrder.length ||
        nextOrder.some((id, index) => id !== state.fieldOrder[index]);
      const sectionChanged = currentSection !== zoneId;

      if (!orderChanged && !sectionChanged) return;

      if (sectionChanged) {
        assignSection(sourceId, zoneId || undefined);
      }
      if (orderChanged) {
        reorderFields(nextOrder);
      }
    },
    [assignSection, reorderFields, sectionIds, state.fieldOrder, state.fields],
  );

  useEffect(() => {
    zoneListRefs.current.forEach((list) => {
      list?.querySelectorAll("[data-field-id]").forEach((node) => {
        const element = node as HTMLElement;
        element.style.transform = "";
        element.style.transition = "";
      });
    });
  }, [state.fieldOrder]);

  const acceptDrag = useCallback((event: React.DragEvent) => {
    if (
      isDesignerFieldDrag(event.dataTransfer) ||
      isPaletteFieldDrag(event.dataTransfer)
    ) {
      event.preventDefault();
      event.dataTransfer.dropEffect = isDesignerFieldDrag(event.dataTransfer)
        ? "move"
        : "copy";
    }
  }, []);

  const clearDragState = useCallback(() => {
    setDraggingFieldId(null);
    setPaletteDragActive(false);
    setDropTargetZoneId(null);
    setDropInsert(null);
    dragGhostRef.current?.remove();
    dragGhostRef.current = null;
  }, []);

  const expandZone = useCallback((sectionId: string) => {
    setOpenZones((current) => new Set(current).add(zoneKey(sectionId)));
  }, []);

  const isCanvasDragActive = paletteDragActive || draggingFieldId !== null;

  const updateDropInsert = useCallback(
    (
      event: React.DragEvent<HTMLElement>,
      sectionId: string,
      fieldIds: string[],
    ) => {
      acceptDrag(event);
      if (!isPaletteFieldDrag(event.dataTransfer) && !draggingFieldId) return;
      if (isPaletteFieldDrag(event.dataTransfer)) setPaletteDragActive(true);
      setDropTargetZoneId(sectionId);
      expandZone(sectionId);
      const { beforeFieldId } = resolveDropInsert(
        event.currentTarget,
        event.clientY,
        fieldIds,
        draggingFieldId,
      );
      setDropInsert({ sectionId, beforeFieldId });
    },
    [acceptDrag, draggingFieldId, expandZone],
  );

  const insertBeforeFieldId = useCallback(
    (sectionId: string) => {
      if (!isCanvasDragActive || dropInsert?.sectionId !== sectionId) {
        return undefined;
      }
      return dropInsert.beforeFieldId ?? undefined;
    },
    [dropInsert, isCanvasDragActive],
  );

  const handlePaletteDrop = useCallback(
    (event: React.DragEvent, sectionId: string, beforeFieldId?: string) => {
      const type = readPaletteFieldType(event.dataTransfer);
      if (!type || !isPaletteFieldDrag(event.dataTransfer) || !onPaletteDrop) {
        return false;
      }
      event.preventDefault();
      event.stopPropagation();
      expandZone(sectionId);
      onPaletteDrop(type, sectionId, beforeFieldId);
      clearDragState();
      return true;
    },
    [clearDragState, expandZone, onPaletteDrop],
  );

  const markLanded = useCallback((fieldId: string) => {
    setLandedFieldId(fieldId);
    if (landTimerRef.current) window.clearTimeout(landTimerRef.current);
    landTimerRef.current = window.setTimeout(() => {
      setLandedFieldId(null);
      landTimerRef.current = null;
    }, landDurationMs);
  }, []);

  const toggleZone = useCallback((sectionId: string) => {
    const key = zoneKey(sectionId);
    setOpenZones((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  useEffect(() => {
    const finishPaletteDrag = () => {
      setPaletteDragActive(false);
      setDropTargetZoneId(null);
      setDropInsert(null);
    };
    document.addEventListener("dragend", finishPaletteDrag);
    return () => document.removeEventListener("dragend", finishPaletteDrag);
  }, []);

  const isZoneOpen = useCallback(
    (sectionId: string) =>
      openZones.has(zoneKey(sectionId)) ||
      ((draggingFieldId !== null || paletteDragActive) &&
        dropTargetZoneId === sectionId),
    [draggingFieldId, dropTargetZoneId, openZones, paletteDragActive],
  );

  const startDrag = useCallback(
    (fieldId: string, event: React.DragEvent<HTMLButtonElement>) => {
      event.dataTransfer.setData(designerFieldDragType, fieldId);
      event.dataTransfer.effectAllowed = "move";
      setDraggingFieldId(fieldId);

      const field = state.fields[fieldId];
      const card = event.currentTarget.closest(".grouped-designer-field-card");
      if (!field || !(card instanceof HTMLElement)) return;

      const typeIcon = card.querySelector(".grouped-designer-field-type-icon");
      dragGhostRef.current = mountGroupedDesignerDragGhost({
        label: resolveFieldLabel(field, labelLocale),
        meta: fieldTypeMeta(field, labelLocale),
        typeIconHtml: typeIcon instanceof HTMLElement ? typeIcon.innerHTML : "",
        dataTransfer: event.dataTransfer,
      });
    },
    [labelLocale, state.fields],
  );

  return (
    <div
      className={[
        "dfd-canvas wizard-step-zones-wrap grouped-designer-zones-wrap",
        paletteDragActive ? "grouped-designer-zones-wrap--palette-drag" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={t("Campos del formulario por sección")}
      onDragEnter={(event) => {
        if (isPaletteFieldDrag(event.dataTransfer)) setPaletteDragActive(true);
      }}
      onDragOver={acceptDrag}
      onDrop={(event) => {
        if (event.target !== event.currentTarget) return;
        handlePaletteDrop(event, "");
      }}
    >
      <div className="wizard-step-zones grouped-designer-zones">
        {groups.map((group) => {
          const ids = fieldsBySection.get(group.id) ?? [];
          const key = zoneKey(group.id);
          const sectionMeta = sections.find(
            (section) => section.id === group.id,
          );
          return (
            <details
              key={key}
              role="region"
              className={[
                group.id
                  ? "wizard-step-zone grouped-designer-zone"
                  : "wizard-step-zone grouped-designer-zone wizard-step-zone--unassigned",
                draggingFieldId && dropTargetZoneId === group.id
                  ? "wizard-step-zone--drop-target"
                  : "",
                isCanvasDragActive && dropTargetZoneId === group.id
                  ? "wizard-step-zone--palette-drop-target"
                  : "",
                isCanvasDragActive ? "wizard-step-zone--dragging" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              open={isZoneOpen(group.id)}
              aria-label={`${group.label} (${ids.length} ${
                ids.length === 1 ? t("campo") : t("campos")
              })`}
              onDragEnter={(event) => {
                if (
                  !isDesignerFieldDrag(event.dataTransfer) &&
                  !isPaletteFieldDrag(event.dataTransfer)
                ) {
                  return;
                }
                if (isPaletteFieldDrag(event.dataTransfer)) {
                  setPaletteDragActive(true);
                }
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
                setDropInsert((current) =>
                  current?.sectionId === group.id ? null : current,
                );
              }}
              onDragOver={(event) => {
                acceptDrag(event);
                if (
                  !isDesignerFieldDrag(event.dataTransfer) &&
                  !isPaletteFieldDrag(event.dataTransfer)
                ) {
                  return;
                }
                if (isPaletteFieldDrag(event.dataTransfer)) {
                  setPaletteDragActive(true);
                }
                setDropTargetZoneId(group.id);
                expandZone(group.id);
                if (
                  !(event.target as HTMLElement).closest(
                    ".grouped-designer-zone-list",
                  )
                ) {
                  setDropInsert({ sectionId: group.id, beforeFieldId: null });
                }
              }}
              onDrop={(event) => {
                const beforeFieldId = insertBeforeFieldId(group.id);
                if (handlePaletteDrop(event, group.id, beforeFieldId)) return;
                const fieldId = event.dataTransfer.getData(
                  designerFieldDragType,
                );
                if (!fieldId || !isDesignerFieldDrag(event.dataTransfer)) {
                  return;
                }
                event.preventDefault();
                event.stopPropagation();
                expandZone(group.id);
                moveField(fieldId, group.id, beforeFieldId);
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
                  {sectionMeta?.visibleWhen ? t("· Condicional") : ""}
                </span>
              </summary>
              <div className="wizard-step-zone-body">
                {!ids.length && (
                  <p
                    className={[
                      "wizard-step-zone-empty",
                      isCanvasDragActive && dropTargetZoneId === group.id
                        ? "wizard-step-zone-empty--drop-target"
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {t("Arrastra campos aquí")}
                  </p>
                )}
                <ul
                  className="grouped-designer-zone-list"
                  ref={(node) => {
                    if (node) zoneListRefs.current.set(key, node);
                    else zoneListRefs.current.delete(key);
                  }}
                  onDragOver={(event) => updateDropInsert(event, group.id, ids)}
                  onDrop={(event) => {
                    const beforeFieldId = insertBeforeFieldId(group.id);
                    if (handlePaletteDrop(event, group.id, beforeFieldId))
                      return;
                    const fieldId = event.dataTransfer.getData(
                      designerFieldDragType,
                    );
                    if (!fieldId || !isDesignerFieldDrag(event.dataTransfer)) {
                      return;
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    moveField(fieldId, group.id, beforeFieldId);
                    markLanded(fieldId);
                    clearDragState();
                  }}
                >
                  {!ids.length ? (
                    <DropInsertIndicator
                      active={
                        isCanvasDragActive &&
                        dropInsert?.sectionId === group.id &&
                        dropInsert.beforeFieldId === null
                      }
                    />
                  ) : null}
                  {ids.map((id) => {
                    const field = state.fields[id];
                    if (!field) return null;
                    const displayLabel = resolveFieldLabel(field, labelLocale);
                    const sources =
                      requestPage?.actions.filter((action) =>
                        Object.hasOwn(action.output, id),
                      ) ?? [];
                    const queries =
                      requestPage?.actions.filter(
                        (action) =>
                          action.kind === "lookup" &&
                          Object.values(action.input)[0] === id,
                      ) ?? [];
                    return (
                      <Fragment key={id}>
                        <DropInsertIndicator
                          active={
                            isCanvasDragActive &&
                            dropInsert?.sectionId === group.id &&
                            dropInsert.beforeFieldId === id
                          }
                        />
                        <li>
                          <div
                            data-field-id={id}
                            className={[
                              "grouped-designer-field-card",
                              state.selectedFieldId === id
                                ? "grouped-designer-field-card--selected"
                                : "",
                              draggingFieldId === id
                                ? "grouped-designer-field-card--dragging"
                                : "",
                              landedFieldId === id
                                ? "grouped-designer-field-card--landed"
                                : "",
                              sources.length || queries.length
                                ? "grouped-designer-field-card--has-notes"
                                : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                          >
                            <button
                              type="button"
                              className="grouped-designer-field-grip"
                              draggable
                              aria-label={t("Arrastrar %{v1}", {
                                v1: displayLabel,
                              })}
                              onDragStart={(event) => startDrag(id, event)}
                              onDragEnd={clearDragState}
                            >
                              <GripVertical size={15} aria-hidden="true" />
                            </button>
                            <span
                              className="grouped-designer-field-type-icon"
                              aria-hidden="true"
                            >
                              <FieldTypeIcon type={field.type} size={14} />
                            </span>
                            <button
                              type="button"
                              className="grouped-designer-field-body"
                              aria-pressed={state.selectedFieldId === id}
                              onClick={() => setSelected(id)}
                            >
                              <span
                                className="grouped-designer-field-label"
                                title={displayLabel}
                              >
                                {displayLabel}
                              </span>
                              <span className="grouped-designer-field-meta">
                                {fieldTypeMeta(field, labelLocale)}
                              </span>
                            </button>
                            <div className="grouped-designer-field-actions">
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="size-7 shrink-0"
                                aria-label={t("Duplicar %{v1}", {
                                  v1: displayLabel,
                                })}
                                onClick={() => duplicateField(id)}
                              >
                                <Copy size={14} />
                              </Button>
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="size-7 shrink-0"
                                aria-label={t("Eliminar %{v1}", {
                                  v1: displayLabel,
                                })}
                                onClick={() => removeField(id)}
                              >
                                <Trash2 size={14} />
                              </Button>
                            </div>
                            {(sources.length > 0 || queries.length > 0) && (
                              <div className="grouped-designer-field-notes">
                                {sources.map((action) => {
                                  const actionLabel = resolveRequestActionLabel(
                                    action,
                                    labelLocale,
                                  );
                                  return (
                                    <span
                                      key={action.id}
                                      title={t("Se completa con %{v1}", {
                                        v1: actionLabel,
                                      })}
                                      className="grouped-designer-field-note grouped-designer-field-note--primary"
                                    >
                                      <Zap size={13} aria-hidden="true" />
                                      {t("Se completa con")} {actionLabel}
                                    </span>
                                  );
                                })}
                                {queries.map((action) => {
                                  const eventsSummary =
                                    lookupActionEventsSummary(action);
                                  return (
                                    <span
                                      key={action.id}
                                      className="grouped-designer-field-note"
                                    >
                                      <Zap size={13} aria-hidden="true" />
                                      {lookupActionButtonSummary(action)}
                                      {eventsSummary
                                        ? ` · ${eventsSummary}`
                                        : ""}
                                    </span>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </li>
                      </Fragment>
                    );
                  })}
                  <DropInsertIndicator
                    active={
                      ids.length > 0 &&
                      isCanvasDragActive &&
                      dropInsert?.sectionId === group.id &&
                      dropInsert.beforeFieldId === null
                    }
                  />
                </ul>
              </div>
            </details>
          );
        })}
      </div>
      {!state.fieldOrder.length && (
        <p className="grouped-designer-empty">
          {t("Agrega campos desde el panel izquierdo.")}
        </p>
      )}
    </div>
  );
}
