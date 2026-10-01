import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PersonalMailMessage,
  PersonalMailProvider,
  SendPersonalMailInput,
} from "@savia/studio-shared/mail-contracts";
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
};
export function useMyDayMail(client: PersonalMailLike | undefined): MailState {
  const [snapshot, setSnapshot] = useState({ ...empty, owner: client });
  const [sessionRevision, setSessionRevision] = useState(0);
  const revision = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++revision.current;
    if (!client) {
      setSnapshot({ ...empty, owner: client });
      return;
    }
    setSnapshot((previous) => ({ ...previous, loading: true, errors: [] }));
    try {
      const allConnections = await client.listConnections(true);
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
      if (request !== revision.current) return;
      setSnapshot({
        connections,
        reconnectRequired,
        messages: [],
        loading: connections.length > 0,
        errors: [],
        owner: client,
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
      const messages = results.flatMap((result) =>
        result.status === "fulfilled" ? result.value : [],
      );
      const date = (row: MailRow) => {
        const value = Date.parse(row.receivedAt ?? "");
        return Number.isFinite(value) ? value : -Infinity;
      };
      messages.sort(
        (a, b) =>
          date(b) - date(a) ||
          `${a.provider}:${a.id}`.localeCompare(`${b.provider}:${b.id}`),
      );
      setSnapshot({
        connections,
        reconnectRequired,
        messages,
        loading: false,
        owner: client,
        errors: results.flatMap((result, index) =>
          result.status === "rejected"
            ? [
                `No pudimos cargar ${mailProviderLabel(connections[index]!.provider)}. Actualiza o revisa la conexión.`,
              ]
            : [],
        ),
      });
    } catch {
      if (request === revision.current)
        setSnapshot({
          ...empty,
          owner: client,
          errors: ["No pudimos comprobar tus conexiones de correo. Reintenta."],
        });
    }
  }, [client]);
  useEffect(() => {
    void refresh();
    const clear = () => {
      ++revision.current;
      setSnapshot({ ...empty, owner: client });
      setSessionRevision((value) => value + 1);
      void refresh();
    };
    window.addEventListener("savia:identity-changed", clear);
    window.addEventListener("savia:session-cleared", clear);
    return () => {
      ++revision.current;
      window.removeEventListener("savia:identity-changed", clear);
      window.removeEventListener("savia:session-cleared", clear);
    };
  }, [client, refresh]);
  useRealtimeRefresh({
    topics: ["personal-integrations"],
    enabled: Boolean(client),
    refresh,
  });
  return {
    ...(snapshot.owner === client
      ? snapshot
      : { ...empty, loading: Boolean(client) }),
    sessionRevision,
    refresh,
  };
}
