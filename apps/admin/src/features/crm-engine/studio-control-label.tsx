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
  return (
    <span className="studio-control-label-row">
      <span>{label}</span>
      {help ? (
        <StudioHelpTooltip
          label={helpLabel ?? `Ayuda sobre ${label.toLowerCase()}`}
        >
          {help}
        </StudioHelpTooltip>
      ) : null}
    </span>
  );
}
