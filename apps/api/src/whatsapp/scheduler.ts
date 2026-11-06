/** Run inbox intake and queued action delivery as independent scheduled lanes. */
export async function runWhatsappScheduledLanes(
  processInbox: () => Promise<unknown>,
  processActions: () => Promise<unknown>,
): Promise<void> {
  const actionLane = Promise.resolve().then(processActions);
  const inboxLane = Promise.resolve()
    .then(processInbox)
    // Inbox confirmations may enqueue a job during this tick. Make that job
    // eligible immediately without waiting for the independent action scan.
    .then(processActions);
  const results = await Promise.allSettled([actionLane, inboxLane]);
  const errors = results.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  if (errors.length)
    throw new AggregateError(errors, "WhatsApp scheduled lanes failed");
}

export async function runWhatsappEventLanes(
  deliverReady: () => Promise<number>,
  processInbox: () => Promise<{ processed: number; failed: number }>,
  processActions: () => Promise<{ processed: number; delivered: number }>,
): Promise<boolean> {
  const delivered = await deliverReady();
  // Queued actions came from an already acknowledged earlier input. Run one
  // before admitting more messages, so continuous input cannot starve it.
  const actions = await processActions();
  if (actions.processed > 0) return true;
  // A new confirmation is acknowledged here; its action waits for the next
  // alarm. One inbox OR one action keeps the batch wall-time bounded.
  const inbox = await processInbox();
  return delivered + actions.delivered + inbox.processed + inbox.failed > 0;
}
