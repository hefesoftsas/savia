import { useMemo, useState } from "react";
import {
  ArrowLeft,
  Calendar,
  Clock,
  MessageSquare,
  MessageSquareDashed,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  extractThreadPreview,
  formatRelativeTime,
  groupThreadsByTimeline,
  type AssistantThreadRecord,
} from "./assistant-thread-storage";

export interface AssistantThreadListProps {
  threads: AssistantThreadRecord[];
  activeThreadId: string | null;
  onSelectThread: (threadId: string) => void;
  onNewThread: () => void;
  onDeleteThread: (threadId: string) => void;
  onBackToChat?: () => void;
}

export function AssistantThreadList({
  threads,
  activeThreadId,
  onSelectThread,
  onNewThread,
  onDeleteThread,
  onBackToChat,
}: AssistantThreadListProps) {
  const [search, setSearch] = useState("");
  const [threadToDelete, setThreadToDelete] = useState<string | null>(null);

  const filteredThreads = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return threads;

    return threads.filter((thread) => {
      if (thread.title.toLowerCase().includes(query)) return true;
      const preview = extractThreadPreview(thread).toLowerCase();
      if (preview.includes(query)) return true;
      return thread.messages.some((msg) =>
        msg.parts?.some(
          (p) => typeof p.text === "string" && p.text.toLowerCase().includes(query),
        ),
      );
    });
  }, [threads, search]);

  const timelineGroups = useMemo(() => {
    if (search.trim()) return null;
    return groupThreadsByTimeline(filteredThreads);
  }, [filteredThreads, search]);

  const handleDelete = (e: React.MouseEvent, threadId: string) => {
    e.stopPropagation();
    onDeleteThread(threadId);
    if (threadToDelete === threadId) {
      setThreadToDelete(null);
    }
  };

  return (
    <div
      className="flex min-h-0 flex-1 flex-col bg-background"
      data-testid="assistant-thread-list"
    >
      {/* Subheader & Search */}
      <div className="flex flex-col gap-2.5 border-b border-border/60 bg-card/40 p-3 backdrop-blur-xs">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            {onBackToChat ? (
              <Button
                variant="ghost"
                size="icon"
                className="size-7 rounded-lg text-muted-foreground hover:text-foreground"
                onClick={onBackToChat}
                aria-label="Volver al chat"
              >
                <ArrowLeft className="size-4" />
              </Button>
            ) : null}
            <span className="text-xs font-semibold tracking-tight text-foreground">
              Conversaciones ({threads.length})
            </span>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 rounded-lg px-2.5 text-xs font-medium border-border/70 hover:border-primary/40 hover:bg-primary/5 hover:text-primary transition-all"
            onClick={onNewThread}
          >
            <Plus className="size-3.5 text-primary" />
            <span>Nueva</span>
          </Button>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/70" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por pregunta o tema…"
            className="h-8 rounded-lg border-border/60 bg-background/80 pl-8 pr-7 text-xs placeholder:text-muted-foreground/60 focus-visible:border-primary/50 focus-visible:ring-1 focus-visible:ring-primary/20"
            aria-label="Buscar conversaciones"
          />
          {search ? (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground"
              aria-label="Limpiar búsqueda"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      {/* Thread list content */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3 space-y-4">
        {threads.length === 0 ? (
          <div className="my-auto flex flex-col items-center justify-center p-8 text-center">
            <div className="mb-3 flex size-12 items-center justify-center rounded-2xl border border-border/60 bg-muted/40 text-muted-foreground/60 shadow-2xs">
              <MessageSquareDashed className="size-6" />
            </div>
            <h4 className="text-sm font-semibold tracking-tight text-foreground">
              Sin conversaciones previas
            </h4>
            <p className="mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">
              Cada vez que consultes el CRM o generes informes, tu diálogo se guardará automáticamente para que puedas retomarlo.
            </p>
            <Button
              size="sm"
              onClick={onNewThread}
              className="mt-4 gap-1.5 rounded-xl text-xs font-medium"
            >
              <Sparkles className="size-3.5" />
              <span>Comenzar conversación</span>
            </Button>
          </div>
        ) : filteredThreads.length === 0 ? (
          <div className="my-auto flex flex-col items-center justify-center p-6 text-center">
            <Search className="mb-2 size-6 text-muted-foreground/40" />
            <p className="text-xs font-medium text-foreground">
              No se encontraron coincidencias
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              No hay conversaciones para &quot;{search}&quot;
            </p>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSearch("")}
              className="mt-2 h-7 text-xs text-primary"
            >
              Limpiar búsqueda
            </Button>
          </div>
        ) : timelineGroups ? (
          timelineGroups.map(({ group, items }) => (
            <div key={group} className="space-y-1.5">
              <div className="flex items-center gap-1.5 px-1 pt-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
                <Calendar className="size-3" />
                <span>{group}</span>
              </div>
              <div className="space-y-1.5">
                {items.map((thread) => (
                  <ThreadCard
                    key={thread.id}
                    thread={thread}
                    isActive={thread.id === activeThreadId}
                    onSelect={() => onSelectThread(thread.id)}
                    onDelete={(e) => handleDelete(e, thread.id)}
                  />
                ))}
              </div>
            </div>
          ))
        ) : (
          <div className="space-y-1.5">
            <p className="px-1 text-[11px] font-medium text-muted-foreground">
              Resultados de búsqueda ({filteredThreads.length})
            </p>
            {filteredThreads.map((thread) => (
              <ThreadCard
                key={thread.id}
                thread={thread}
                isActive={thread.id === activeThreadId}
                onSelect={() => onSelectThread(thread.id)}
                onDelete={(e) => handleDelete(e, thread.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ThreadCard({
  thread,
  isActive,
  onSelect,
  onDelete,
}: {
  thread: AssistantThreadRecord;
  isActive: boolean;
  onSelect: () => void;
  onDelete: (e: React.MouseEvent) => void;
}) {
  const preview = extractThreadPreview(thread);
  const relativeTime = formatRelativeTime(thread.updatedAt || thread.createdAt);
  const messageCount = thread.messages.length;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        "group relative flex w-full cursor-pointer items-start gap-2.5 rounded-xl border p-2.5 text-left transition-all duration-150 outline-none",
        isActive
          ? "border-primary/40 bg-primary/5 shadow-2xs ring-1 ring-primary/20"
          : "border-border/60 bg-card/60 hover:border-border hover:bg-muted/40",
      )}
      data-testid={`thread-card-${thread.id}`}
      aria-current={isActive ? "true" : undefined}
    >
      <div
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-lg text-xs font-medium transition-colors",
          isActive
            ? "bg-primary text-primary-foreground shadow-2xs"
            : "bg-muted/70 text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary",
        )}
      >
        <MessageSquare className="size-3.5" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-1.5">
          <p
            className={cn(
              "truncate text-xs font-medium tracking-tight",
              isActive ? "text-primary font-semibold" : "text-foreground group-hover:text-primary transition-colors",
            )}
          >
            {thread.title}
          </p>
          <span className="shrink-0 text-[10px] text-muted-foreground/70">
            {relativeTime}
          </span>
        </div>

        <p className="mt-0.5 line-clamp-1 text-[11px] leading-normal text-muted-foreground/85">
          {preview}
        </p>

        <div className="mt-1.5 flex items-center gap-2 text-[10px] text-muted-foreground/60">
          <span className="inline-flex items-center gap-1 rounded-sm bg-muted/60 px-1.5 py-0.2 font-medium">
            <Clock className="size-2.5" />
            {messageCount} {messageCount === 1 ? "mensaje" : "mensajes"}
          </span>
          {isActive ? (
            <span className="font-semibold text-primary">Activo</span>
          ) : null}
        </div>
      </div>

      <Button
        size="icon"
        variant="ghost"
        className="size-6 shrink-0 rounded-md text-muted-foreground/50 opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 focus:opacity-100"
        onClick={onDelete}
        title="Eliminar conversación"
        aria-label={`Eliminar conversación: ${thread.title}`}
      >
        <Trash2 className="size-3" />
      </Button>
    </div>
  );
}
