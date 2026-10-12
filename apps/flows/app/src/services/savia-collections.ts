const subscriptionChanged = "savia:collection-subscription-changed";

/** Invalidate transient views; the next host response remains authoritative. */
export function notifySaviaSubscriptionChange(workflowId: string) {
  window.dispatchEvent(
    new CustomEvent(subscriptionChanged, { detail: workflowId }),
  );
}

export function onSaviaSubscriptionChange(
  workflowId: string,
  refresh: () => void,
) {
  const listener = (event: Event) => {
    if ((event as CustomEvent<string>).detail === workflowId) refresh();
  };
  window.addEventListener(subscriptionChanged, listener);
  return () => window.removeEventListener(subscriptionChanged, listener);
}
