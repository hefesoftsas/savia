import type { PersonalMessage } from "./operations";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
export function nativeMailLink(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      [
        "outlook.office.com",
        "outlook.office365.com",
        "outlook.live.com",
      ].includes(url.hostname)
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export function normalizeGmailMessage(
  payload: unknown,
  accountLabel?: string | null,
): PersonalMessage | null {
  const item = object(payload);
  const id = text(item.id);
  if (!id) return null;
  const threadId = text(item.threadId);
  const mailId =
    threadId && /^[a-f0-9]+$/i.test(threadId)
      ? threadId
      : /^[a-f0-9]+$/i.test(id)
        ? id
        : null;
  const account = accountLabel?.trim();
  const credibleAccount =
    account &&
    account.length <= 320 &&
    /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?\.)+[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?$/i.test(
      account,
    )
      ? account
      : null;
  const headers = object(item.payload).headers;
  const header = (name: string) =>
    Array.isArray(headers)
      ? text(
          object(
            headers.find(
              (entry) => text(object(entry).name)?.toLowerCase() === name,
            ),
          ).value,
        )
      : null;
  const timestamp =
    typeof item.internalDate === "string" && /^\d+$/.test(item.internalDate)
      ? Number(item.internalDate)
      : NaN;
  return {
    id,
    subject: header("subject"),
    sender: header("from"),
    receivedAt:
      Number.isFinite(timestamp) && !Number.isNaN(new Date(timestamp).getTime())
        ? new Date(timestamp).toISOString()
        : null,
    webLink:
      mailId && credibleAccount
        ? `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(credibleAccount)}#all/${mailId}`
        : null,
  };
}
export function normalizeOutlookMessage(
  payload: unknown,
): PersonalMessage | null {
  const item = object(payload);
  const id = text(item.id);
  if (!id) return null;
  return {
    id,
    subject: text(item.subject),
    sender: text(object(object(item.from).emailAddress).address),
    receivedAt: text(item.receivedDateTime),
    webLink: nativeMailLink(item.webLink),
  };
}
