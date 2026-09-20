/** Browser-independent localization primitives for extension and sandbox authors. */
export type PluginLocale = "es" | "en" | "pt";
export type PluginMessages = Readonly<Record<string, readonly [string, string, string]>>;
export type PluginMessageParams = Readonly<Record<string, string | number>>;
export type LocalizedContent = Partial<Record<PluginLocale, string>>;
export function normalizePluginLocale(locale: unknown): PluginLocale {
  return locale === "en" || locale === "pt" ? locale : "es";
}
export function pluginIntlLocale(locale: PluginLocale): string {
  return { es: "es-CO", en: "en-US", pt: "pt-BR" }[locale];
}
export function translatePluginMessage<C extends PluginMessages>(catalog: C, key: keyof C & string, locale: PluginLocale, params: PluginMessageParams = {}): string {
  const entries = catalog[key];
  if (!entries) throw new Error(`Missing extension message: ${key}`);
  const message = entries[{ es: 0, en: 1, pt: 2 }[normalizePluginLocale(locale)]];
  return message.replace(/%\{([^}]+)\}/g, (token, name: string) => Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : token);
}
export function resolveLocalizedContent(base: string, translations: LocalizedContent | undefined, locale: PluginLocale): string {
  const value = translations?.[locale];
  return typeof value === "string" && value.trim() ? value : base;
}
const errorMessages = {
  authentication: ["Tu sesión expiró. Inicia sesión de nuevo.", "Your session expired. Please sign in again.", "Sua sessão expirou. Entre novamente."],
  forbidden: ["No tienes permiso para realizar esta acción.", "You do not have permission to perform this action.", "Você não tem permissão para realizar esta ação."],
  missing: ["El recurso solicitado ya no está disponible.", "The requested resource is no longer available.", "O recurso solicitado não está mais disponível."],
  conflict: ["Los datos cambiaron. Recarga antes de intentarlo de nuevo.", "The data changed. Reload before trying again.", "Os dados foram alterados. Recarregue antes de tentar novamente."],
  validation: ["Revisa los datos enviados y vuelve a intentarlo.", "Check the submitted data and try again.", "Verifique os dados enviados e tente novamente."],
  rate: ["Se hicieron demasiadas solicitudes. Espera y vuelve a intentarlo.", "Too many requests. Wait and try again.", "Foram feitas muitas solicitações. Aguarde e tente novamente."],
  timeout: ["El servicio tardó demasiado en responder. Inténtalo de nuevo.", "The service took too long to respond. Try again.", "O serviço demorou demais para responder. Tente novamente."],
  network: ["No se pudo conectar con el servicio. Revisa tu conexión.", "Could not connect to the service. Check your connection.", "Não foi possível conectar ao serviço. Verifique sua conexão."],
  unavailable: ["El servicio no está disponible temporalmente. Inténtalo más tarde.", "The service is temporarily unavailable. Try again later.", "O serviço está temporariamente indisponível. Tente novamente mais tarde."],
  unknown: ["No se pudo completar la operación. Revisa el detalle del servicio.", "The operation could not be completed. Review the service details.", "Não foi possível concluir a operação. Verifique os detalhes do serviço."],
} as const satisfies PluginMessages;
export type LocalizedExternalError = { message: string; detail: string; code?: string; status?: number };
/** Translate structured codes/statuses, never guess the language of raw provider text. */
export function localizeExternalError(error: unknown, locale: PluginLocale): LocalizedExternalError {
  const value = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const status = typeof value.status === "number" ? value.status : undefined;
  const code = typeof value.code === "string" ? value.code : typeof value.errorCode === "string" ? value.errorCode : undefined;
  const detail = typeof value.message === "string" ? value.message : typeof error === "string" ? error : "";
  const codes: Record<string, keyof typeof errorMessages> = {
    unauthorized: "authentication", unauthenticated: "authentication", forbidden: "forbidden", access_denied: "forbidden",
    not_found: "missing", conflict: "conflict", version_conflict: "conflict", validation_error: "validation", invalid_input: "validation",
    rate_limited: "rate", rate_limit_exceeded: "rate", timeout: "timeout", provider_timeout: "timeout", ETIMEDOUT: "timeout",
    network_error: "network", ECONNREFUSED: "network", service_unavailable: "unavailable", provider_unavailable: "unavailable",
  };
  const statuses: Record<number, keyof typeof errorMessages> = {400:"validation",401:"authentication",403:"forbidden",404:"missing",408:"timeout",409:"conflict",422:"validation",429:"rate",500:"unavailable",502:"unavailable",503:"unavailable",504:"timeout"};
  const key = (code && Object.prototype.hasOwnProperty.call(codes,code) ? codes[code] : undefined) ?? (status ? statuses[status] : undefined) ?? (value.name === "TimeoutError" ? "timeout" : "unknown");
  return { message: translatePluginMessage(errorMessages, key, locale), detail, ...(code ? {code} : {}), ...(status ? {status} : {}) };
}
export { errorMessages as externalErrorMessages };
