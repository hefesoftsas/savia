import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function TruncatedWithTooltip({
  children,
  className,
  side = "top",
}: {
  children: string;
  className?: string;
  side?: "top" | "right" | "bottom" | "left";
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [truncated, setTruncated] = useState(false);

  const update = useCallback(() => {
    const node = ref.current;
    if (!node) return;
    setTruncated(node.scrollWidth > node.clientWidth);
  }, []);

  useEffect(() => {
    update();
  }, [update, children]);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [update]);

  const label = (
    <span ref={ref} className={cn("block min-w-0 truncate", className)}>
      {children}
    </span>
  );

  if (!truncated) return label;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{label}</TooltipTrigger>
      <TooltipContent side={side}>{children}</TooltipContent>
    </Tooltip>
  );
}
