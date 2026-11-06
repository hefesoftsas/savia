import type { ComponentProps } from "react";
import type { LucideIcon } from "lucide-react";
import { Button } from "./button";
import { cn } from "@/lib/utils";

/** Compact phone actions retain a readable, accessible name at every size. */
export function ResponsiveActionButton({
  icon: Icon,
  children,
  className,
  ...props
}: Omit<ComponentProps<typeof Button>, "children" | "asChild"> & {
  icon: LucideIcon;
  children: string;
}) {
  return (
    <Button
      title={children}
      className={cn(
        "max-sm:size-11 max-sm:p-0 max-sm:has-[>svg]:px-0",
        className,
      )}
      {...props}
    >
      <Icon aria-hidden="true" />
      <span className="sr-only sm:not-sr-only">{children}</span>
    </Button>
  );
}
