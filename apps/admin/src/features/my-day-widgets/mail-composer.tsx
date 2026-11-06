import { useEffect, useRef, useState } from "react";
import type { ApiClient } from "@/api/api-client";
import { intlLocale, useAppLocale, useMessages } from "@/i18n/core";
import { ApiClientError } from "@/api/api-client";
import {
  sendPersonalMailSchema,
  type MailContextReference,
  type PersonalMailProvider,
} from "@savia/studio-shared/mail-contracts";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { MailContextSelector, mailSelectClass } from "./mail-context-selector";
import {
  mailProviderLabel,
  type PersonalMailLike,
  type MailConnection,
} from "./use-my-day-mail";
import { widgetMessages } from "./widget-messages";

type ComposerMessageKey = keyof typeof widgetMessages & string;

export function MailComposer({
  open,
  onOpenChange,
  apiClient,
  personalIntegrations,
  connections,
  sessionRevision,
  onSent,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  apiClient?: ApiClient;
  personalIntegrations: PersonalMailLike;
  connections: MailConnection[];
  sessionRevision: number;
  onSent?: () => void;
}) {
  const locale = useAppLocale();
  const uiLocale = intlLocale(locale);
  const t = useMessages(widgetMessages);
  const [provider, setProvider] = useState<PersonalMailProvider>(
    connections[0]?.provider ?? "gmail",
  );
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [context, setContext] = useState<MailContextReference[]>([]);
  const [showContext, setShowContext] = useState(false);
  const [feedback, setFeedback] = useState<ComposerMessageKey | null>(null);
  const [sending, setSending] = useState(false);
  const inFlight = useRef(false);
  const generation = useRef(0);
  const reset = () => {
    setTo("");
    setSubject("");
    setBody("");
    setContext([]);
    setShowContext(false);
    setFeedback(null);
  };
  useEffect(() => {
    ++generation.current;
    inFlight.current = false;
    setSending(false);
    reset();
    return () => {
      ++generation.current;
    };
  }, [sessionRevision, personalIntegrations]);
  const selectedProvider = connections.some(
    (connection) => connection.provider === provider,
  )
    ? provider
    : connections[0]?.provider;
  async function send() {
    if (inFlight.current) return;
    const parsed = sendPersonalMailSchema.safeParse({
      provider: selectedProvider,
      to: to
        .split(/[,;]/)
        .map((address) => address.trim())
        .filter(Boolean),
      subject,
      body,
      ...(context.length ? { context } : {}),
    });
    if (!parsed.success) {
      setFeedback(
        "Check recipients, subject, and message. Limit: 20 recipients and 10,000 message characters.",
      );
      return;
    }
    const current = generation.current;
    inFlight.current = true;
    setSending(true);
    setFeedback(null);
    try {
      await personalIntegrations.sendMail(parsed.data);
      if (current !== generation.current) return;
      reset();
      onSent?.();
      onOpenChange(false);
    } catch (error) {
      if (current !== generation.current) return;
      setFeedback(
        error instanceof ApiClientError &&
          [400, 403, 404, 503].includes(error.status)
          ? "The email was not sent. Check the details, your permissions, and the connection before trying again."
          : "We could not confirm delivery. Check Sent in your account before trying again.",
      );
    } finally {
      if (current === generation.current) {
        inFlight.current = false;
        setSending(false);
      }
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!inFlight.current) onOpenChange(value);
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("New email")}</DialogTitle>
          <DialogDescription>
            {t(
              "Write your message and check the details before sending it from your connected account.",
            )}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          {feedback ? (
            <p role="alert" className="text-sm text-destructive">
              {t(feedback)}
            </p>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="mail-provider">{t("Send from")}</Label>
            <select
              id="mail-provider"
              className={mailSelectClass}
              disabled={sending || connections.length < 2}
              value={selectedProvider ?? ""}
              onChange={(event) =>
                setProvider(event.target.value as PersonalMailProvider)
              }
            >
              {connections.map((connection) => (
                <option key={connection.provider} value={connection.provider}>
                  {mailProviderLabel(connection.provider)} ·{" "}
                  {connection.externalAccountLabel ?? t("Connected account")}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mail-to">{t("To")}</Label>
            <Input
              id="mail-to"
              value={to}
              disabled={sending}
              onChange={(event) => setTo(event.target.value)}
              placeholder="name@example.com"
              autoComplete="off"
              required
            />
            <p className="text-xs text-muted-foreground">
              {t("Separate recipients with commas.")}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mail-subject">{t("Subject")}</Label>
            <Input
              id="mail-subject"
              value={subject}
              disabled={sending}
              onChange={(event) => setSubject(event.target.value)}
              maxLength={2000}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mail-body">{t("Message")}</Label>
            <Textarea
              id="mail-body"
              className="min-h-40"
              value={body}
              disabled={sending}
              onChange={(event) => setBody(event.target.value)}
              maxLength={10000}
              required
            />
            <p className="text-right text-xs tabular-nums text-muted-foreground">
              {new Intl.NumberFormat(uiLocale).format(body.length)} /{" "}
              {new Intl.NumberFormat(uiLocale).format(10000)}
            </p>
          </div>
          {apiClient ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={sending}
                aria-expanded={showContext}
                onClick={() => setShowContext((value) => !value)}
              >
                {t("Add record context")}
              </Button>
              {showContext ? (
                <fieldset disabled={sending}>
                  <MailContextSelector
                    key={sessionRevision}
                    apiClient={apiClient}
                    onInsert={({ reference, text }) => {
                      const next = body ? `${body}\n\n${text}` : text;
                      if (next.length > 10000) {
                        setFeedback(
                          "The context exceeds the 10,000-character limit. Choose fewer fields.",
                        );
                        return;
                      }
                      const existing = context.find(
                        (entry) =>
                          entry.apiBasePath === reference.apiBasePath &&
                          entry.collection === reference.collection &&
                          entry.recordId === reference.recordId,
                      );
                      if (!existing && context.length >= 10) {
                        setFeedback(
                          "You can include context from up to 10 records.",
                        );
                        return;
                      }
                      const merged = existing
                        ? [
                            ...new Set([
                              ...existing.fields,
                              ...reference.fields,
                            ]),
                          ]
                        : reference.fields;
                      if (merged.length > 50) {
                        setFeedback(
                          "You can include up to 50 fields per record.",
                        );
                        return;
                      }
                      setBody(next);
                      setContext((previous) =>
                        existing
                          ? previous.map((entry) =>
                              entry === existing
                                ? { ...entry, fields: merged }
                                : entry,
                            )
                          : [...previous, reference],
                      );
                      setFeedback(null);
                      setShowContext(false);
                    }}
                  />
                </fieldset>
              ) : null}
            </>
          ) : null}
          {context.length ? (
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>
                {t(
                  "Context includes %{count} records. Permissions are checked when sending.",
                  {
                    count: new Intl.NumberFormat(uiLocale).format(
                      context.length,
                    ),
                  },
                )}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={sending}
                onClick={() => {
                  setContext([]);
                  setBody("");
                }}
              >
                {t("Remove context and clear message")}
              </Button>
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={sending}
              onClick={() => onOpenChange(false)}
            >
              {t("Cancel")}
            </Button>
            <Button type="submit" disabled={sending || !selectedProvider}>
              {sending ? t("Sending…") : t("Send email")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
