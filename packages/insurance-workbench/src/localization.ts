import { useCallback } from "react";
import { usePluginLocale } from "@savia/crm-shared/plugin-locale-react";
import { localizeExternalError, translatePluginMessage, type PluginLocale, type PluginMessages, type PluginMessageParams } from "@savia/crm-shared/plugin-localization";
import { messages } from "./messages";
import type { Field, WorkbenchConfig } from "./types";

export type WorkbenchTranslator = (caption: string, params?: PluginMessageParams) => string;
export function createWorkbenchTranslator(catalog: PluginMessages, locale: PluginLocale): WorkbenchTranslator {
  return (caption, params) => {
    const source: PluginMessages = Object.hasOwn(catalog, caption) ? catalog : messages;
    return Object.hasOwn(source, caption) ? translatePluginMessage(source, caption, locale, params) : caption;
  };
}
export function useWorkbenchMessages(catalog: PluginMessages = messages): WorkbenchTranslator {
  const locale = usePluginLocale();
  return useCallback(createWorkbenchTranslator(catalog, locale), [catalog, locale]);
}
export function localizeFields(fields: readonly Field[], t: WorkbenchTranslator): Field[] {
  return fields.map(field => ({ ...field, label: t(field.label), help: field.help ? t(field.help) : undefined, options: field.options?.map(option => ({...option, label: t(option.label)})) }));
}
/** Only declared captions are translated. Defaults, IDs, predicates and raw records retain their identity. */
export function localizeWorkbenchConfig(config: WorkbenchConfig, locale: PluginLocale, catalog: PluginMessages): WorkbenchConfig {
  const t = createWorkbenchTranslator(catalog, locale);
  return { ...config, messages: catalog, title: t(config.title), singular: t(config.singular), description: t(config.description), createLabel: t(config.createLabel), footerNote: config.footerNote ? t(config.footerNote) : undefined,
    fields: localizeFields(config.fields,t), stages: config.stages.map(stage => ({...stage,label:t(stage.label)})), filters: config.filters.map(filter => ({...filter,label:t(filter.label)})), columns: config.columns.map(column => ({...column,label:t(column.label)})), exportHeaders: config.exportHeaders.map(header=>t(header)),
    metrics: (records, asOf) => config.metrics(records,asOf).map(metric=>({...metric,label:t(metric.label),detail:t(metric.detail)})),
    validate: record => { const problem = config.validate(record); return problem ? translateValidationMessage(problem,config.fields,t) : null; },
  };
}
export function translateValidationMessage(problem: string, fields: readonly Field[], t: WorkbenchTranslator): string {
  const direct=t(problem); if(direct!==problem)return direct;
  for(const field of fields){
    const templates = ["%{field}: revisa el valor y usa máximo dos decimales.","%{field}: indica una fecha válida.","%{field}: selecciona una opción válida.","%{field}: revisa la longitud del texto."];
    if(problem===`Completa ${field.label.toLowerCase()}.`)return t("Completa %{field}.",{field:t(field.label).toLowerCase()});
    for(const template of templates)if(problem===template.replace("%{field}",field.label))return t(template,{field:t(field.label)});
  }
  return problem;
}
export function workbenchError(error: unknown, locale: PluginLocale, catalog: PluginMessages = messages): string {
  const detail=error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const t=createWorkbenchTranslator(catalog,locale);
  if(Object.hasOwn(catalog,detail)||Object.hasOwn(messages,detail))return t(detail);
  const localized=localizeExternalError(error,locale);
  return localized.detail ? `${localized.message} ${localized.detail}` : localized.message;
}
