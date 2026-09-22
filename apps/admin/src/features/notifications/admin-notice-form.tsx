import { useState } from "react";
import { useTranslate } from "ra-core";
import { Button } from "@/components/ui/button";
import {
  notificationClient,
  type NotificationClient,
} from "./client";

export function AdminNoticeForm({
  scope,
  canAdminister,
  client = notificationClient,
  onSent,
}: {
  scope: string;
  canAdminister: boolean;
  client?: NotificationClient;
  onSent?: (eventId: string) => void;
}) {
  const translate = useTranslate();
  const t = (key: string) => translate(`savia.notificationInbox.${key}`);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [principals, setPrincipals] = useState("");
  const [allMembers, setAllMembers] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  if (!canAdminister) return null;

  const send = async () => {
    setBusy(true);
    setNotice("");
    setError("");
    try {
      const result = await client.sendAdminNotice({
        scope,
        key: `manual-${Date.now()}`,
        title,
        body,
        audience: allMembers
          ? { kind: "workspace-members" }
          : {
              kind: "explicit",
              principals: principals.split(",").map((entry) => entry.trim()).filter(Boolean),
            },
      });
      setNotice(
        result.duplicate ? t("duplicateAccepted") : `${t("accepted")}: ${result.eventId}`,
      );
      onSent?.(result.eventId);
    } catch (exception) {
      setError(
        String(exception).includes("429") ? t("quotaExceeded") : t("actionError"),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-2 rounded-md border p-3"
      aria-label={t("adminTitle")}
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <h2 className="text-sm font-semibold">{t("adminTitle")}</h2>
      <label className="flex flex-col gap-1 text-sm">
        {t("adminSubject")}
        <input
          className="rounded border px-2 py-1"
          value={title}
          maxLength={200}
          onChange={(event) => setTitle(event.target.value)}
          required
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {t("adminBody")}
        <textarea
          className="rounded border px-2 py-1"
          value={body}
          maxLength={4000}
          onChange={(event) => setBody(event.target.value)}
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={allMembers}
          onChange={(event) => setAllMembers(event.target.checked)}
        />
        {t("adminAllMembers")}
      </label>
      {!allMembers && (
        <label className="flex flex-col gap-1 text-sm">
          {t("adminRecipients")}
          <input
            className="rounded border px-2 py-1"
            value={principals}
            placeholder="alice, bob"
            onChange={(event) => setPrincipals(event.target.value)}
            required
          />
        </label>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
      <Button type="submit" size="sm" disabled={busy || !title.trim()}>
        {t("adminSend")}
      </Button>
    </form>
  );
}
