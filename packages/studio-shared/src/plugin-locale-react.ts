import { createContext, createElement, useCallback, useContext, type ReactNode } from "react";
import { normalizePluginLocale, translatePluginMessage, type PluginLocale, type PluginMessages, type PluginMessageParams } from "./plugin-localization";
const PluginLocaleContext = createContext<PluginLocale>("es");
export function PluginLocaleProvider({locale, children}: {locale: PluginLocale; children: ReactNode}) {
  return createElement(PluginLocaleContext.Provider, {value: normalizePluginLocale(locale)}, children);
}
export function usePluginLocale(): PluginLocale { return useContext(PluginLocaleContext); }
export function usePluginMessages<C extends PluginMessages>(catalog: C) {
  const locale = usePluginLocale();
  return useCallback((key: keyof C & string, params?: PluginMessageParams) => translatePluginMessage(catalog,key,locale,params), [catalog,locale]);
}
