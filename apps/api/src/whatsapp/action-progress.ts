import type { WhatsappQueueScope } from "./queue";
import type { ChannelAction } from "./channel-contracts";
import type { WhatsappAssistantBinding } from "./inbound-contracts";
import { WhatsappChannelRepository } from "./channel-repository";
import { diagnosticErrorCode, logWhatsappDiagnostic } from "./diagnostics";

const SEND_DEADLINE_MS = 15_000;
const MAX_TEXT_LENGTH = 4096;
const LEASE_MS = 60_000;

type ProgressRow = {
  id: string;
  action_id: string;
  event_key: string;
  progress_text: string;
  created_at: string;
  status: string;
  retry_at: string | null;
  lease_token: string | null;
  outbound_message_id: string | null;
  delivery_text: string | null;
  delivery_at: string | null;
  tenant_id: number;
  connection_id: string;
  contact: string;
  generation: string;
  employee_id: string;
  selection_revision: number;
  action_status: string;
};

type ActionIdentity = Pick<
  ProgressRow,
  | "action_id"
  | "tenant_id"
  | "connection_id"
  | "contact"
  | "generation"
  | "employee_id"
  | "selection_revision"
  | "action_status"
>;

function historyStatement(
  repository: WhatsappChannelRepository,
  row: ActionIdentity,
  token: string,
  text: string,
  at: string,
  outboundMessageId: string,
) {
  return repository.db
    .prepare(
      `INSERT INTO whatsapp_channel_history(message_id,connection_id,contact,generation,employee_id,user_text,assistant_text,created_at)
       SELECT ?,?,?,?,?,?,?,? WHERE EXISTS (
         SELECT 1 FROM whatsapp_channel_action_progress
         WHERE action_id=? AND lease_token=? AND status IN ('sent','history_pending')
           AND outbound_message_id=?
       ) ON CONFLICT(message_id) DO NOTHING`,
    )
    .bind(
      `action-progress:${token}`,
      row.connection_id,
      row.contact,
      row.generation,
      row.employee_id,
      "[Progress update]",
      text,
      at,
      row.action_id,
      token,
      outboundMessageId,
    );
}

export async function enqueueChannelActionProgress(
  repository: WhatsappChannelRepository,
  action: ChannelAction,
  eventKey: string,
  text: string,
): Promise<void> {
  if (!eventKey.trim() || !text.trim())
    throw new Error("CHANNEL_PROGRESS_EVENT_INVALID");
  await repository.db.batch([
    repository.db
      .prepare(
        `INSERT INTO whatsapp_channel_action_progress
        (id,action_id,event_key,progress_text,status,created_at)
       SELECT ?,a.id,?,?,'pending',? FROM whatsapp_channel_actions a
       WHERE a.id=? AND a.status IN ('dispatching','completed','failed','uncertain')
         AND a.delivery_state IS NULL
       ON CONFLICT(action_id,event_key) DO NOTHING`,
      )
      .bind(
        crypto.randomUUID(),
        eventKey,
        text.trim().slice(0, MAX_TEXT_LENGTH),
        new Date().toISOString(),
        action.id,
      ),
  ]);
}

