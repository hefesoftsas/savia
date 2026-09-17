import type { ElementType, ReactNode } from "react";
import { CheckCircle2, LoaderCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import "./personal-integrations.css";

export function IntegrationsPageShell({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <main className="integrations-page mx-auto w-full max-w-3xl pb-10">
      {children}
    </main>
  );
}

export function IntegrationsPageHeader({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <header className="integrations-page__header">
      <h1 className="integrations-page__title">{title}</h1>
      {description ? (
        <p className="integrations-page__description">{description}</p>
      ) : null}
    </header>
  );
}

export function IntegrationGroup({
  title,
  headingId,
  children,
}: {
  title: string;
  headingId?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={headingId}
      className="integrations-group overflow-hidden rounded-xl border bg-card"
    >
      <div className="integrations-group__header border-b px-5 py-3.5">
        <h2
          className="integrations-group__title text-sm font-semibold"
          id={headingId}
        >
          {title}
        </h2>
      </div>
      <ul className="integrations-group__list">{children}</ul>
    </section>
  );
}

export function IntegrationProviderIcon({
  Icon,
  displayName,
}: {
  Icon: ElementType;
  displayName: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          aria-label={`Logo de ${displayName}`}
          className="integrations-row__icon flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-foreground"
          role="img"
        >
          <Icon aria-hidden="true" className="size-5" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        {displayName}
      </TooltipContent>
    </Tooltip>
  );
}

export type IntegrationStatusTone = "success" | "warning" | "neutral";

export function IntegrationProviderRow({
  name,
  hint,
  statusLabel,
  statusTone = "neutral",
  showStatus = false,
  actionLabel,
  actionVariant = "default",
  busy = false,
  disabled = false,
  muted = false,
  onAction,
  secondaryAction,
  icon,
}: {
  name: string;
  hint: string;
  statusLabel?: string;
  statusTone?: IntegrationStatusTone;
  showStatus?: boolean;
  actionLabel: string;
  actionVariant?: "default" | "outline";
  busy?: boolean;
  disabled?: boolean;
  muted?: boolean;
  secondaryAction?: ReactNode;
  onAction?: () => void;
  icon: ReactNode;
}) {
  return (
    <li
      className={[
        "integrations-row",
        muted ? "integrations-row--muted" : "",
        disabled ? "integrations-row--static" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="integrations-row__identity flex min-w-0 flex-1 items-center gap-2.5">
        {icon}
        <div className="min-w-0">
          <p className="integrations-row__name truncate text-sm font-medium leading-5">
            {name}
          </p>
          <p className="integrations-row__hint truncate text-xs leading-5 text-muted-foreground">
            {hint}
          </p>
        </div>
      </div>
      <div className="integrations-row__actions flex items-center gap-2 shrink-0">
        {showStatus && statusLabel ? (
          <Badge
            className={cn(
              "integrations-row__status shrink-0 font-medium",
              statusTone === "success" &&
                "border-emerald-500/30 bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/20 dark:border-emerald-500/40 dark:bg-emerald-500/20 dark:text-emerald-300",
              statusTone === "warning" &&
                "border-amber-500/30 bg-amber-500/15 text-amber-700 hover:bg-amber-500/20 dark:border-amber-500/40 dark:bg-amber-500/20 dark:text-amber-300",
            )}
            variant={statusTone === "success" ? "outline" : "secondary"}
          >
            {statusTone === "success" ? (
              <CheckCircle2 className="mr-1 size-3.5 text-emerald-600 dark:text-emerald-400" />
            ) : null}
            {statusLabel}
          </Badge>
        ) : null}
        {secondaryAction}
        <Button
          className="integrations-row__action shrink-0"
          size="sm"
          variant={actionVariant}
          disabled={busy || disabled}
          onClick={onAction}
        >
          {busy ? <LoaderCircle className="animate-spin" /> : null}
          {actionLabel}
        </Button>
      </div>
    </li>
  );
}

export function IntegrationGroupEmpty({ message }: { message: string }) {
  return (
    <li className="px-5 py-8 text-sm text-muted-foreground">{message}</li>
  );
}

export function IntegrationGroupsSkeleton({ groups = 2 }: { groups?: number }) {
  return (
    <div className="integrations-groups space-y-4">
      {Array.from({ length: groups }, (_, index) => (
        <div
          key={index}
          className="integrations-group overflow-hidden rounded-xl border bg-card"
        >
          <div className="border-b px-5 py-3.5">
            <div className="h-4 w-24 rounded bg-muted" />
          </div>
          <div className="space-y-0">
            {Array.from({ length: 3 }, (_, row) => (
              <div
                key={row}
                className="flex items-center gap-3 border-t px-5 py-4 first:border-t-0"
              >
                <div className="size-8 rounded-md bg-muted" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-32 rounded bg-muted" />
                  <div className="h-3 w-48 rounded bg-muted" />
                </div>
                <div className="h-8 w-24 rounded bg-muted" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
