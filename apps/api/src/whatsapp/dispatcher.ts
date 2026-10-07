import { DurableObject } from "cloudflare:workers";
import { processWhatsappEventBatch, type RuntimeEnvironment } from "../runtime";
import {
  nextWhatsappWake,
  usesWhatsappEvents,
  type WhatsappQueueScope,
} from "./queue";

/** One coordinator per conversation. D1 remains the job and result store. */
export class WhatsappDispatcher extends DurableObject<RuntimeEnvironment> {
  protected processBatch(scope: WhatsappQueueScope): Promise<boolean> {
    return processWhatsappEventBatch(this.env, scope);
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST" || new URL(request.url).pathname !== "/wake")
      return new Response("Not found", { status: 404 });
    let scope: WhatsappQueueScope;
    try {
      const input = (await request.json()) as Partial<WhatsappQueueScope>;
      if (
        typeof input.connectionId !== "string" ||
        !input.connectionId ||
        input.connectionId.length > 256 ||
        typeof input.contact !== "string" ||
        !/^\d{1,32}$/.test(input.contact)
      )
        return new Response("Invalid scope", { status: 400 });
      scope = { connectionId: input.connectionId, contact: input.contact };
    } catch {
      return new Response("Invalid scope", { status: 400 });
    }
    return this.ctx.blockConcurrencyWhile(async () => {
      const current = await this.ctx.storage.get<WhatsappQueueScope>("scope");
      if (
        current &&
        (current.connectionId !== scope.connectionId ||
          current.contact !== scope.contact)
      )
        return new Response("Scope mismatch", { status: 409 });
      await this.ctx.storage.put({
        scope,
        revision: ((await this.ctx.storage.get<number>("revision")) ?? 0) + 1,
      });
      const alarm = await this.ctx.storage.getAlarm();
      const soon = Date.now() + 100;
      if (alarm === null || alarm > soon) await this.ctx.storage.setAlarm(soon);
      return new Response(null, { status: 202 });
    });
  }

  async alarm(): Promise<void> {
    // Rollback to scheduled mode must stop old alarms from consuming the queue.
    if (!usesWhatsappEvents(this.env)) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    const scope = await this.ctx.storage.get<WhatsappQueueScope>("scope");
    if (!scope) return;
    const revision = await this.ctx.storage.get<number>("revision");
    // Persist a watchdog before any external work; an eviction cannot lose the wake.
    await this.ctx.storage.setAlarm(Date.now() + 60_000);
    try {
      const progressed = await this.processBatch(scope);
      const due = await nextWhatsappWake(this.env.DB, scope);
      await this.ctx.blockConcurrencyWhile(async () => {
        const changed =
          (await this.ctx.storage.get<number>("revision")) !== revision;
        await this.ctx.storage.delete("failures");
        if (changed) {
          await this.ctx.storage.setAlarm(Date.now() + 100);
        } else if (due === null) {
          await this.ctx.storage.deleteAlarm();
        } else {
          // Future retries/leases wake at their due time. Unprocessable due rows
          // back off instead of creating a tight polling loop.
          await this.ctx.storage.setAlarm(
            due > Date.now() ? due : Date.now() + (progressed ? 100 : 60_000),
          );
        }
      });
    } catch {
      await this.ctx.blockConcurrencyWhile(async () => {
        const failures =
          ((await this.ctx.storage.get<number>("failures")) ?? 0) + 1;
        await this.ctx.storage.put("failures", failures);
        const changed =
          (await this.ctx.storage.get<number>("revision")) !== revision;
        await this.ctx.storage.setAlarm(
          Date.now() +
            (changed
              ? 100
              : Math.min(60_000, 5_000 * 2 ** Math.min(failures - 1, 4))),
        );
      });
      // The failure is handled by the durable alarm above. Throwing here would
      // add automatic alarm retries on top of the explicit backoff schedule.
      console.error("WHATSAPP_DISPATCH_BATCH_FAILED");
    }
  }
}
