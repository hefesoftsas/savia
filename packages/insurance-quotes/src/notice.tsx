import { usePluginLocale } from "@savia/studio-shared/plugin-locale-react";
import { localizeExternalError } from "@savia/studio-shared/plugin-localization";
import { insuranceMessage, insuranceMessages } from "./messages";

/** Authored notices are localized; provider diagnostics remain available verbatim. */
export function InsuranceNotice({ message, code }: { message: string; code?: string | null }) {
  const locale = usePluginLocale();
  if (Object.prototype.hasOwnProperty.call(insuranceMessages, message)) return <>{insuranceMessage(message, locale)}</>;
  const error = localizeExternalError({ message, errorCode: code }, locale);
  return <>{error.message} <span className="insurance-provider-detail">{error.detail}</span></>;
}
