import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PersonalMailMessage,
  PersonalMailPage,
  PersonalMailProvider,
  SendPersonalMailInput,
} from "@savia/studio-shared/mail-contracts";
import { ApiClientError } from "@/api/api-client";
import { useRealtimeRefresh } from "@/realtime/use-realtime-refresh";
import { translateMessage, useAppLocale } from "@/i18n/core";
import { myDayStateMessages } from "./my-day-state-messages";

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
  listMessagePage?(input: {
    provider: PersonalMailProvider;
    cursor?: string;
  }): Promise<PersonalMailPage>;
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
  loadingMore?: boolean;
  hasMore?: Partial<Record<PersonalMailProvider, boolean>>;
  loadMore?(providers?: PersonalMailProvider[]): Promise<void>;
  errors: string[];
  sessionRevision: number;
  newMessageCount?: number;
  dismissNewMessages?(): void;
  refresh(): Promise<void>;
};
type MailError =
  | string
  | {
      key: keyof typeof myDayStateMessages;
      params?: Readonly<Record<string, string | number>>;
    };
const mailError = (
  key: keyof typeof myDayStateMessages,
  params?: Readonly<Record<string, string | number>>,
): MailError => ({ key, params });
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
  loadingMore: false,
  hasMore: {} as Partial<Record<PersonalMailProvider, boolean>>,
  errors: [] as MailError[],
  newMessageCount: 0,
};
const REFRESH_INTERVAL_MS = 60_000;
const MAX_RETRY_INTERVAL_MS = 300_000;
const accountKey = (connection: MailConnection) =>
  `${connection.provider}:${connection.externalAccountLabel ?? ""}`;
