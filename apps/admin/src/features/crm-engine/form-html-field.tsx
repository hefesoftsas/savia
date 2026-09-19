import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useFormContext } from "react-hook-form";
import type { IFieldProps } from "@form-eng/core";
import type { CrmObject } from "@savia/crm-shared/metadata";
import {
  buildFormHtmlRuntimeContext,
  renderFormHtmlTemplate,
  resolveFormHtml,
  resolveSavinaSetValueAction,
  runFormHtmlScript,
  sanitizeFormHtml,
} from "@savia/crm-shared/form-html";
import { useFormTemplateValues } from "./use-form-template-values";
import "./form-html-field.css";

export function syncFormHtmlMarkup(
  node: HTMLElement,
  html: string,
  previousHtml: { current: string },
) {
  if (html === previousHtml.current) return false;
  node.innerHTML = html;
  previousHtml.current = html;
  return true;
}

export function FormHtmlField(p: IFieldProps) {
  const object = p.config?.studioObject as CrmObject | undefined;
  const values = useFormTemplateValues(object, p.fieldName);
  const { setValue } = useFormContext();
  const containerRef = useRef<HTMLDivElement>(null);
  const renderedHtmlRef = useRef("");
  const recordId =
    typeof p.config?.recordId === "string" ? p.config.recordId : undefined;
  const settings = resolveFormHtml(p.config as Record<string, unknown>);
  const [scriptError, setScriptError] = useState("");

  const setFieldValue = useCallback(
    (name: string, value: unknown) => {
      const fields = object?.config.fields ?? {};
      if (!Object.hasOwn(fields, name)) {
        const available = Object.keys(fields);
        throw new Error(
          available.length
            ? `Campo desconocido: ${name}. Disponibles: ${available.join(", ")}.`
            : `Campo desconocido: ${name}.`,
        );
      }
      setValue(name, value, {
        shouldDirty: true,
        shouldValidate: true,
        shouldTouch: true,
      });
    },
    [object, setValue],
  );

  const renderedHtml = useMemo(() => {
    if (!settings?.html.trim()) return "";
    return sanitizeFormHtml(
      renderFormHtmlTemplate(settings.html, {
        values,
        recordId,
        object: object
          ? { name: object.name, label: object.label }
          : undefined,
      }),
    );
  }, [object, recordId, settings?.html, values]);

  useLayoutEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    syncFormHtmlMarkup(node, renderedHtml, renderedHtmlRef);

    if (!settings?.script?.trim()) {
      setScriptError("");
      return;
    }

    if (!renderedHtml) {
      node.innerHTML = "";
      renderedHtmlRef.current = "";
    }

    try {
      runFormHtmlScript(
        settings.script,
        buildFormHtmlRuntimeContext({
          values,
          setValue: setFieldValue,
          object,
          recordId,
          container: node,
        }),
      );
      setScriptError("");
    } catch (error) {
      setScriptError((error as Error).message);
    }
  }, [
    object,
    recordId,
    renderedHtml,
    setFieldValue,
    settings?.script,
    values,
  ]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const handleClick = (event: Event) => {
      const action = resolveSavinaSetValueAction(event.target, values);
      if (!action || !node.contains(event.target as Node)) return;
      event.preventDefault();
      try {
        setFieldValue(action.field, action.value);
        setScriptError("");
      } catch (error) {
        setScriptError((error as Error).message);
      }
    };

    node.addEventListener("click", handleClick);
    return () => node.removeEventListener("click", handleClick);
  }, [setFieldValue, values]);

  if (!settings || (!settings.html.trim() && !settings.script?.trim())) {
    return (
      <p className="form-html-empty studio-field-help">
        Configura HTML o JavaScript en las propiedades del campo.
      </p>
    );
  }

  return (
    <div className="form-html-field" data-field={p.fieldName}>
      <div ref={containerRef} className="form-html-content" />
      {scriptError ? (
        <p className="form-html-error" role="alert">
          {scriptError}
        </p>
      ) : null}
    </div>
  );
}
