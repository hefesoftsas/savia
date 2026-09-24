import { useMessages } from "@/i18n/core";
import { studioMessages } from "@/i18n/locales/studio";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import type { Condition } from "@savia/studio-shared/rules";
import { RuleEditor } from "./rule-editor";
import { StudioHelpTooltip } from "./studio-help-tooltip";
import "./form-sections-editor.css";

export type FormSection = {
  id: string;
  label: string;
  visibleWhen?: Condition;
};

const dragType = "application/x-savia-form-section";

function SectionLayoutPreview({
  label,
  fieldCount,
}: {
  label: string;
  fieldCount: number;
}) {
  const t = useMessages(studioMessages);
  const slots = Math.max(2, Math.min(fieldCount || 2, 3));

  return (
    <div aria-hidden="true" className="section-layout-preview">
      <div className="section-layout-preview-title">
        {label.trim() || t("Nombre de sección")}
      </div>
      <div className="section-layout-preview-fields">
        {Array.from({ length: slots }, (_, index) => (
          <span
            key={index}
            className={
              fieldCount === 0 || index >= fieldCount
                ? "is-placeholder"
                : undefined
            }
          />
        ))}
      </div>
    </div>
  );
}

export function reorderSections(
  sections: FormSection[],
  sourceId: string,
  beforeId?: string,
): FormSection[] {
  const source = sections.find((section) => section.id === sourceId);
  if (!source) return sections;

  const next = sections.filter((section) => section.id !== sourceId);
  let insertAt = next.length;

  if (beforeId) {
    const targetIndex = next.findIndex((section) => section.id === beforeId);
    insertAt = targetIndex < 0 ? next.length : targetIndex;
  }

  next.splice(insertAt, 0, source);
  return next;
}

