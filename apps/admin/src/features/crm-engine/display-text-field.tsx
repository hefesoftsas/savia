import { useMemo, type HTMLAttributes } from "react";
import type { IFieldProps } from "@form-eng/core";
import type { CrmObject } from "@savia/crm-shared/metadata";
import {
  displayTextVariantLabels,
  renderDisplayTextContent,
  resolveDisplayText,
  type DisplayTextVariant,
} from "@savia/crm-shared/display-text";
import { useFormTemplateValues } from "./use-form-template-values";
import "./display-text-field.css";

const variantTags = {
  title: "h2",
  subtitle: "h3",
  span: "p",
  caption: "p",
  help: "p",
} as const satisfies Record<DisplayTextVariant, "h2" | "h3" | "p">;

function DisplayTextBody({
  variant,
  className,
  children,
  ...props
}: HTMLAttributes<HTMLElement> & {
  variant: DisplayTextVariant;
  children: string;
}) {
  const Tag = variantTags[variant];
  return (
    <Tag className={className} {...props}>
      {children}
    </Tag>
  );
}

export function DisplayTextField(p: IFieldProps) {
  const object = p.config?.studioObject as CrmObject | undefined;
  const recordId =
    typeof p.config?.recordId === "string" ? p.config.recordId : undefined;
  const settings = resolveDisplayText(p.config as Record<string, unknown>);
  const values = useFormTemplateValues(object, p.fieldName);

  const text = useMemo(() => {
    const content = settings?.content.trim() || p.label || "";
    if (!content) return "";
    return renderDisplayTextContent(content, {
      values,
      recordId,
      object: object
        ? { name: object.name, label: object.label }
        : undefined,
    });
  }, [object, p.label, recordId, settings?.content, values]);

  if (!settings) {
    return (
      <p className="display-text-empty studio-field-help">
        Configura el texto en las propiedades del campo.
      </p>
    );
  }

  const variant = settings.variant;
  const align = settings.align ?? "left";
  const className = [
    "display-text-field",
    `display-text-field--${variant}`,
    `display-text-field--align-${align}`,
  ].join(" ");

  return (
    <DisplayTextBody
      variant={variant}
      className={className}
      data-field={p.fieldName}
      data-variant={variant}
      aria-label={displayTextVariantLabels[variant]}
    >
      {text || "\u00a0"}
    </DisplayTextBody>
  );
}
