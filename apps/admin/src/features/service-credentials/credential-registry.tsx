import type { ReactNode } from "react";
import { useTranslate } from "ra-core";
import { CheckCircle2, CircleDashed, CircleHelp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type CredentialRequirementKind =
  "required" | "optional" | "none" | "per-item";

const requirementLabels: Record<CredentialRequirementKind, string> = {
  required: "Requiere clave",
  optional: "Opcional",
  none: "Sin clave",
  "per-item": "Por elemento",
};

export function formatConfiguredDate(
  dateString: string | undefined | null,
  locale = "es-CO",
): string {
  if (!dateString) return "";
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    return new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  } catch {
    return dateString;
  }
}

export function CredentialRequirementBadge({
  kind,
  className,
}: {
  kind: CredentialRequirementKind;
  className?: string;
}) {
  const translate = useTranslate();
  const key = kind === "per-item" ? "perItem" : kind;
  const label = translate(`savia.serviceCredentials.badges.${key}`, {
    _: requirementLabels[kind],
  });
  return (
    <Badge
      variant={kind === "required" ? "default" : "outline"}
      className={cn(
        kind === "none" &&
          "border-emerald-500/30 text-emerald-700 dark:text-emerald-400",
        kind === "optional" &&
          "border-amber-500/30 text-amber-800 dark:text-amber-400",
        kind === "per-item" &&
          "border-sky-500/30 text-sky-800 dark:text-sky-400",
        className,
      )}
    >
      {label}
    </Badge>
  );
}

export function CredentialStatusBadge({
  configured,
  label,
}: {
  configured: boolean;
  label: string;
}) {
  return (
    <Badge variant={configured ? "default" : "secondary"}>
      {configured ? (
        <CheckCircle2 aria-hidden="true" />
      ) : (
        <CircleDashed aria-hidden="true" />
      )}
      {label}
    </Badge>
  );
}

export function CredentialsHelpTooltip({
  description,
}: {
  description?: string;
}) {
  const translate = useTranslate();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={translate("savia.serviceCredentials.helpTooltipAria", {
            _: "Ayuda sobre credenciales",
          })}
        >
          <CircleHelp className="size-4" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={8} className="max-w-sm">
        <div className="space-y-2">
          {description ? <p>{description}</p> : null}
          <p>
            {translate("savia.serviceCredentials.helpTooltipContent", {
              _: "Cada servicio indica si necesita clave, dónde se guarda y si ya está configurado. Globales: una clave por espacio. Integraciones: credencial por OpenAPI. Fuentes: token por fuente JSON:API. Sin clave: Photon y Nominatim.",
            })}
          </p>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

export function CredentialDescriptionTooltip({
  children,
}: {
  children: ReactNode;
}) {
  const translate = useTranslate();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={translate("savia.serviceCredentials.helpTooltipAria", {
            _: "Ayuda sobre credenciales",
          })}
        >
          <CircleHelp className="size-3.5" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6} className="max-w-xs">
        {children}
      </TooltipContent>
    </Tooltip>
  );
}

export function CredentialGroup({
  title,
  description,
  descriptionAsTooltip = false,
  children,
}: {
  title: string;
  description: string;
  descriptionAsTooltip?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="credentials-group">
      <header className="credentials-group-header">
        <div className="flex items-center gap-1.5">
          <h2>{title}</h2>
          {descriptionAsTooltip ? (
            <CredentialDescriptionTooltip>
              {description}
            </CredentialDescriptionTooltip>
          ) : null}
        </div>
        {!descriptionAsTooltip ? <p>{description}</p> : null}
      </header>
      <div className="credentials-group-body">{children}</div>
    </section>
  );
}

export function CredentialEntry({
  title,
  description,
  descriptionAsTooltip = false,
  requirement,
  status,
  children,
}: {
  title: string;
  description: string;
  descriptionAsTooltip?: boolean;
  requirement: CredentialRequirementKind;
  status?: ReactNode;
  children: ReactNode;
}) {
  return (
    <article className="credentials-entry">
      <header className="credentials-entry-header">
        <div className="credentials-entry-heading">
          <div className="credentials-entry-badges">
            <CredentialRequirementBadge kind={requirement} />
            {status}
          </div>
          <div className="flex items-center gap-1.5">
            <h3>{title}</h3>
            {descriptionAsTooltip ? (
              <CredentialDescriptionTooltip>
                {description}
              </CredentialDescriptionTooltip>
            ) : null}
          </div>
          {!descriptionAsTooltip ? <p>{description}</p> : null}
        </div>
      </header>
      <div className="credentials-entry-body">{children}</div>
    </article>
  );
}

export function CredentialFreeServiceList({
  items,
}: {
  items: Array<{ name: string; detail: string }>;
}) {
  return (
    <ul className="credentials-free-list">
      {items.map((item) => (
        <li key={item.name}>
          <strong>{item.name}</strong>
          <span>{item.detail}</span>
        </li>
      ))}
    </ul>
  );
}
