import { localizeExternalError } from "@savia/studio-shared/plugin-localization";
import { useAppLocale, useMessages } from "@/i18n/core";
import { externalMessages } from "@/i18n/locales/external";

/** System guidance is localized; the original provider detail stays available. */
export function ExternalErrorNotice({ error }: { error: unknown }) {
  const locale = useAppLocale();
  const t = useMessages(externalMessages);
  const failure = localizeExternalError(error, locale);
  return <div className="text-destructive text-sm" role="alert">
    <p>{failure.message}</p>
    {failure.detail && <details><summary>{t("Detalle original del servicio")}</summary><pre className="whitespace-pre-wrap break-words">{failure.detail}</pre></details>}
  </div>;
}
