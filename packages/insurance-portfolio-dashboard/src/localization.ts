import { useCallback } from "react";
import { usePluginLocale } from "@savia/crm-shared/plugin-locale-react";
import { insuranceMessage } from "./messages";
import type { PluginMessageParams } from "@savia/crm-shared/plugin-localization";
export function useInsuranceMessages() { const locale=usePluginLocale(); return useCallback((message:string, params?:PluginMessageParams)=>insuranceMessage(message,locale,params),[locale]); }
