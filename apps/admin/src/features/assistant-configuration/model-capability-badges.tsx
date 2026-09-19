import { Image, MessageSquareText, Mic, Paperclip, Wrench } from "lucide-react";
import type {
  AssistantModel,
  AssistantModelModalities,
} from "@/api/assistant-configuration-client";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function ModelCapabilityBadges({
  model,
  modalities,
  supportsTools,
  className,
  size = "sm",
}: {
  model?: Partial<AssistantModel> | null;
  modalities?: AssistantModelModalities | null;
  supportsTools?: boolean;
  className?: string;
  size?: "sm" | "xs";
}) {
  const resolvedModalities = model?.modalities ?? modalities;
  const resolvedTools = model?.supportsTools ?? supportsTools ?? false;

  const hasImage = Boolean(resolvedModalities?.image);
  const hasAudio = Boolean(resolvedModalities?.audio);
  const hasFile = Boolean(resolvedModalities?.file);

  const iconClass = size === "xs" ? "size-3" : "size-3.5";
  const containerClass =
    size === "xs"
      ? "gap-1 text-[10px] px-1.5 py-0.5"
      : "gap-1.5 text-xs px-2 py-0.5";

  return (
    <div
      className={cn(
        "inline-flex items-center flex-wrap gap-1 text-muted-foreground",
        className,
      )}
      data-testid="model-capability-badges"
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "inline-flex items-center rounded-md border border-border/60 bg-muted/30 font-medium text-foreground/80 hover:bg-muted/60 transition-colors",
              containerClass,
            )}
            aria-label="Modalidad Texto"
          >
            <MessageSquareText className={cn(iconClass, "text-sky-600 dark:text-sky-400")} />
            <span className="hidden sm:inline">Texto</span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p className="font-semibold">Texto</p>
          <p className="text-xs text-muted-foreground">Admite preguntas y respuestas en texto</p>
        </TooltipContent>
      </Tooltip>

      {hasImage ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className={cn(
                "inline-flex items-center rounded-md border border-emerald-500/30 bg-emerald-500/10 font-medium text-emerald-700 dark:text-emerald-300",
                containerClass,
              )}
              aria-label="Modalidad Visión / Imágenes"
            >
              <Image className={iconClass} />
              <span className="hidden sm:inline">Visión</span>
            </span>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p className="font-semibold text-emerald-600 dark:text-emerald-400">Visión / Imágenes</p>
            <p className="text-xs text-muted-foreground">Analiza e interpreta imágenes y capturas</p>
          </TooltipContent>
        </Tooltip>
      ) : null}

      {hasFile ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className={cn(
                "inline-flex items-center rounded-md border border-indigo-500/30 bg-indigo-500/10 font-medium text-indigo-700 dark:text-indigo-300",
                containerClass,
              )}
              aria-label="Modalidad Archivos"
            >
              <Paperclip className={iconClass} />
              <span className="hidden sm:inline">Archivos</span>
            </span>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p className="font-semibold text-indigo-600 dark:text-indigo-400">Archivos y Documentos</p>
            <p className="text-xs text-muted-foreground">Admite documentos adjuntos (PDFs, CSV, datos)</p>
          </TooltipContent>
        </Tooltip>
      ) : null}

      {hasAudio ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className={cn(
                "inline-flex items-center rounded-md border border-amber-500/30 bg-amber-500/10 font-medium text-amber-700 dark:text-amber-300",
                containerClass,
              )}
              aria-label="Modalidad Voz / Audio"
            >
              <Mic className={iconClass} />
              <span className="hidden sm:inline">Voz</span>
            </span>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p className="font-semibold text-amber-600 dark:text-amber-400">Voz y Audio Nativo</p>
            <p className="text-xs text-muted-foreground">Soporte directo de entrada de audio/voz</p>
          </TooltipContent>
        </Tooltip>
      ) : null}

      {resolvedTools ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className={cn(
                "inline-flex items-center rounded-md border border-purple-500/30 bg-purple-500/10 font-medium text-purple-700 dark:text-purple-300",
                containerClass,
              )}
              aria-label="Herramientas CRM"
            >
              <Wrench className={iconClass} />
              <span className="hidden sm:inline">Herramientas</span>
            </span>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p className="font-semibold text-purple-600 dark:text-purple-400">Herramientas CRM</p>
            <p className="text-xs text-muted-foreground">Ejecuta consultas al CRM y llamadas a funciones</p>
          </TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
}
