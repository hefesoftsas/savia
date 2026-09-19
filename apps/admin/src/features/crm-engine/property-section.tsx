import type { ReactNode } from "react";
import { propertySearchTerms } from "@savia/crm-shared/property-panel-search";
import { StudioHelpTooltip } from "./studio-help-tooltip";

export function PropertySection({
  title,
  searchTerms,
  help,
  children,
  defaultOpen = false,
}: {
  title: string;
  searchTerms?: string;
  help?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details
      className="studio-property-section"
      {...(defaultOpen ? { open: true } : {})}
      data-property-search={propertySearchTerms(title, searchTerms)}
    >
      <summary className="studio-property-section-summary">
        <span>{title}</span>
        {help ? (
          <StudioHelpTooltip label={`Ayuda sobre ${title.toLowerCase()}`}>
            {help}
          </StudioHelpTooltip>
        ) : null}
      </summary>
      <div className="studio-property-section-body">{children}</div>
    </details>
  );
}
