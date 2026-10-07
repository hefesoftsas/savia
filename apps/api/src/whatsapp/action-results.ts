import { humanSupportContactText } from "./human-support";
import type { ActionOutcome } from "./channel-contracts";
import type { WhatsappAssistantBinding } from "./inbound-contracts";
import { WhatsappChannelRepository } from "./channel-repository";

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
};

export function actionResultText(
  employee: string,
  command: string,
  outcome: ActionOutcome,
  humanSupportContact = "",
): string {
  const label = `${employee} · Asistente virtual\n\n`;
  const value = outcome.result as Record<string, unknown> | null;
  const isQuote = command === "quote-auto" && value?.reference;
  if (outcome.state !== "completed" && !isQuote)
    return `${label}${outcome.message}\n${humanSupportContactText(humanSupportContact)}\nEscribe menú para elegir otra tarea.`;
  if (!isQuote)
    return `${label}${({ "create-record": "Registro creado.", "update-record": "Registro actualizado.", "delete-record": "Registro eliminado.", "send-email": "Correo enviado.", "create-event": "Evento creado.", "upload-file": "Archivo guardado." } as Record<string, string>)[command] ?? "Solicitud completada."}\nEscribe menú para elegir otra tarea.`;
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
  return [
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
    "Puedes preguntarme por esta cotización o escribir menú para elegir otra tarea.",
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 4096);
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
) {
  const db = repository.db;
  const rows = await db
    .prepare(
      "SELECT id,tenant_id,connection_id,contact,generation,employee_id,action_json,result_json,delivery_state,outbound_message_id FROM whatsapp_channel_actions WHERE status IN ('completed','failed','uncertain') AND (delivery_state IS NULL OR delivery_state='history_pending') ORDER BY created_at LIMIT 10",
    )
    .all<ResultDelivery>();
  const historyStatement = (row: ResultDelivery, text: string, at: string) =>
    db
      .prepare(
        "INSERT INTO whatsapp_channel_history(message_id,connection_id,contact,generation,employee_id,user_text,assistant_text,created_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(message_id) DO NOTHING",
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
      );
  for (const row of rows.results) {
    let claimed = false;
    let sendAttempted = false;
    let acknowledged: {
      id: string;
      text: string;
      at: string;
      outcome: ActionOutcome;
    } | null = null;
    try {
      const access = await repository.getAccess({
        tenantId: row.tenant_id,
        connectionId: row.connection_id,
        contact: row.contact,
      });
      if (
        access.generation !== row.generation ||
        !(await repository.listTasks(access)).some(
          (t) => t.employeeId === row.employee_id,
        )
      )
        continue;
      if (row.delivery_state === "history_pending") {
        const saved = JSON.parse(row.result_json!);
        if (
          !row.outbound_message_id ||
          typeof saved.deliveryText !== "string" ||
          typeof saved.deliveryAt !== "string"
        )
          throw new Error("CHANNEL_DELIVERY_HISTORY_UNAVAILABLE");
        // Repair only persistence for a known acknowledgement, even if the
        // reply window has since closed. Never send to Meta again.
        await db.batch([
          db
            .prepare(
              "UPDATE whatsapp_channel_actions SET delivery_state='sent' WHERE id=? AND delivery_state='history_pending'",
            )
            .bind(row.id),
          historyStatement(row, saved.deliveryText, saved.deliveryAt),
        ]);
        continue;
      }
      const binding = await resolve(row.connection_id, row.tenant_id);
      if (!binding?.allowedContacts.includes(row.contact)) continue;
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
      if (!recent) continue;
      const employee = await db
        .prepare(
          "SELECT name FROM assistant_virtual_employees WHERE id=? AND agency_id=? AND status='active'",
        )
        .bind(row.employee_id, row.tenant_id)
        .first<{ name: string }>();
      if (!employee) continue;
      const claim = await db
        .prepare(
          "UPDATE whatsapp_channel_actions SET delivery_state='sending' WHERE id=? AND delivery_state IS NULL",
        )
        .bind(row.id)
        .run();
      if (claim.meta.changes !== 1) continue;
      claimed = true;
      const finalAccess = await repository.getAccess(access);
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
            "UPDATE whatsapp_channel_actions SET delivery_state='revoked' WHERE id=?",
          )
          .bind(row.id)
          .run();
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
      const text = actionResultText(
        employee.name,
        action.command,
        outcome,
        supportContact,
      );
      sendAttempted = true;
      const id = await send(finalBinding, text, row.contact);
      acknowledged = { id, text, at: new Date().toISOString(), outcome };
      // Record only acknowledged deliveries in the originating history scope.
      // A stable delivery ID also deduplicates history.
      await db.batch([
        db
          .prepare(
            "UPDATE whatsapp_channel_actions SET delivery_state='sent',outbound_message_id=? WHERE id=? AND delivery_state='sending'",
          )
          .bind(id, row.id),
        historyStatement(row, text, acknowledged.at),
      ]);
    } catch {
      if (!claimed) continue;
      if (acknowledged) {
        // Preserve the exact sent text and acknowledgement for history repair.
        await db
          .prepare(
            "UPDATE whatsapp_channel_actions SET delivery_state='history_pending',outbound_message_id=?,result_json=? WHERE id=? AND delivery_state='sending'",
          )
          .bind(
            acknowledged.id,
            JSON.stringify({
              ...acknowledged.outcome,
              deliveryText: acknowledged.text,
              deliveryAt: acknowledged.at,
            }),
            row.id,
          )
          .run();
        continue;
      }
      // Only failures before the send attempt may release the delivery claim.
      await db
        .prepare(
          "UPDATE whatsapp_channel_actions SET delivery_state=? WHERE id=? AND delivery_state='sending'",
        )
        .bind(sendAttempted ? "uncertain" : null, row.id)
        .run();
    }
  }
}
