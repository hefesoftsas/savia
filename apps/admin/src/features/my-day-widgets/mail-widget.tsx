import { useState } from "react";
import { ExternalLink, MailPlus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { PersonalMailProvider } from "@savia/studio-shared/mail-contracts";
import { mailProviderLabel, type MailState } from "./use-my-day-mail";

function safeLink(value: string | null): string | undefined {
  try {
    const url = new URL(value ?? "");
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      [
        "outlook.office.com",
        "outlook.office365.com",
        "outlook.live.com",
      ].includes(url.hostname)
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}
function dateLabel(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Sin fecha";
  return new Intl.DateTimeFormat("es", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
export function MailWidgetBody({
  mail,
  onCompose,
}: {
  mail: MailState;
  onCompose: () => void;
}) {
  const [filter, setFilter] = useState<PersonalMailProvider | "all">("all");
  const activeFilter = mail.connections.some(
    (connection) => connection.provider === filter,
  )
    ? filter
    : "all";
  const rows = mail.messages
    .filter((row) => activeFilter === "all" || row.provider === activeFilter)
    .slice(0, 10);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {mail.connections.length > 1 ? (
          <div
            className="flex gap-1"
            role="group"
            aria-label="Filtrar cuenta de correo"
          >
            {(["all", "gmail", "outlook"] as const).map((provider) => (
              <Button
                key={provider}
                size="sm"
                variant={activeFilter === provider ? "secondary" : "ghost"}
                aria-pressed={activeFilter === provider}
                onClick={() => setFilter(provider)}
              >
                {provider === "all" ? "Todos" : mailProviderLabel(provider)}
              </Button>
            ))}
          </div>
        ) : (
          <p className="truncate text-xs text-muted-foreground">
            {mail.connections[0]?.externalAccountLabel ?? "Correo personal"}
          </p>
        )}
        <div className="flex gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Actualizar correos"
            disabled={mail.loading}
            onClick={() => void mail.refresh()}
          >
            <RefreshCw
              className={mail.loading ? "size-4 animate-spin" : "size-4"}
              aria-hidden="true"
            />
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!mail.connections.length}
            onClick={onCompose}
          >
            <MailPlus className="size-4" aria-hidden="true" />
            Nuevo correo
          </Button>
        </div>
      </div>
      {mail.errors.map((error) => (
        <p key={error} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ))}
      {mail.loading ? (
        <div role="status" aria-label="Cargando correos" className="space-y-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : rows.length ? (
        <ul className="divide-y">
          {rows.map((row) => {
            const link = safeLink(row.webLink);
            return (
              <li
                key={`${row.provider}:${row.id}`}
                className="py-3 first:pt-0 last:pb-0"
              >
                <div className="flex items-start justify-between gap-2">
                  {link ? (
                    <a
                      className="min-w-0 truncate text-sm font-medium text-foreground hover:underline"
                      href={link}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {row.subject ?? "Sin asunto"}
                      <ExternalLink
                        className="ml-1 inline size-3"
                        aria-hidden="true"
                      />
                    </a>
                  ) : (
                    <p className="min-w-0 truncate text-sm font-medium">
                      {row.subject ?? "Sin asunto"}
                    </p>
                  )}
                  <time
                    className="shrink-0 text-xs text-muted-foreground"
                    dateTime={row.receivedAt ?? undefined}
                  >
                    {dateLabel(row.receivedAt)}
                  </time>
                </div>
                <p className="truncate text-sm text-muted-foreground">
                  {row.sender ?? "Remitente desconocido"}
                </p>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {mailProviderLabel(row.provider)} · {row.accountLabel}
                  {!link ? " · Enlace no disponible" : ""}
                </p>
              </li>
            );
          })}
        </ul>
      ) : !mail.errors.length ? (
        <p className="py-4 text-sm text-muted-foreground">
          {mail.connections.length
            ? "No hay correos en esta bandeja."
            : "Conecta Gmail u Outlook para ver tus correos."}
        </p>
      ) : null}
    </div>
  );
}
