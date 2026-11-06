import { useMessages } from "@/i18n/core";
import { recordsMessages } from "@/i18n/locales/records";
import type { ReactNode } from "react";
import { StudioHelpTooltip } from "./studio-help-tooltip";

export function StudioControlLabel({
  label,
  help,
  helpLabel,
}: {
  label: string;
  help?: ReactNode;
  helpLabel?: string;
}) {
  const t = useMessages(recordsMessages);

  return (
    <span className="studio-control-label-row">
      <span>{label}</span>
      {help ? (
        <StudioHelpTooltip
          label={
            helpLabel ?? t("Ayuda sobre %{p0}", { p0: label.toLowerCase() })
          }
        >
          {help}
        </StudioHelpTooltip>
      ) : null}
    </span>
  );
}
