import type { AuthService } from "./better-auth";
import { findPrincipalBySubject } from "./identity-repository";
import { NotificationRepository } from "@savia/studio-server/notifications/repository";

export interface AuthNoticeEvent {
  id: string;
  subject: string;
  kind: "email-verified" | "two-factor-enabled";
  createdAt: number;
  expiresAt: number | null;
  requestId: string | null;
}

const ISSUER = "savia:better-auth";

export interface AuthBridgeOptions {
  bridgeKey?: string;
}

export async function importAuthNoticeEvents(
  authService: Pick<AuthService, "fetch">,
  db: D1Database,
  options: AuthBridgeOptions = {},
): Promise<{ accepted: number; acknowledged: number }> {
  const headers: Record<string, string> = {};
  if (options.bridgeKey) headers["x-savia-bridge-key"] = options.bridgeKey;
  const read = await authService.fetch(
    new Request("https://savia-auth.internal/_internal/notification-events/read?limit=100", {
      headers,
    }),
  );
  if (read.status === 403) throw Object.assign(new Error("Forbidden bridge access."), { status: 403 });
  if (!read.ok) throw new Error(`Auth notice bridge failed with status ${read.status}.`);
  const { events } = (await read.json()) as { events: AuthNoticeEvent[] };
  const repository = new NotificationRepository(db);
  let accepted = 0;
  const done: string[] = [];
  for (const event of events.slice(0, 100)) {
    const principal = await findPrincipalBySubject(db, ISSUER, event.subject);
    if (!principal || !principal.isActive) continue;
    const result = await repository.accept({
      scope: { kind: "account", id: principal.id },
      key: `auth:${event.id}`,
      actor: { kind: "system", id: null },
      source: { kind: "security-request", id: event.id },
      title:
        event.kind === "email-verified" ? "Email verified" : "Two-factor authentication enabled",
      body: "",
      audience: { kind: "explicit", principals: [principal.id] },
      createdAt: event.createdAt,
      expiresAt: event.expiresAt,
    });
    if (!result.duplicate) accepted += 1;
    done.push(event.id);
  }
  if (done.length === 0) return { accepted, acknowledged: 0 };
  const ack = await authService.fetch(
    new Request("https://savia-auth.internal/_internal/notification-events/ack", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ ids: done }),
    }),
  );
  if (!ack.ok) throw new Error(`Auth notice acknowledgement failed with status ${ack.status}.`);
  const { acknowledged } = (await ack.json()) as { acknowledged: number };
  return { accepted, acknowledged };
}
