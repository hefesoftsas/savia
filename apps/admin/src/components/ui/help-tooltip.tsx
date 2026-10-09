import { useState } from "react";
import { CircleHelp } from "lucide-react";
import { Button } from "./button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

export function HelpTooltip({
  label,
  children,
}: {
  label: string;
  children: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11 shrink-0 text-muted-foreground"
          aria-label={label}
          onClick={(event) => {
            // Radix closes tooltips on click; keep help available to touch users.
            event.preventDefault();
            setOpen(true);
          }}
        >
          <CircleHelp className="size-4" aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent
        sideOffset={4}
        collisionPadding={12}
        className="max-w-xs text-sm leading-5"
      >
        {children}
      </TooltipContent>
    </Tooltip>
  );
}
