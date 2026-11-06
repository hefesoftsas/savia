export function recipients(
  clients: Record<string, unknown>[],
  segment: string,
) {
  return clients
    .filter(
      (c) =>
        c.marketing_consent === true &&
        c.marketing_suppressed === false &&
        typeof c.email === "string" &&
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email) &&
        (!segment || String(c.segment ?? "") === segment),
    )
    .filter(
      (c, index, all) =>
        all.findIndex(
          (other) =>
            String(other.email).toLowerCase() === String(c.email).toLowerCase(),
        ) === index,
    );
}