export async function deliverChannelActionProgress(
  repository: WhatsappChannelRepository,
  resolve: (
    connectionId: string,
    tenantId: number,
  ) => Promise<WhatsappAssistantBinding | undefined>,
  send: (
    binding: WhatsappAssistantBinding,
    text: string,
    phone: string,
  ) => Promise<string>,
  scope?: WhatsappQueueScope,
): Promise<{ delivered: number }> {
  const db = repository.db;
  const now = new Date().toISOString();
  const scopeSql = scope ? " AND a.connection_id=? AND a.contact=?" : "";
  const scopeValues = scope ? [scope.connectionId, scope.contact] : [];
  let delivered = 0;

  // An expired send lease is ambiguous: the provider may have accepted it.
  // Keep it terminal so recovery never blindly sends it again.
  await db
    .prepare(
      `UPDATE whatsapp_channel_action_progress SET status='uncertain',lease_until=NULL,lease_token=NULL
       WHERE status='sending' AND (lease_until IS NULL OR lease_until<=?)
         ${scope ? "AND action_id IN (SELECT id FROM whatsapp_channel_actions WHERE connection_id=? AND contact=?)" : ""}`,
    )
    .bind(now, ...scopeValues)
    .run();

  const repairs = await db
    .prepare(
      `SELECT p.action_id,p.lease_token,p.outbound_message_id,p.delivery_text,p.delivery_at,
              a.tenant_id,a.connection_id,a.contact,a.generation,a.employee_id,a.selection_revision,a.status AS action_status
       FROM whatsapp_channel_action_progress p
       JOIN whatsapp_channel_actions a ON a.id=p.action_id
       WHERE p.status='history_pending' AND p.lease_token IS NOT NULL
         AND (p.retry_at IS NULL OR p.retry_at<=?)${scopeSql}
       GROUP BY p.action_id,p.lease_token,p.outbound_message_id,p.delivery_text,p.delivery_at,
                a.tenant_id,a.connection_id,a.contact,a.generation,a.employee_id,a.selection_revision,a.status
       ORDER BY MIN(p.created_at) LIMIT 10`,
    )
    .bind(now, ...scopeValues)
    .all<
      ActionIdentity & {
        lease_token: string;
        outbound_message_id: string | null;
        delivery_text: string | null;
        delivery_at: string | null;
      }
    >();
  for (const row of repairs.results) {
    if (!row.outbound_message_id || !row.delivery_text || !row.delivery_at) {
      await db
        .prepare(
          "UPDATE whatsapp_channel_action_progress SET status='uncertain',lease_until=NULL WHERE action_id=? AND lease_token=? AND status='history_pending'",
        )
        .bind(row.action_id, row.lease_token)
        .run();
      continue;
    }
    try {
      const repaired = await db.batch([
        db
          .prepare(
            `UPDATE whatsapp_channel_action_progress SET status='sent',retry_at=NULL,lease_until=NULL
             WHERE action_id=? AND lease_token=? AND status='history_pending' AND outbound_message_id=?`,
          )
          .bind(row.action_id, row.lease_token, row.outbound_message_id),
        historyStatement(
          repository,
          row,
          row.lease_token,
          row.delivery_text,
          row.delivery_at,
          row.outbound_message_id,
        ),
      ]);
      if (repaired[0]?.meta.changes) delivered++;
    } catch {
      // Preserve the known provider acknowledgement for a later history repair.
      await db
        .prepare(
          "UPDATE whatsapp_channel_action_progress SET retry_at=? WHERE action_id=? AND lease_token=? AND status='history_pending'",
        )
        .bind(
          new Date(Date.now() + 30_000).toISOString(),
          row.action_id,
          row.lease_token,
        )
        .run();
    }
  }

  // Progress attached to a completed action must not overtake its final reply.
  await db
    .prepare(
      `UPDATE whatsapp_channel_action_progress SET status='revoked'
       WHERE status='pending' AND action_id IN (
         SELECT id FROM whatsapp_channel_actions
         WHERE (status NOT IN ('dispatching','completed','failed','uncertain') OR delivery_state IS NOT NULL)
           ${scope ? "AND connection_id=? AND contact=?" : ""}
       )`,
    )
    .bind(...scopeValues)
    .run();

  const candidates = await db
    .prepare(
      `SELECT DISTINCT a.id AS action_id,a.tenant_id,a.connection_id,a.contact,a.generation,
              a.employee_id,a.selection_revision,a.status AS action_status
       FROM whatsapp_channel_actions a
       JOIN whatsapp_channel_action_progress p ON p.action_id=a.id
       WHERE a.status IN ('dispatching','completed','failed','uncertain') AND a.delivery_state IS NULL
         AND p.status='pending' AND (p.retry_at IS NULL OR p.retry_at<=?)${scopeSql}
       ORDER BY a.created_at LIMIT ${scope ? 1 : 10}`,
    )
    .bind(now, ...scopeValues)
    .all<ActionIdentity>();

  for (const action of candidates.results) {
    const pending = await db
      .prepare(
        `SELECT id,event_key,progress_text,created_at FROM whatsapp_channel_action_progress
         WHERE action_id=? AND status='pending' AND (retry_at IS NULL OR retry_at<=?) ORDER BY created_at,event_key LIMIT 100`,
      )
      .bind(action.action_id, now)
      .all<
        Pick<ProgressRow, "id" | "event_key" | "progress_text" | "created_at">
      >();
    if (!pending.results.length) continue;

    const selected: typeof pending.results = [];
    let text = "";
    for (const event of pending.results) {
      const clipped = event.progress_text.slice(0, MAX_TEXT_LENGTH);
      const combined = text ? `${text}\n${clipped}` : clipped;
      if (combined.length > MAX_TEXT_LENGTH) break;
      selected.push(event);
      text = combined;
    }
    if (!selected.length) continue;

    const token = crypto.randomUUID();
    const leaseUntil = new Date(Date.now() + LEASE_MS).toISOString();
    const placeholders = selected.map(() => "?").join(",");
    const claim = await db
      .prepare(
        `UPDATE whatsapp_channel_action_progress
         SET status='sending',retry_at=NULL,lease_until=?,lease_token=?
         WHERE action_id=? AND status='pending' AND id IN (${placeholders})
           AND NOT EXISTS (
             SELECT 1 FROM whatsapp_channel_action_progress
             WHERE action_id=? AND status='sending'
           ) AND EXISTS (
             SELECT 1 FROM whatsapp_channel_actions
             WHERE id=? AND status IN ('dispatching','completed','failed','uncertain')
               AND delivery_state IS NULL
           )`,
      )
      .bind(
        leaseUntil,
        token,
        action.action_id,
        ...selected.map((event) => event.id),
        action.action_id,
        action.action_id,
      )
      .run();
    if (claim.meta.changes !== selected.length) {
      await db
        .prepare(
          `UPDATE whatsapp_channel_action_progress
           SET status='pending',retry_at=?,lease_until=NULL,lease_token=NULL
           WHERE action_id=? AND lease_token=? AND status='sending'`,
        )
        .bind(
          new Date(Date.now() + 30_000).toISOString(),
          action.action_id,
          token,
        )
        .run();
      continue;
    }

    const queueWaitMs = Math.max(
      0,
      Date.now() - Date.parse(selected[0].created_at),
    );
    const deliveryStartedAt = Date.now();
    const logProgress = (
      outcome: string,
      error?: unknown,
      durationMs = Math.max(0, Date.now() - deliveryStartedAt),
    ) =>
      logWhatsappDiagnostic(
        "whatsapp_action_progress",
        { action_id: action.action_id },
        {
          stage: "delivery",
          outcome,
          duration_ms: durationMs,
          event_count: selected.length,
          queue_wait_ms: queueWaitMs,
          ...(error === undefined
            ? {}
            : { error_code: diagnosticErrorCode(error) }),
        },
      );

    let sendStarted = false;
    try {
      const key = {
        tenantId: action.tenant_id,
        connectionId: action.connection_id,
        contact: action.contact,
      };
      const access = await repository.getAccess(key);
      let session = await repository.getSession(key);
      const taskAllowed = (await repository.listTasks(access)).some(
        (task) => task.employeeId === action.employee_id,
      );
      const authorized = () =>
        access.generation === action.generation &&
        taskAllowed &&
        session?.access.generation === action.generation &&
        session.employeeId === action.employee_id &&
        session.selectionRevision === action.selection_revision;
      if (!authorized()) {
        await setState(action.action_id, token, "revoked");
        logProgress("revoked");
        continue;
      }
      const binding = await resolve(action.connection_id, action.tenant_id);
      if (
        !binding ||
        !binding.allowedContacts.includes(action.contact) ||
        binding.connection.id !== action.connection_id
      ) {
        await setState(action.action_id, token, "revoked");
        logProgress("revoked");
        continue;
      }
      const recent = await db
        .prepare(
          "SELECT message_id FROM whatsapp_inbox WHERE connection_id=? AND normalized_contact=? AND phone_number_id=? AND waba_id=? AND provider_timestamp>? LIMIT 1",
        )
        .bind(
          action.connection_id,
          action.contact,
          binding.connection.phoneNumberId,
          binding.connection.wabaId,
          new Date(Date.now() - 86400000).toISOString(),
        )
        .first();
      if (!recent) {
        await setState(action.action_id, token, "expired");
        logProgress("expired");
        continue;
      }
      // Re-read immediately before send to catch a reset or task reselection
      // while the binding and reply-window checks were in flight.
      session = await repository.getSession(key);
      if (
        !session ||
        session.access.generation !== action.generation ||
        session.employeeId !== action.employee_id ||
        session.selectionRevision !== action.selection_revision
      ) {
        await setState(action.action_id, token, "revoked");
        logProgress("revoked");
        continue;
      }
      const employee = await db
        .prepare(
          "SELECT id FROM assistant_virtual_employees WHERE id=? AND agency_id=? AND status='active'",
        )
        .bind(action.employee_id, action.tenant_id)
        .first();
      if (!employee) {
        await setState(action.action_id, token, "revoked");
        logProgress("revoked");
        continue;
      }
      const parent = await db
        .prepare(
          "SELECT status,delivery_state FROM whatsapp_channel_actions WHERE id=?",
        )
        .bind(action.action_id)
        .first<{ status: string; delivery_state: string | null }>();
      if (
        !parent ||
        !["dispatching", "completed", "failed", "uncertain"].includes(
          parent.status,
        ) ||
        parent.delivery_state !== null
      ) {
        await setState(action.action_id, token, "revoked");
        logProgress("revoked");
        continue;
      }

      sendStarted = true;
      const sendResult = await sendWithDeadline(
        send(binding, text, action.contact),
      );
      if (!sendResult.acknowledged) {
        await setState(action.action_id, token, "uncertain");
        logProgress("uncertain");
        continue;
      }
      const deliveredAt = new Date().toISOString();
      try {
        const saved = await db.batch([
          db
            .prepare(
              `UPDATE whatsapp_channel_action_progress SET status='sent',retry_at=NULL,outbound_message_id=?,delivery_text=?,delivery_at=?,lease_until=NULL
               WHERE action_id=? AND lease_token=? AND status='sending'`,
            )
            .bind(sendResult.id, text, deliveredAt, action.action_id, token),
          historyStatement(
            repository,
            action,
            token,
            text,
            deliveredAt,
            sendResult.id,
          ),
        ]);
        if (saved[0]?.meta.changes) delivered++;
        logProgress("sent");
      } catch {
        await db
          .prepare(
            `UPDATE whatsapp_channel_action_progress
             SET status='history_pending',retry_at=?,outbound_message_id=?,delivery_text=?,delivery_at=?,lease_until=NULL
             WHERE action_id=? AND lease_token=? AND status='sending'`,
          )
          .bind(
            new Date(Date.now() + 30_000).toISOString(),
            sendResult.id,
            text,
            deliveredAt,
            action.action_id,
            token,
          )
          .run();
        logProgress("history_pending");
      }
    } catch (error) {
      // Only failures before invoking the provider are safe to retry.
      const state = sendStarted
        ? "uncertain"
        : error instanceof Error &&
            ["CHANNEL_ROUTING_DISABLED", "CHANNEL_STAFF_REVOKED"].includes(
              error.message,
            )
          ? "revoked"
          : "pending";
      await setState(action.action_id, token, state);
      logProgress(state === "pending" ? "retry" : state, error);
    }
  }
  return { delivered };

  async function setState(
    actionId: string,
    token: string,
    state: "pending" | "uncertain" | "revoked" | "expired",
  ) {
    await db
      .prepare(
        "UPDATE whatsapp_channel_action_progress SET status=?,retry_at=?,lease_until=NULL,lease_token=NULL WHERE action_id=? AND lease_token=? AND status='sending'",
      )
      .bind(
        state,
        state === "pending"
          ? new Date(Date.now() + 30_000).toISOString()
          : null,
        actionId,
        token,
      )
      .run();
  }
}

function sendWithDeadline(sendPromise: Promise<string>) {
  return new Promise<
    { acknowledged: true; id: string } | { acknowledged: false }
  >((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ acknowledged: false });
    }, SEND_DEADLINE_MS);
    // A late rejection is consumed; a late acknowledgement is ignored.
    void sendPromise
      .then((id) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ acknowledged: true, id });
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ acknowledged: false });
      });
  });
}
