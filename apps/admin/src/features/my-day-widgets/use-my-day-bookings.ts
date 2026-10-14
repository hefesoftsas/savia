import { useCallback, useEffect, useRef, useState } from "react";
import type { BookingAgendaEntry } from "@savia/studio-shared/booking-agenda-contracts";

export type BookingAgendaClient = {
  listBookingAgenda?: (range: {
    from: string;
    to: string;
    timeZone: string;
  }) => Promise<BookingAgendaEntry[]>;
};

type BookingState = {
  client: BookingAgendaClient | undefined;
  scope: string;
  entries: BookingAgendaEntry[];
  loading: boolean;
  error: boolean;
};

const empty = (
  client: BookingAgendaClient | undefined,
  scope: string,
  loading: boolean,
): BookingState => ({ client, scope, entries: [], loading, error: false });

function isAuthorizationFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    status?: number;
    statusCode?: number;
    response?: { status?: number };
  };
  const status =
    candidate.status ?? candidate.statusCode ?? candidate.response?.status;
  return status === 401 || status === 403;
}

export function useMyDayBookings(
  client: BookingAgendaClient | undefined,
  range: { from: string; to: string; timeZone: string },
) {
  const scope = `${range.from}/${range.to}/${range.timeZone}`;
  const [sessionRevision, setSessionRevision] = useState(0);
  const [state, setState] = useState(() =>
    empty(client, scope, Boolean(client?.listBookingAgenda)),
  );
  const requestRevision = useRef(0);
  const pendingRequest = useRef<{
    client: BookingAgendaClient | undefined;
    scope: string;
    promise: Promise<void>;
  } | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const currentSession = useRef(sessionRevision);
  currentSession.current = sessionRevision;
  const current = state.client === client && state.scope === scope;
  const entries = current ? state.entries : [];
  const loading = current ? state.loading : Boolean(client?.listBookingAgenda);
  const error = current ? state.error : false;

  useEffect(() => {
    const clear = () => {
      requestRevision.current += 1;
      setState(empty(client, scope, Boolean(client?.listBookingAgenda)));
      setSessionRevision((revision) => revision + 1);
    };
    window.addEventListener("savia:session-cleared", clear);
    window.addEventListener("savia:principal-changed", clear);
    return () => {
      window.removeEventListener("savia:session-cleared", clear);
      window.removeEventListener("savia:principal-changed", clear);
    };
  }, [client, scope]);

  const refresh = useCallback(
    async (background = false) => {
      const list = client?.listBookingAgenda;
      if (!list) {
        setState(empty(client, scope, false));
        return;
      }
      const pending = pendingRequest.current;
      if (pending?.client === client && pending.scope === scope) {
        return pending.promise;
      }
      const revision = ++requestRevision.current;
      const session = currentSession.current;
      const isCurrent = () =>
        revision === requestRevision.current &&
        session === currentSession.current;
      const previous = stateRef.current;
      const sameScope = previous.client === client && previous.scope === scope;
      if (!background || !sameScope || previous.entries.length === 0) {
        setState((previous) => ({
          ...empty(client, scope, !sameScope || previous.entries.length === 0),
          entries:
            previous.client === client && previous.scope === scope
              ? previous.entries
              : [],
          error: false,
        }));
      } else {
        setState((previous) => ({ ...previous, loading: false, error: false }));
      }
      const request = (async () => {
        try {
          const next = await client!.listBookingAgenda!({
            from: range.from,
            to: range.to,
            timeZone: range.timeZone,
          });
          if (!isCurrent()) return;
          setState({
            client,
            scope,
            entries: next,
            loading: false,
            error: false,
          });
        } catch (cause) {
          if (!isCurrent()) return;
          setState((previous) => ({
            client,
            scope,
            entries: isAuthorizationFailure(cause)
              ? []
              : previous.client === client && previous.scope === scope
                ? previous.entries
                : [],
            loading: false,
            error: true,
          }));
        }
      })();
      pendingRequest.current = { client, scope, promise: request };
      try {
        await request;
      } finally {
        if (pendingRequest.current?.promise === request)
          pendingRequest.current = null;
      }
    },
    [client, scope, range.from, range.to, range.timeZone],
  );

  useEffect(() => {
    if (!client?.listBookingAgenda) {
      setState(empty(client, scope, false));
      return;
    }
    void refresh();
    return () => {
      requestRevision.current += 1;
      if (
        pendingRequest.current?.client === client &&
        pendingRequest.current.scope === scope
      )
        pendingRequest.current = null;
    };
  }, [client, scope, sessionRevision, refresh]);

  useEffect(() => {
    if (!client?.listBookingAgenda) return;
    let timer: ReturnType<typeof setTimeout>;
    let disposed = false;
    const visible = () =>
      document.visibilityState !== "hidden" &&
      (typeof navigator === "undefined" || navigator.onLine);
    const schedule = () => {
      clearTimeout(timer);
      if (!disposed) timer = setTimeout(tick, 300_000);
    };
    const tick = async () => {
      clearTimeout(timer);
      if (disposed) return;
      if (visible()) await refresh(true);
      schedule();
    };
    const resume = () => {
      clearTimeout(timer);
      if (visible()) void tick();
    };
    schedule();
    window.addEventListener("focus", resume);
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      disposed = true;
      clearTimeout(timer);
      window.removeEventListener("focus", resume);
      window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [client, scope, sessionRevision, refresh]);

  return { entries, loading, error, refresh: () => refresh() };
}