function sortedRows(rows: MailRow[]) {
  const unique = [
    ...new Map(rows.map((row) => [`${row.provider}:${row.id}`, row])).values(),
  ];
  const date = (row: MailRow) => {
    const value = Date.parse(row.receivedAt ?? "");
    return Number.isFinite(value) ? value : -Infinity;
  };
  return unique.sort(
    (a, b) =>
      date(b) - date(a) ||
      `${a.provider}:${a.id}`.localeCompare(`${b.provider}:${b.id}`),
  );
}
function canRefreshMail() {
  return document.visibilityState === "visible" && navigator.onLine;
}
export function useMyDayMail(client: PersonalMailLike | undefined): MailState {
  const locale = useAppLocale();
  const [snapshot, setSnapshot] = useState({ ...empty, owner: client });
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const [sessionRevision, setSessionRevision] = useState(0);
  const [active, setActive] = useState(canRefreshMail);
  const [retryDelay, setRetryDelay] = useState(REFRESH_INTERVAL_MS);
  const revision = useRef(0);
  const pending = useRef<Promise<void> | null>(null);
  const knownMessages = useRef(new Map<string, Set<string>>());
  const continuations = useRef(new Map<string, string | null>());
  const history = useRef(new Map<string, MailRow[]>());
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
        const currentAccounts = new Set(connections.map(accountKey));
        for (const key of knownMessages.current.keys()) {
          if (!currentAccounts.has(key)) knownMessages.current.delete(key);
        }
        for (const key of continuations.current.keys()) {
          if (!currentAccounts.has(key)) {
            continuations.current.delete(key);
            history.current.delete(key);
          }
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
            const page = client.listMessagePage
              ? await client.listMessagePage({ provider: connection.provider })
              : {
                  messages: await client.listMessages({
                    provider: connection.provider,
                  }),
                  nextCursor: null,
                };
            return {
              nextCursor: page.nextCursor,
              messages: page.messages.map((message) => ({
                ...message,
                provider: connection.provider,
                accountLabel:
                  connection.externalAccountLabel ??
                  mailProviderLabel(connection.provider),
              })),
            };
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
              continuations.current.delete(key);
              history.current.delete(key);
              return [];
            }
            return retained.filter(
              (row) => row.provider === connection.provider,
            );
          }
          const known = knownMessages.current.get(key);
          if (known)
            discovered += result.value.messages.filter(
              (row) => !known.has(row.id),
            ).length;
          // Keep only the current bounded page; the first successful read is a baseline.
          knownMessages.current.set(
            key,
            new Set(result.value.messages.map((row) => row.id)),
          );
          if (!history.current.has(key))
            continuations.current.set(key, result.value.nextCursor);
          const rows = sortedRows([
            ...(history.current.get(key) ?? []),
            ...result.value.messages,
          ]);
          if (history.current.has(key)) history.current.set(key, rows);
          return rows;
        });
        const errors = results.flatMap((result, index) =>
          result.status === "rejected"
            ? [
                mailError(
                  "No pudimos cargar %{provider}. Actualiza o revisa la conexión.",
                  {
                    provider: mailProviderLabel(connections[index]!.provider),
                  },
                ),
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
          messages: sortedRows(messages),
          loading: false,
          loadingMore: false,
          hasMore: Object.fromEntries(
            connections.map((connection) => [
              connection.provider,
              Boolean(continuations.current.get(accountKey(connection))),
            ]),
          ),
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
          if (denied) {
            knownMessages.current.clear();
            continuations.current.clear();
            history.current.clear();
          }
          setSnapshot((current) => ({
            ...(denied || current.owner !== client ? empty : current),
            loading: false,
            owner: client,
            errors: [
              mailError("Could not check your mail connections. Try again."),
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
  const loadMore = useCallback(
    (providers?: PersonalMailProvider[]): Promise<void> => {
      if (pending.current) return pending.current;
      if (!client?.listMessagePage) return Promise.resolve();
      const request = revision.current;
      const previous = snapshotRef.current;
      const targets = previous.connections.filter(
        (connection) =>
          (!providers || providers.includes(connection.provider)) &&
          continuations.current.get(accountKey(connection)),
      );
      if (!targets.length) return Promise.resolve();
      setSnapshot((current) => ({ ...current, loadingMore: true, errors: [] }));
      const read = async () => {
        const results = await Promise.allSettled(
          targets.map(async (connection) => {
            const cursor = continuations.current.get(accountKey(connection))!;
            const page = await client.listMessagePage!({
              provider: connection.provider,
              cursor,
            });
            return { cursor, page };
          }),
        );
        if (request !== revision.current) return;
        let rows = [...previous.messages];
        const errors: MailError[] = [];
        for (const [index, result] of results.entries()) {
          const connection = targets[index]!;
          const key = accountKey(connection);
          if (result.status === "rejected") {
            if (
              result.reason instanceof ApiClientError &&
              [401, 403].includes(result.reason.status)
            ) {
              rows = rows.filter((row) => row.provider !== connection.provider);
              history.current.delete(key);
              continuations.current.delete(key);
              knownMessages.current.delete(key);
            }
            errors.push(
              mailError(
                "Could not load more mail from %{provider}. Try again.",
                {
                  provider: mailProviderLabel(connection.provider),
                },
              ),
            );
            continue;
          }
          const { cursor, page } = result.value;
          // A repeating upstream cursor cannot make progress. Stop that stream.
          continuations.current.set(
            key,
            page.nextCursor === cursor ? null : page.nextCursor,
          );
          const additions = page.messages.map((message) => ({
            ...message,
            provider: connection.provider,
            accountLabel:
              connection.externalAccountLabel ??
              mailProviderLabel(connection.provider),
          }));
          rows = sortedRows([...rows, ...additions]);
          history.current.set(
            key,
            rows.filter((row) => row.provider === connection.provider),
          );
        }
        setSnapshot((current) => ({
          ...current,
          messages: rows,
          errors,
          loadingMore: false,
          hasMore: Object.fromEntries(
            previous.connections.map((connection) => [
              connection.provider,
              Boolean(continuations.current.get(accountKey(connection))),
            ]),
          ),
        }));
      };
      const promise = read().finally(() => {
        if (request === revision.current) pending.current = null;
      });
      pending.current = promise;
      return promise;
    },
    [client],
  );
  useEffect(() => {
    knownMessages.current.clear();
    continuations.current.clear();
    history.current.clear();
    snapshotRef.current = { ...empty, owner: client };
    setSnapshot(snapshotRef.current);
    setRetryDelay(REFRESH_INTERVAL_MS);
    if (canRefreshMail()) void refresh();
    const clear = () => {
      ++revision.current;
      pending.current = null;
      knownMessages.current.clear();
      continuations.current.clear();
      history.current.clear();
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
      snapshot.loadingMore ||
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
  const state = {
    ...(snapshot.owner === client
      ? snapshot
      : { ...empty, loading: Boolean(client) }),
    sessionRevision,
    refresh,
    loadMore,
    dismissNewMessages,
  };
  return {
    ...state,
    errors: state.errors.map((error) =>
      typeof error === "string"
        ? error
        : translateMessage(myDayStateMessages, error.key, locale, error.params),
    ),
  };
}
