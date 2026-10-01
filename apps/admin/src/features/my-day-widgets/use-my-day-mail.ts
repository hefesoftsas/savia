import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PersonalMailMessage,
  PersonalMailProvider,
  SendPersonalMailInput,
} from "@savia/studio-shared/mail-contracts";
import { ApiClientError } from "@/api/api-client";
import { useRealtimeRefresh } from "@/realtime/use-realtime-refresh";

export type MailConnection = {
  provider: PersonalMailProvider;
  status: string;
  externalAccountLabel?: string | null;
};
export type PersonalMailLike = {
  listConnections(
    refresh?: boolean,
  ): Promise<
    { provider: string; status: string; externalAccountLabel?: string | null }[]
  >;
  listMessages(input: {
    provider: PersonalMailProvider;
    query?: string;
  }): Promise<PersonalMailMessage[]>;
  sendMail(
    input: SendPersonalMailInput,
  ): Promise<{ provider: PersonalMailProvider; action: "send-email" }>;
};
export type MailRow = PersonalMailMessage & {
  provider: PersonalMailProvider;
  accountLabel: string;
};
export type MailState = {
  connections: MailConnection[];
  reconnectRequired: PersonalMailProvider[];
  messages: MailRow[];
  loading: boolean;
  errors: string[];
  sessionRevision: number;
  newMessageCount?: number;
  dismissNewMessages?(): void;
  refresh(): Promise<void>;
};
export function mailProviderLabel(provider: PersonalMailProvider): string {
  return provider === "gmail" ? "Gmail" : "Outlook";
}
export function isMailClient(value: unknown): value is PersonalMailLike {
  const client = value as Partial<PersonalMailLike> | undefined;
  return (
    typeof client?.listConnections === "function" &&
    typeof client.listMessages === "function" &&
    typeof client.sendMail === "function"
  );
}
const empty = {
  reconnectRequired: [] as PersonalMailProvider[],
  connections: [] as MailConnection[],
  messages: [] as MailRow[],
  loading: false,
  errors: [] as string[],
  newMessageCount: 0,
};
const REFRESH_INTERVAL_MS = 60_000;
const MAX_RETRY_INTERVAL_MS = 300_000;
function canRefreshMail() {
  return document.visibilityState === "visible" && navigator.onLine;
}
export function useMyDayMail(client: PersonalMailLike | undefined): MailState {
  const [snapshot, setSnapshot] = useState({ ...empty, owner: client });
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const [sessionRevision, setSessionRevision] = useState(0);
  const [active, setActive] = useState(canRefreshMail);
  const [retryDelay, setRetryDelay] = useState(REFRESH_INTERVAL_MS);
  const revision = useRef(0);
  const pending = useRef<Promise<void> | null>(null);
  const knownMessages = useRef(new Map<string, Set<string>>());
  const refresh = useCallback((): Promise<void> => {
    // Manual, periodic, focus, and realtime refreshes share one read.
    if (pending.current) return pending.current;
    const request = ++revision.current;
    if (!client) {
      setSnapshot({ ...empty, owner: client });
      return Promise.resolve();
    }
    setSnapshot((previous) => ({ ...previous, loading: true, errors: [] }));
    const read = async () => {
      try {
        const allConnections = await client.listConnections(true);
        if (request !== revision.current) return;
        const reconnectRequired = allConnections
          .filter(
            (entry) =>
              entry.status === "reconnect_required" &&
              (entry.provider === "gmail" || entry.provider === "outlook"),
          )
          .map((entry) => entry.provider as PersonalMailProvider);
        const connections = allConnections.filter(
          (entry): entry is MailConnection =>
            entry.status === "connected" &&
            (entry.provider === "gmail" || entry.provider === "outlook"),
        );
        const accountKey = (connection: MailConnection) =>
          `${connection.provider}:${connection.externalAccountLabel ?? ""}`;
        const currentAccounts = new Set(connections.map(accountKey));
        for (const key of knownMessages.current.keys()) {
          if (!currentAccounts.has(key)) knownMessages.current.delete(key);
        }
        const previous =
          snapshotRef.current.owner === client ? snapshotRef.current : empty;
        const retained = previous.messages.filter((row) =>
          connections.some(
            (connection) =>
              connection.provider === row.provider &&
              (connection.externalAccountLabel ??
                mailProviderLabel(connection.provider)) === row.accountLabel,
          ),
        );
        setSnapshot({
          ...previous,
          connections,
          reconnectRequired,
          messages: retained,
          loading: connections.length > 0,
          errors: [],
          owner: client,
          newMessageCount: connections.length ? previous.newMessageCount : 0,
        });
        const results = await Promise.allSettled(
          connections.map(async (connection) => {
            const messages = await client.listMessages({
              provider: connection.provider,
            });
            return messages.map((message) => ({
              ...message,
              provider: connection.provider,
              accountLabel:
                connection.externalAccountLabel ??
                mailProviderLabel(connection.provider),
            }));
          }),
        );
        if (request !== revision.current) return;
        let discovered = 0;
        const messages = results.flatMap((result, index) => {
          const connection = connections[index]!;
          const key = accountKey(connection);
          if (result.status === "rejected") {
            const denied =
              result.reason instanceof ApiClientError &&
              [401, 403].includes(result.reason.status);
            if (denied) {
              knownMessages.current.delete(key);
              return [];
            }
            return retained.filter(
              (row) => row.provider === connection.provider,
            );
          }
          const known = knownMessages.current.get(key);
          if (known)
            discovered += result.value.filter(
              (row) => !known.has(row.id),
            ).length;
          // Keep only the current bounded page; the first successful read is a baseline.
          knownMessages.current.set(
            key,
            new Set(result.value.map((row) => row.id)),
          );
          return result.value;
        });
        const date = (row: MailRow) => {
          const value = Date.parse(row.receivedAt ?? "");
          return Number.isFinite(value) ? value : -Infinity;
        };
        messages.sort(
          (a, b) =>
            date(b) - date(a) ||
            `${a.provider}:${a.id}`.localeCompare(`${b.provider}:${b.id}`),
        );
        const errors = results.flatMap((result, index) =>
          result.status === "rejected"
            ? [
                `No pudimos cargar ${mailProviderLabel(connections[index]!.provider)}. Actualiza o revisa la conexión.`,
              ]
            : [],
        );
        setRetryDelay((delay) =>
          errors.length
            ? Math.min(delay * 2, MAX_RETRY_INTERVAL_MS)
            : REFRESH_INTERVAL_MS,
        );
        setSnapshot((current) => ({
          connections,
          reconnectRequired,
          messages,
          loading: false,
          owner: client,
          errors,
          newMessageCount: current.newMessageCount + discovered,
        }));
      } catch (error) {
        if (request === revision.current) {
          setRetryDelay((delay) => Math.min(delay * 2, MAX_RETRY_INTERVAL_MS));
          const denied =
            error instanceof ApiClientError &&
            [401, 403].includes(error.status);
          if (denied) knownMessages.current.clear();
          setSnapshot((current) => ({
            ...(denied || current.owner !== client ? empty : current),
            loading: false,
            owner: client,
            errors: [
              "No pudimos comprobar tus conexiones de correo. Reintenta.",
            ],
          }));
        }
      }
    };
    const promise = read().finally(() => {
      if (request === revision.current) pending.current = null;
    });
    pending.current = promise;
    return promise;
  }, [client]);
  useEffect(() => {
    knownMessages.current.clear();
    snapshotRef.current = { ...empty, owner: client };
    setSnapshot(snapshotRef.current);
    setRetryDelay(REFRESH_INTERVAL_MS);
    if (canRefreshMail()) void refresh();
    const clear = () => {
      ++revision.current;
      pending.current = null;
      knownMessages.current.clear();
      snapshotRef.current = { ...empty, owner: client };
      setSnapshot(snapshotRef.current);
      setSessionRevision((value) => value + 1);
      setRetryDelay(REFRESH_INTERVAL_MS);
      if (canRefreshMail()) void refresh();
    };
    window.addEventListener("savia:identity-changed", clear);
    window.addEventListener("savia:session-cleared", clear);
    return () => {
      ++revision.current;
      pending.current = null;
      window.removeEventListener("savia:identity-changed", clear);
      window.removeEventListener("savia:session-cleared", clear);
    };
  }, [client, refresh]);
  useEffect(() => {
    const resume = () => {
      const available = canRefreshMail();
      setActive(available);
      if (available) void refresh();
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    window.addEventListener("offline", resume);
    window.addEventListener("focus", resume);
    return () => {
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
      window.removeEventListener("offline", resume);
      window.removeEventListener("focus", resume);
    };
  }, [refresh]);
  useEffect(() => {
    if (
      !client ||
      !active ||
      snapshot.loading ||
      (!snapshot.connections.length && !snapshot.errors.length)
    )
      return;
    const timer = setTimeout(() => {
      if (canRefreshMail()) void refresh();
    }, retryDelay);
    return () => clearTimeout(timer);
  }, [client, active, snapshot, retryDelay, refresh, sessionRevision]);
  useRealtimeRefresh({
    topics: ["personal-integrations"],
    enabled: Boolean(client) && active,
    refresh,
  });
  const dismissNewMessages = useCallback(() => {
    setSnapshot((current) => ({ ...current, newMessageCount: 0 }));
  }, []);
  return {
    ...(snapshot.owner === client
      ? snapshot
      : { ...empty, loading: Boolean(client) }),
    sessionRevision,
    refresh,
    dismissNewMessages,
  };
}
