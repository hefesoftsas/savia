import type { ChannelAction, ActionOutcome } from "./channel-contracts";
import { WhatsappChannelActions } from "./confirmations";

export async function processChannelActions(
  actions: WhatsappChannelActions,
  execute: (
    action: ChannelAction,
    executionKey: string,
  ) => Promise<ActionOutcome>,
  limit = 3,
) {
  const db = actions.repository.db;
  const now = new Date().toISOString();
  await db
    .prepare(
      "UPDATE whatsapp_channel_actions SET status='uncertain',lease_token=NULL WHERE status='dispatching' AND lease_until<?",
    )
    .bind(now)
    .run();
  const rows = await db
    .prepare(
      "SELECT id,action_json FROM whatsapp_channel_actions WHERE status='queued' ORDER BY created_at LIMIT ?",
    )
    .bind(Math.max(1, Math.min(limit, 10)))
    .all<{ id: string; action_json: string }>();
  let completed = 0,
    uncertain = 0;
  for (const row of rows.results) {
    const token = crypto.randomUUID();
    const claim = await db
      .prepare(
        "UPDATE whatsapp_channel_actions SET status='dispatching',lease_token=?,lease_until=? WHERE id=? AND status='queued'",
      )
      .bind(token, new Date(Date.now() + 360000).toISOString(), row.id)
      .run();
    if (claim.meta.changes !== 1) continue;
    let outcome: ActionOutcome;
    try {
      const action = await actions.open(row.action_json);
      const current = await actions.repository.getAccess(action.session.access);
      if (
        current.generation !== action.session.access.generation ||
        !(await actions.repository.listTasks(current)).some(
          (t) => t.employeeId === action.session.employeeId,
        )
      )
        throw new Error("CHANNEL_ACTION_REVOKED");
      outcome = await execute(
        { ...action, session: { ...action.session, access: current } },
        row.id,
      );
    } catch {
      outcome = {
        state: "uncertain",
        message:
          "No se pudo verificar el resultado. Revisa el estado antes de repetir la solicitud.",
      };
    }
    await db
      .prepare(
        "UPDATE whatsapp_channel_actions SET status=?,result_json=?,lease_token=NULL,lease_until=NULL WHERE id=? AND status='dispatching' AND lease_token=?",
      )
      .bind(outcome.state, JSON.stringify(outcome), row.id, token)
      .run();
    if (outcome.state === "completed") completed++;
    else if (outcome.state === "uncertain") uncertain++;
  }
  return { completed, uncertain };
}
