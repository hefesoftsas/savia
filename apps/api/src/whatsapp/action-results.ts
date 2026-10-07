import { humanSupportContactText } from "./human-support";
import type { ActionOutcome } from "./channel-contracts";
import type { WhatsappAssistantBinding } from "./inbound-contracts";
import { WhatsappChannelRepository } from "./channel-repository";

export function actionResultText(
  employee: string,
  command: string,
  outcome: ActionOutcome,
  humanSupportContact = "",
): string {
  const label = `${employee} · Asistente virtual\n\n`;
  const value = outcome.result as Record<string, unknown> | null;
  const quoteResult =
    command === "quote-auto" && value?.reference ? value : undefined;
  if (outcome.state !== "completed" && !quoteResult)
    return `${label}${outcome.message}\n${humanSupportContactText(humanSupportContact)}\nEscribe menú para elegir otra tarea.`;
  if (!quoteResult)
    return `${label}${({ "create-record": "Registro creado.", "update-record": "Registro actualizado.", "delete-record": "Registro eliminado.", "send-email": "Correo enviado.", "create-event": "Evento creado.", "upload-file": "Archivo guardado." } as Record<string, string>)[command] ?? "Solicitud completada."}\nEscribe menú para elegir otra tarea.`;
  const offers = Array.isArray(quoteResult.lowestPriceOffers)
    ? (quoteResult.lowestPriceOffers as Array<{
        product: string;
        premium: number;
      }>)
    : [];
  const pricedOffers = Number(quoteResult.pricedOffers ?? 0);
  const failedOffers = Number(quoteResult.failedOffers ?? 0);
  const uncertainOffers = Number(quoteResult.uncertainOffers ?? 0);
  const unpricedOffers = Number(quoteResult.unpricedOffers ?? 0);
  const hasPartialResults =
    outcome.state !== "completed" ||
    failedOffers > 0 ||
    uncertainOffers > 0 ||
    unpricedOffers > 0;
  const heading = hasPartialResults
    ? `Resultados parciales de ${quoteResult.reference}`
    : `Resultados de ${quoteResult.reference}`;
  const support =
    pricedOffers === 0
      ? `\nNo recibí ofertas con precio. ${humanSupportContactText(humanSupportContact)}`
      : "";
  const status =
    pricedOffers > 0
      ? `Ofertas con precio confirmado: ${pricedOffers}.`
      : "Aún no hay ofertas con precio confirmado.";
  const followUp = [
    uncertainOffers > 0
      ? `${uncertainOffers} solicitud(es) siguen sin resultado verificado. Las ofertas recibidas están guardadas. Revisa su historial antes de volver a cotizar.`
      : "",
    failedOffers > 0 ? `Consultas sin respuesta usable: ${failedOffers}.` : "",
    unpricedOffers > 0
      ? `Consultas sin oferta con precio: ${unpricedOffers}.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
  return `${label}${heading}\n${status}\n${offers.map((o) => `${o.product}: $${Number(o.premium).toLocaleString("es-CO")}`).join("\n")}${followUp ? `\n${followUp}` : ""}\n${quoteResult.recommendation ?? "Consulta las coberturas antes de elegir una oferta."}${support}\nEscribe menú para elegir otra tarea.`.slice(
    0,
    4096,
  );
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
      "SELECT id,tenant_id,connection_id,contact,generation,employee_id,action_json,result_json,status FROM whatsapp_channel_actions WHERE status IN ('completed','failed','uncertain') AND delivery_state IS NULL ORDER BY created_at LIMIT 10",
    )
    .all<{
      id: string;
      tenant_id: number;
      connection_id: string;
      contact: string;
      generation: string;
      employee_id: string;
      action_json: string;
      result_json: string | null;
      status: string;
    }>();
  for (const row of rows.results) {
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
      const id = await send(
        finalBinding,
        actionResultText(
          employee.name,
          action.command,
          outcome,
          supportContact,
        ),
        row.contact,
      );
      await db
        .prepare(
          "UPDATE whatsapp_channel_actions SET delivery_state='sent',outbound_message_id=? WHERE id=? AND delivery_state='sending'",
        )
        .bind(id, row.id)
        .run();
    } catch {
      // Sending may have reached Meta. A claimed delivery is never retried.
      await db
        .prepare(
          "UPDATE whatsapp_channel_actions SET delivery_state='uncertain' WHERE id=? AND delivery_state='sending'",
        )
        .bind(row.id)
        .run();
    }
  }
}
