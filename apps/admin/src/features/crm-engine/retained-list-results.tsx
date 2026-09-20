import { useMessages } from "@/i18n/core";
import { recordsMessages } from "@/i18n/locales/records";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useReducer, type ReactNode } from "react";
import { ListContextProvider, useListContext, type RaRecord } from "ra-core";
import { Button } from "@/components/ui/button";

/** Retain one successful page within its authorization/collection scope. */
export function RetainedListResults({
  scope,
  children,
}: {
  scope: string;
  children: ReactNode;
}) {
  const t = useMessages(recordsMessages);

  const context = useListContext();
  const saved = useRef<
    { scope: string; data: RaRecord[]; total: number | undefined } | undefined
  >(undefined);
  const queryClient = useQueryClient();
  const revoked = useRef(new WeakSet<RaRecord[]>());
  const currentData = useRef(context.data);
  currentData.current = context.data;
  const [, refresh] = useReducer((value: number) => value + 1, 0);
  useEffect(
    () =>
      queryClient.getQueryCache().subscribe((event) => {
        if (
          event.query.queryKey[0] !== context.resource ||
          event.query.queryKey[1] !== "getList"
        )
          return;
        if (
          event.type === "updated" &&
          event.action.type === "success" &&
          !event.action.manual
        ) {
          const result = event.query.state.data as
            { data?: RaRecord[] } | undefined;
          if (result?.data && revoked.current.delete(result.data)) refresh();
        }
        const reset =
          event.type === "updated" &&
          event.action.type === "setState" &&
          event.query.state.data === undefined;
        if (event.type !== "removed" && !reset) return;
        // A cache reset is an authorization boundary, not a transient failed fetch.
        // RA can still expose its previous placeholder array after the cache clears.
        if (currentData.current) revoked.current.add(currentData.current);
        if (saved.current) revoked.current.add(saved.current.data);
        saved.current = undefined;
        refresh();
      }),
    [queryClient, context.resource],
  );
  const currentRevoked =
    context.data !== undefined && revoked.current.has(context.data);
  const status = (context.error as { status?: number } | undefined)?.status;
  const denied = status === 401 || status === 403;
  useEffect(() => {
    if (denied) {
      if (context.data) revoked.current.add(context.data);
      if (saved.current) revoked.current.add(saved.current.data);
    }
    if (denied || saved.current?.scope !== scope) saved.current = undefined;
    if (
      !currentRevoked &&
      !denied &&
      !context.error &&
      !context.isPending &&
      !context.isPlaceholderData &&
      context.data !== undefined
    )
      saved.current = { scope, data: context.data, total: context.total };
  }, [
    scope,
    currentRevoked,
    denied,
    context.data,
    context.total,
    context.error,
    context.isPending,
    context.isPlaceholderData,
  ]);
  if (denied) return <p role="alert">{context.error?.message}</p>;
  const previous = saved.current?.scope === scope ? saved.current : undefined;
  const current = currentRevoked ? undefined : context.data;
  const retained = current === undefined && previous !== undefined;
  const data = current ?? previous?.data;
  const updating = context.isFetching || context.isPlaceholderData;
  const readOnly = Boolean(
    context.error || context.isPlaceholderData || retained,
  );
  return (
    <>
      <div
        role="status"
        aria-live="polite"
        className="min-h-6 text-xs text-muted-foreground"
      >
        {updating
          ? t("Actualizando resultados…")
          : readOnly
            ? t("Mostrando los últimos resultados disponibles.")
            : ""}
      </div>
      {context.error && (
        <div
          role="alert"
          className="flex items-center gap-2 py-2 text-sm text-destructive"
        >
          <span>{context.error.message}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void context.refetch()}
          >
            {t("Reintentar")}
          </Button>
        </div>
      )}
      <ListContextProvider
        value={
          {
            ...context,
            ...(currentRevoked
              ? {
                  data: undefined,
                  total: undefined,
                  isPending: !context.error,
                  isLoading: !context.error,
                }
              : {}),
            ...(data !== undefined
              ? {
                  data,
                  total: retained ? previous?.total : context.total,
                  isPending: false,
                  isLoading: false,
                  error: null,
                }
              : {}),
          } as typeof context
        }
      >
        <div aria-busy={Boolean(updating)} inert={readOnly || undefined}>
          {children}
        </div>
      </ListContextProvider>
    </>
  );
}
