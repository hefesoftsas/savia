import type { ReactNode } from "react";
import { CircleHelp } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function StudioHelpTooltip({
  label,
  children,
  side = "left",
}: {
  label: string;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="studio-help-tooltip-trigger"
          aria-label={label}
          onClick={(event) => event.stopPropagation()}
        >
          <CircleHelp size={14} aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent
        side={side}
        sideOffset={6}
        className="studio-help-tooltip-content"
      >
        {children}
      </TooltipContent>
    </Tooltip>
  );
}
