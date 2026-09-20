import { useMessages } from "@/i18n/core";
import { recordsMessages } from "@/i18n/locales/records";
import { LoaderCircle } from "lucide-react";
import {
  parseLookupIconRef,
  resolveLookupButtonStyle,
  resolveLookupIcon,
  type LookupIcon,
  type RequestAction,
} from "@savia/crm-shared/request-page";
import { LucideLookupIcon } from "./lucide-lookup-icon";
import { ThesvgLookupIcon } from "./thesvg-lookup-icon";

export function LookupActionIcon({
  icon,
  className,
}: {
  icon: LookupIcon;
  className?: string;
}) {
  const parsed = parseLookupIconRef(icon);
  if (parsed.library === "thesvg") {
    return <ThesvgLookupIcon name={parsed.id} className={className} />;
  }
  return <LucideLookupIcon name={parsed.id} className={className} />;
}

export function LookupActionButtonContent({
  action,
  busy,
  label,
}: {
  action: RequestAction;
  busy: boolean;
  label: string;
}) {
  const t = useMessages(recordsMessages);

  if (busy) {
    return (
      <>
        <LoaderCircle className="animate-spin" aria-hidden="true" />
        <span className="sr-only">{t("Consultando…")}</span>
      </>
    );
  }
  if (resolveLookupButtonStyle(action) === "icon") {
    return <LookupActionIcon icon={resolveLookupIcon(action)} />;
  }
  return label;
}

export function lookupActionUsesIcon(action: RequestAction): boolean {
  return resolveLookupButtonStyle(action) === "icon";
}
