import type { WhatsappQueueScope } from "./queue";
import { humanSupportContactText } from "./human-support";
import type { ActionOutcome } from "./channel-contracts";
import type { WhatsappAssistantBinding } from "./inbound-contracts";
import {
  WhatsappChannelRepository,
  type PreparedQuoteLifecycleReset,
} from "./channel-repository";
import { buildTaskMenu } from "./task-menu";
import { diagnosticErrorCode, logWhatsappDiagnostic } from "./diagnostics";

type ResultDelivery = {
  id: string;
  tenant_id: number;
  connection_id: string;
  contact: string;
  generation: string;
  employee_id: string;
  action_json: string;
  result_json: string | null;
  delivery_state: string | null;
  outbound_message_id: string | null;
  selection_revision: number;
};

export function actionResultText(
  employee: string,
  command: string,
  outcome: ActionOutcome,
  humanSupportContact = "",
  menuText = "",
): string {
  const label = `${employee} · Asistente virtual\n\n`;
  const withMenu = (body: string) => {
    if (!menuText) return body.slice(0, 4096);
    const suffix = `\n\n${menuText.slice(0, 4000)}`;
    return `${body.slice(0, Math.max(0, 4096 - suffix.length))}${suffix}`;
  };
  const value = outcome.result as Record<string, unknown> | null;
  const isQuote = command === "quote-auto" && value?.reference;
  if (outcome.state !== "completed" && !isQuote)
    return withMenu(
      `${label}${outcome.message}\n${humanSupportContactText(humanSupportContact)}\nEscribe menú para elegir otra tarea.`,
    );
  if (!isQuote)
    return withMenu(
      `${label}${({ "create-record": "Registro creado.", "update-record": "Registro actualizado.", "delete-record": "Registro eliminado.", "send-email": "Correo enviado.", "create-event": "Evento creado.", "upload-file": "Archivo guardado." } as Record<string, string>)[command] ?? "Solicitud completada."}\nEscribe menú para elegir otra tarea.`,
    );
  const offers = Array.isArray(value.lowestPriceOffers)
    ? (value.lowestPriceOffers as Array<{ product: string; premium: number }>)
    : [];
  const warnings = Array.isArray(value.persistenceWarnings)
    ? value.persistenceWarnings
        .filter((warning): warning is string => typeof warning === "string")
        .slice(0, 3)
        .map((warning) => warning.slice(0, 250))
    : [];
  const noPrice = Number(value.pricedOffers ?? 0) === 0;
  const hasPartialResults =
    outcome.state !== "completed" ||
    Number(value.failedOffers ?? 0) > 0 ||
    Number(value.uncertainOffers ?? 0) > 0 ||
    Number(value.unpricedOffers ?? 0) > 0;
  const quoteText = [
    `${label}${hasPartialResults ? "Resultados parciales" : "Resultados"} de ${value.reference}`,
    `Ofertas con precio: ${value.pricedOffers ?? 0}. Respuestas fallidas: ${value.failedOffers ?? 0}.`,
    Number(value.uncertainOffers ?? 0) > 0
      ? `Sin resultado verificado: ${value.uncertainOffers}. Revisa su historial antes de volver a cotizar.`
      : "",
    Number(value.unpricedOffers ?? 0) > 0
      ? `Respuestas sin precio: ${value.unpricedOffers}.`
      : "",
    ...offers
      .slice(0, 5)
      .map(
        (o) => `${o.product}: $${Number(o.premium).toLocaleString("es-CO")}`,
      ),
    value.recommendation ??
      "Consulta las coberturas antes de elegir una oferta.",
    ...warnings,
    outcome.state !== "completed" ? outcome.message : "",
    noPrice ? "No recibí ofertas con precio." : "",
    noPrice ? humanSupportContactText(humanSupportContact) : "",
    menuText
      ? "Elige una opción del menú para empezar una nueva tarea."
      : "Puedes preguntarme por esta cotización o escribir menú para elegir otra tarea.",
  ]
    .filter(Boolean)
    .join("\n");
  return withMenu(quoteText);
}