export function FormSectionsEditor({
  sections,
  onChange,
  fieldCountsBySectionId,
  onClearSection,
  fields,
}: {
  sections: FormSection[];
  onChange: (sections: FormSection[]) => void;
  fieldCountsBySectionId: Record<string, number>;
  onClearSection: (sectionId: string) => void;
  fields: Record<string, { type: string; label: string }>;
}) {
  const t = useMessages(studioMessages);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  function updateSection(id: string, patch: Partial<FormSection>) {
    onChange(
      sections.map((section) =>
        section.id === id ? { ...section, ...patch } : section,
      ),
    );
  }

  function removeSection(id: string) {
    onChange(sections.filter((section) => section.id !== id));
    onClearSection(id);
  }

  function addSection() {
    onChange([
      ...sections,
      {
        id: `section_${Date.now()}`,
        label: t("Sección %{v1}", { v1: sections.length + 1 }),
      },
    ]);
  }

  function finishDrag() {
    setDraggingId(null);
    setDropTargetId(null);
  }

  function handleDrop(sourceId: string, beforeId?: string) {
    if (!sourceId || sourceId === beforeId) {
      finishDrag();
      return;
    }
    onChange(reorderSections(sections, sourceId, beforeId));
    finishDrag();
  }

  return (
    <fieldset className="form-sections-editor">
      <legend className="studio-fieldset-legend-with-help">
        {t("Secciones visuales del formulario")}
        <StudioHelpTooltip label={t("Ayuda sobre secciones visuales")}>
          {t(
            "Crea títulos que agrupan campos en el formulario. Puedes mostrar cada sección solo cuando se cumpla una condición. Arrastra para reordenar; asigna campos desde la pestaña Diseñar.",
          )}
        </StudioHelpTooltip>
      </legend>

      {sections.length === 0 ? (
        <div className="form-sections-empty">
          <SectionLayoutPreview label="" fieldCount={0} />
          <p>
            {t(
              "Sin secciones todavía. El formulario mostrará los campos sin agrupar.",
            )}
          </p>
          <Button
            size="sm"
            variant="outline"
            type="button"
            onClick={addSection}
          >
            <Plus size={14} />
            {t("Agregar sección")}
          </Button>
        </div>
      ) : (
        <ul
          className="form-sections-list"
          aria-label={t("Secciones del formulario")}
        >
          {sections.map((section, index) => {
            const fieldCount = fieldCountsBySectionId[section.id] ?? 0;
            const isDragging = draggingId === section.id;
            const isDropTarget =
              dropTargetId === section.id && draggingId !== section.id;

            return (
              <li
                key={section.id}
                className={[
                  "form-section-card",
                  isDragging ? "form-section-card--dragging" : "",
                  isDropTarget ? "form-section-card--drop-target" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onDragOver={(event) => {
                  if (!event.dataTransfer.types.includes(dragType)) return;
                  event.preventDefault();
                  setDropTargetId(section.id);
                }}
                onDragLeave={(event) => {
                  if (event.currentTarget.contains(event.relatedTarget as Node))
                    return;
                  setDropTargetId((current) =>
                    current === section.id ? null : current,
                  );
                }}
                onDrop={(event) => {
                  const sourceId = event.dataTransfer.getData(dragType);
                  if (!sourceId) return;
                  event.preventDefault();
                  event.stopPropagation();
                  handleDrop(sourceId, section.id);
                }}
              >
                <div className="form-section-card-toolbar">
                  <button
                    type="button"
                    className="form-section-drag-handle"
                    draggable
                    aria-label={t("Reordenar sección %{v1}", {
                      v1: section.label,
                    })}
                    onDragStart={(event) => {
                      event.dataTransfer.setData(dragType, section.id);
                      event.dataTransfer.effectAllowed = "move";
                      setDraggingId(section.id);
                    }}
                    onDragEnd={finishDrag}
                  >
                    <GripVertical size={16} aria-hidden="true" />
                  </button>
                  <span className="form-section-card-index">{index + 1}</span>
                  <span className="form-section-card-count">
                    {fieldCount === 1
                      ? t("1 campo")
                      : t("%{v1} campos", { v1: fieldCount })}
                    {section.visibleWhen ? t("· Condicional") : ""}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="form-section-card-remove size-8 shrink-0"
                    type="button"
                    aria-label={t("Quitar sección %{v1}", {
                      v1: section.label,
                    })}
                    onClick={() => removeSection(section.id)}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>

                <Input
                  aria-label={t("Nombre de sección %{v1}", { v1: index + 1 })}
                  value={section.label}
                  onChange={(event) =>
                    updateSection(section.id, { label: event.target.value })
                  }
                />

                <RuleEditor
                  label={t("Mostrar sección cuando")}
                  value={section.visibleWhen}
                  fields={fields}
                  onChange={(visibleWhen) =>
                    updateSection(section.id, { visibleWhen })
                  }
                />

                <SectionLayoutPreview
                  label={section.label}
                  fieldCount={fieldCount}
                />
              </li>
            );
          })}
          {draggingId && (
            <li
              className={[
                "form-sections-drop-end",
                dropTargetId === "__end__"
                  ? "form-sections-drop-end--active"
                  : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onDragOver={(event) => {
                if (!event.dataTransfer.types.includes(dragType)) return;
                event.preventDefault();
                setDropTargetId("__end__");
              }}
              onDragLeave={(event) => {
                if (event.currentTarget.contains(event.relatedTarget as Node))
                  return;
                setDropTargetId((current) =>
                  current === "__end__" ? null : current,
                );
              }}
              onDrop={(event) => {
                const sourceId = event.dataTransfer.getData(dragType);
                if (!sourceId) return;
                event.preventDefault();
                handleDrop(sourceId);
              }}
            >
              {t("Suelta aquí para mover al final")}
            </li>
          )}
        </ul>
      )}

      {sections.length > 0 && (
        <Button size="sm" variant="outline" type="button" onClick={addSection}>
          <Plus size={14} />
          {t("Agregar sección")}
        </Button>
      )}
    </fieldset>
  );
}