export async function deliverChannelActionResults(
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
) {
  const db = repository.db;
  let delivered = 0;
  const scopeSql = scope ? " AND connection_id=? AND contact=?" : "";
  const scopeValues = scope ? [scope.connectionId, scope.contact] : [];
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE whatsapp_channel_actions SET delivery_state='uncertain',lease_until=NULL
       WHERE status IN ('completed','failed','uncertain') AND delivery_state='sending'
         AND (lease_until IS NULL OR lease_until<=?)${scopeSql}`,
    )
    .bind(now, ...scopeValues)
    .run();
  const rows = await db
    .prepare(
      `SELECT id,tenant_id,connection_id,contact,generation,employee_id,selection_revision,action_json,result_json,delivery_state,outbound_message_id FROM whatsapp_channel_actions WHERE status IN ('completed','failed','uncertain') AND (delivery_state IS NULL OR delivery_state='history_pending')${scopeSql} ORDER BY created_at LIMIT ${scope ? 1 : 10}`,
    )
    .bind(...(scope ? [scope.connectionId, scope.contact] : []))
    .all<ResultDelivery>();
  const historyStatement = (
    row: ResultDelivery,
    text: string,
    at: string,
    outboundMessageId = row.outbound_message_id,
    resultJson = row.result_json,
  ) =>
    db
      .prepare(
        `INSERT INTO whatsapp_channel_history(message_id,connection_id,contact,generation,employee_id,user_text,assistant_text,created_at)
         SELECT ?,?,?,?,?,?,?,? WHERE EXISTS (
           SELECT 1 FROM whatsapp_channel_actions WHERE id=? AND delivery_state='sent'
             AND outbound_message_id=?
             AND (result_json=? OR (result_json IS NULL AND CAST(? AS TEXT) IS NULL))
         ) ON CONFLICT(message_id) DO NOTHING`,
      )
      .bind(
        `action-result:${row.id}`,
        row.connection_id,
        row.contact,
        row.generation,
        row.employee_id,
        "[Result of confirmed action]",
        text,
        at,
        row.id,
        outboundMessageId,
        resultJson,
        resultJson,
      );
  for (const row of rows.results) {
    const startedAt = Date.now();
    const diagnosticContext = {
      action_id: row.id,
      generation: row.generation,
      selection_revision: row.selection_revision,
    };
    let stage = "prepare";
    let stageStartedAt = startedAt;
    const logStage = (
      name: string,
      outcome: string,
      at = startedAt,
      error?: unknown,
    ) =>
      logWhatsappDiagnostic(
        "whatsapp_action_result_timing",
        diagnosticContext,
        {
          stage: name,
          outcome,
          duration_ms: Math.max(0, Date.now() - at),
          ...(error === undefined
            ? {}
            : { error_code: diagnosticErrorCode(error) }),
        },
      );
    let claimed = false;
    let sendAttempted = false;
    let acknowledged: {
      id: string;
      text: string;
      at: string;
      outcome: ActionOutcome;
      preparedReset: PreparedQuoteLifecycleReset | null;
    } | null = null;
    try {
      if (row.delivery_state === "history_pending") {
        stage = "history_repair";
        const repairStartedAt = Date.now();
        const saved = row.result_json ? JSON.parse(row.result_json) : undefined;
        if (
          !row.outbound_message_id ||
          typeof saved?.deliveryText !== "string" ||
          typeof saved?.deliveryAt !== "string"
        ) {
          await db
            .prepare(
              "UPDATE whatsapp_channel_actions SET delivery_state='revoked',lease_until=NULL WHERE id=? AND delivery_state='history_pending'",
            )
            .bind(row.id)
            .run();
          logStage("history_repair", "revoked", repairStartedAt);
          continue;
        }
        let resetStatements: D1PreparedStatement[] = [];
        const action = JSON.parse(row.action_json);
        const savedReset = saved?.quoteReset as
          PreparedQuoteLifecycleReset | undefined;
        if (
          action.domain === "insurance" &&
          action.command === "quote-auto" &&
          savedReset?.generation &&
          savedReset.menu?.id
        ) {
          try {
            const access = await repository.getAccess({
              tenantId: row.tenant_id,
              connectionId: row.connection_id,
              contact: row.contact,
            });
            if (access.generation === row.generation) {
              resetStatements = repository.quoteLifecycleResetStatements(
                access,
                row.selection_revision,
                row.employee_id,
                savedReset,
                {
                  kind: "action-result",
                  actionId: row.id,
                  outboundMessageId: row.outbound_message_id,
                },
              );
            }
          } catch {
            // History repair remains valid when current authorization changed.
          }
        }
        // Repair only persistence for a known acknowledgement, even if the
        // authorization or reply window has since changed. Never resend.
        const repair = await db.batch([
          db
            .prepare(
              "UPDATE whatsapp_channel_actions SET delivery_state='sent',lease_until=NULL WHERE id=? AND delivery_state='history_pending' AND outbound_message_id=? AND result_json=?",
            )
            .bind(row.id, row.outbound_message_id, row.result_json),
          historyStatement(row, saved.deliveryText, saved.deliveryAt),
          ...resetStatements,
        ]);
        logStage(
          "history_repair",
          repair[0]?.meta.changes === 1 ? "repaired" : "stale",
          repairStartedAt,
        );
        if (resetStatements.length) {
          const applied = repair[2]?.meta.changes === 1;
          logWhatsappDiagnostic(
            "whatsapp_quote_lifecycle_reset",
            diagnosticContext,
            {
              stage: "history_repair",
              outcome: applied ? "applied" : "skipped",
              reset_applied: applied,
            },
          );
        } else if (
          action.domain === "insurance" &&
          action.command === "quote-auto"
        ) {
          logWhatsappDiagnostic(
            "whatsapp_quote_lifecycle_reset",
            diagnosticContext,
            {
              stage: "history_repair",
              outcome: "skipped",
              reset_applied: false,
            },
          );
        }
        if (repair[0]?.meta.changes === 1) delivered++;
        continue;
      }

      let access;
      try {
        access = await repository.getAccess({
          tenantId: row.tenant_id,
          connectionId: row.connection_id,
          contact: row.contact,
        });
      } catch (error) {
        if (
          error instanceof Error &&
          ["CHANNEL_ROUTING_DISABLED", "CHANNEL_STAFF_REVOKED"].includes(
            error.message,
          )
        ) {
          await db
            .prepare(
              "UPDATE whatsapp_channel_actions SET delivery_state='revoked',lease_until=NULL WHERE id=? AND delivery_state IS NULL",
            )
            .bind(row.id)
            .run();
          logStage("access", "revoked", startedAt, error);
        } else {
          logStage("access", "retryable", startedAt, error);
        }
        continue;
      }
      if (
        access.generation !== row.generation ||
        !(await repository.listTasks(access)).some(
          (t) => t.employeeId === row.employee_id,
        )
      ) {
        await db
          .prepare(
            "UPDATE whatsapp_channel_actions SET delivery_state='revoked',lease_until=NULL WHERE id=? AND delivery_state IS NULL",
          )
          .bind(row.id)
          .run();
        logStage("access", "revoked", startedAt);
        continue;
      }
      const binding = await resolve(row.connection_id, row.tenant_id);
      if (!binding?.allowedContacts.includes(row.contact)) {
        await db
          .prepare(
            "UPDATE whatsapp_channel_actions SET delivery_state='revoked',lease_until=NULL WHERE id=? AND delivery_state IS NULL",
          )
          .bind(row.id)
          .run();
        logStage("binding", "revoked", startedAt);
        continue;
      }
      const recent = await db
        .prepare(
          "SELECT message_id FROM whatsapp_inbox WHERE connection_id=? AND normalized_contact=? AND phone_number_id=? AND waba_id=? AND provider_timestamp>? LIMIT 1",
        )
        .bind(
          row.connection_id,
          row.contact,
          binding.connection.phoneNumberId,
          binding.connection.wabaId,
          new Date(Date.now() - 86400000).toISOString(),
        )
        .first();
      if (!recent) {
        await db
          .prepare(
            "UPDATE whatsapp_channel_actions SET delivery_state='expired',lease_until=NULL WHERE id=? AND delivery_state IS NULL",
          )
          .bind(row.id)
          .run();
        logStage("reply_window", "expired", startedAt);
        continue;
      }
      const employee = await db
        .prepare(
          "SELECT name FROM assistant_virtual_employees WHERE id=? AND agency_id=? AND status='active'",
        )
        .bind(row.employee_id, row.tenant_id)
        .first<{ name: string }>();
      if (!employee) {
        await db
          .prepare(
            "UPDATE whatsapp_channel_actions SET delivery_state='revoked',lease_until=NULL WHERE id=? AND delivery_state IS NULL",
          )
          .bind(row.id)
          .run();
        logStage("employee", "revoked", startedAt);
        continue;
      }
      const claimUntil = new Date(Date.now() + 60_000).toISOString();
      const claim = await db
        .prepare(
          "UPDATE whatsapp_channel_actions SET delivery_state='sending',lease_until=? WHERE id=? AND delivery_state IS NULL",
        )
        .bind(claimUntil, row.id)
        .run();
      if (claim.meta.changes !== 1) continue;
      claimed = true;
      let finalAccess;
      try {
        finalAccess = await repository.getAccess(access);
      } catch (error) {
        if (
          error instanceof Error &&
          ["CHANNEL_ROUTING_DISABLED", "CHANNEL_STAFF_REVOKED"].includes(
            error.message,
          )
        ) {
          await db
            .prepare(
              "UPDATE whatsapp_channel_actions SET delivery_state='revoked',lease_until=NULL WHERE id=? AND delivery_state='sending'",
            )
            .bind(row.id)
            .run();
          claimed = false;
          logStage("final_access", "revoked", startedAt, error);
          continue;
        }
        throw error;
      }
      const finalBinding = await resolve(row.connection_id, row.tenant_id);
      if (
        finalAccess.generation !== row.generation ||
        !(await repository.listTasks(finalAccess)).some(
          (t) => t.employeeId === row.employee_id,
        ) ||
        !finalBinding?.allowedContacts.includes(row.contact) ||
        finalBinding.ownerPrincipalId !== binding.ownerPrincipalId ||
        finalBinding.connection.phoneNumberId !==
          binding.connection.phoneNumberId ||
        finalBinding.connection.wabaId !== binding.connection.wabaId
      ) {
        await db
          .prepare(
            "UPDATE whatsapp_channel_actions SET delivery_state='revoked',lease_until=NULL WHERE id=? AND delivery_state='sending'",
          )
          .bind(row.id)
          .run();
        logStage("final_access", "revoked", startedAt);
        continue;
      }
      const action = JSON.parse(row.action_json);
      const outcome = row.result_json
        ? JSON.parse(row.result_json)
        : {
            state: "uncertain",
            message:
              "El resultado requiere revisión. No repitas automáticamente esta solicitud.",
          };
      const supportContact =
        (await repository.settings(row.tenant_id, row.connection_id))?.config
          .humanSupportContact ?? "";
      const resetsQuoteLifecycle =
        action.domain === "insurance" && action.command === "quote-auto";
      const resetPrepareStartedAt = Date.now();
      const preparedReset = resetsQuoteLifecycle
        ? await repository.prepareQuoteLifecycleReset(
            finalAccess,
            row.selection_revision,
            row.employee_id,
            row.id,
          )
        : null;
      if (resetsQuoteLifecycle && !preparedReset)
        logWhatsappDiagnostic(
          "whatsapp_quote_lifecycle_reset",
          diagnosticContext,
          {
            stage: "prepare",
            outcome: "skipped",
            duration_ms: Math.max(0, Date.now() - resetPrepareStartedAt),
            reset_applied: false,
          },
        );
      const menuText = preparedReset
        ? String(buildTaskMenu(preparedReset.menu, false))
        : "";
      const text = actionResultText(
        employee.name,
        action.command,
        outcome,
        supportContact,
        menuText,
      );
      sendAttempted = true;
      stage = "send";
      const sendStartedAt = Date.now();
      stageStartedAt = sendStartedAt;
      const id = await send(finalBinding, text, row.contact);
      logStage("send", "acknowledged", sendStartedAt);
      acknowledged = {
        id,
        text,
        at: new Date().toISOString(),
        outcome,
        preparedReset,
      };
      const acknowledgedResult = JSON.stringify({
        ...outcome,
        deliveryText: text,
        deliveryAt: acknowledged.at,
        ...(preparedReset ? { quoteReset: preparedReset } : {}),
      });
      // Record only acknowledged deliveries in the originating history scope.
      // A stable delivery ID also deduplicates history.
      const statements: D1PreparedStatement[] = [
        db
          .prepare(
            `UPDATE whatsapp_channel_actions SET delivery_state='sent',outbound_message_id=?,result_json=?,lease_until=NULL
             WHERE id=? AND delivery_state='sending'
               AND (result_json=? OR (result_json IS NULL AND CAST(? AS TEXT) IS NULL))`,
          )
          .bind(
            id,
            acknowledgedResult,
            row.id,
            row.result_json,
            row.result_json,
          ),
        historyStatement(row, text, acknowledged.at, id, acknowledgedResult),
      ];
      if (preparedReset)
        statements.push(
          ...repository.quoteLifecycleResetStatements(
            finalAccess,
            row.selection_revision,
            row.employee_id,
            preparedReset,
            { kind: "action-result", actionId: row.id, outboundMessageId: id },
          ),
        );
      stage = "ack_persistence";
      const persistenceStartedAt = Date.now();
      stageStartedAt = persistenceStartedAt;
      const persisted = await db.batch(statements);
      logStage("ack_persistence", "persisted", persistenceStartedAt);
      if (preparedReset) {
        const applied = persisted[2]?.meta.changes === 1;
        logWhatsappDiagnostic(
          "whatsapp_quote_lifecycle_reset",
          diagnosticContext,
          {
            stage: "ack_persistence",
            outcome: applied ? "applied" : "skipped",
            duration_ms: Math.max(0, Date.now() - persistenceStartedAt),
            reset_applied: applied,
          },
        );
      }
      logStage("delivery", "acknowledged");
      delivered++;
    } catch (error) {
      logStage(
        stage,
        acknowledged
          ? "persistence_failed"
          : sendAttempted
            ? "uncertain"
            : "failed",
        stageStartedAt,
        error,
      );
      if (acknowledged?.preparedReset)
        logWhatsappDiagnostic(
          "whatsapp_quote_lifecycle_reset",
          diagnosticContext,
          {
            stage: "ack_persistence",
            outcome: "skipped",
            reset_applied: false,
            error_code: diagnosticErrorCode(error),
          },
        );
      if (!claimed) continue;
      if (acknowledged) {
        // Preserve the exact sent text and acknowledgement for history repair.
        await db
          .prepare(
            "UPDATE whatsapp_channel_actions SET delivery_state='history_pending',outbound_message_id=?,result_json=?,lease_until=NULL WHERE id=? AND delivery_state='sending'",
          )
          .bind(
            acknowledged.id,
            JSON.stringify({
              ...acknowledged.outcome,
              deliveryText: acknowledged.text,
              deliveryAt: acknowledged.at,
              ...(acknowledged.preparedReset
                ? { quoteReset: acknowledged.preparedReset }
                : {}),
            }),
            row.id,
          )
          .run();
        continue;
      }
      // Only failures before the send attempt may release the delivery claim.
      await db
        .prepare(
          "UPDATE whatsapp_channel_actions SET delivery_state=?,lease_until=NULL WHERE id=? AND delivery_state='sending'",
        )
        .bind(sendAttempted ? "uncertain" : null, row.id)
        .run();
    }
  }
  return { delivered };
}
