import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type {
  CollaborationChannel,
  CollaborationProvider,
  ShareRecordInput,
} from "@savia/studio-shared/collaboration-contracts";
import type { MailContextReference } from "@savia/studio-shared/mail-contracts";
import type {
  PersonalIntegrationConnection,
  PersonalIntegrationsClient,
} from "@/api/personal-integrations-client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useMessages } from "@/i18n/core";
import { recordSharingMessages } from "@/i18n/locales/record-sharing";
import { MessagesSquare } from "lucide-react";

type CollaborationIntegrationsClient = Pick<
  PersonalIntegrationsClient,
  "listConnections" | "listCollaborationChannels" | "shareRecordToChat"
>;

type ShareableRecord = {
  title: string;
  summary: string;
  url: string;
  context: MailContextReference;
};

const providers: CollaborationProvider[] = ["slack", "microsoft_teams"];
const providerName: Record<CollaborationProvider, string> = {
  slack: "Slack",
  microsoft_teams: "Microsoft Teams",
};
const channelKey = (channel: CollaborationChannel) =>
  `${channel.teamId ?? ""}:${channel.id}`;

function collaborationConnection(
  connection: PersonalIntegrationConnection,
): connection is PersonalIntegrationConnection & {
  provider: CollaborationProvider;
} {
  return providers.includes(connection.provider as CollaborationProvider);
}

export function RecordChatShareAction({
  share,
  personalIntegrations,
}: {
  share: ShareableRecord;
  personalIntegrations: CollaborationIntegrationsClient;
}) {
  const t = useMessages(recordSharingMessages);
  const [open, setOpen] = useState(false);
  const [connections, setConnections] = useState<
    PersonalIntegrationConnection[]
  >([]);
  const [connectionsLoading, setConnectionsLoading] = useState(false);
  const [connectionsError, setConnectionsError] = useState(false);
  const [connectionReload, setConnectionReload] = useState(0);
  const [provider, setProvider] = useState<CollaborationProvider | "">("");
  const [channels, setChannels] = useState<CollaborationChannel[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [channelsError, setChannelsError] = useState(false);
  const [channelReload, setChannelReload] = useState(0);
  const [channelId, setChannelId] = useState("");
  const [title, setTitle] = useState(share.title.slice(0, 500));
  const [summary, setSummary] = useState(share.summary.slice(0, 5000));
  const [reviewing, setReviewing] = useState(false);
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<
    "sent" | "ambiguous" | "failed" | null
  >(null);
  const inFlight = useRef(false);
  const channelGeneration = useRef(0);
  const sendGeneration = useRef(0);
  const requestIdentity = useRef<{ fingerprint: string; id: string } | null>(
    null,
  );
  const shareFingerprint = JSON.stringify(share);
  const connectedProviders = connections
    .filter(collaborationConnection)
    .filter((connection) => connection.status === "connected");
  const reconnectRequired = connections.some(
    (connection) =>
      collaborationConnection(connection) &&
      ["reconnect_required", "failed"].includes(connection.status),
  );

  useEffect(() => {
    if (!open) return;
    let active = true;
    setConnectionsLoading(true);
    setConnectionsError(false);
    setConnections([]);
    setProvider("");
    setChannels([]);
    setChannelId("");
    setReviewing(false);
    setFeedback(null);
    void personalIntegrations
      .listConnections(true)
      .then(
        (result) => {
          if (!active) return;
          const relevant = result.filter(collaborationConnection);
          setConnections(relevant);
          const first = relevant.find(
            (connection) => connection.status === "connected",
          );
          if (first) setProvider(first.provider);
        },
        () => {
          if (active) setConnectionsError(true);
        },
      )
      .finally(() => {
        if (active) setConnectionsLoading(false);
      });
    return () => {
      active = false;
      channelGeneration.current += 1;
    };
  }, [open, personalIntegrations, connectionReload, shareFingerprint]);

  useEffect(() => {
    if (!open || !provider) return;
    const generation = ++channelGeneration.current;
    setChannels([]);
    setChannelId("");
    setNextCursor(null);
    setChannelsError(false);
    setChannelsLoading(true);
    setLoadingMore(false);
    void personalIntegrations
      .listCollaborationChannels({ provider })
      .then(
        (page) => {
          if (generation !== channelGeneration.current) return;
          setChannels(page.channels);
          setNextCursor(page.nextCursor);
        },
        () => {
          if (generation === channelGeneration.current) setChannelsError(true);
        },
      )
      .finally(() => {
        if (generation === channelGeneration.current) setChannelsLoading(false);
      });
    return () => {
      if (generation === channelGeneration.current)
        channelGeneration.current += 1;
    };
  }, [open, provider, personalIntegrations, channelReload]);

  useEffect(() => {
    if (!open) return;
    const invalidate = () => {
      channelGeneration.current += 1;
      sendGeneration.current += 1;
      setOpen(false);
      setConnections([]);
      setChannels([]);
      setChannelId("");
      requestIdentity.current = null;
      inFlight.current = false;
      setSending(false);
    };
    window.addEventListener("savia:identity-changed", invalidate);
    window.addEventListener("savia:session-cleared", invalidate);
    window.addEventListener("savia:tenant-changed", invalidate);
    return () => {
      window.removeEventListener("savia:identity-changed", invalidate);
      window.removeEventListener("savia:session-cleared", invalidate);
      window.removeEventListener("savia:tenant-changed", invalidate);
    };
  }, [open]);

  async function loadMore() {
    if (!provider || !nextCursor || loadingMore) return;
    const generation = channelGeneration.current;
    const cursor = nextCursor;
    setLoadingMore(true);
    setChannelsError(false);
    try {
      const page = await personalIntegrations.listCollaborationChannels({
        provider,
        cursor,
      });
      if (generation !== channelGeneration.current) return;
      setChannels((previous) => {
        const known = new Set(previous.map(channelKey));
        return [
          ...previous,
          ...page.channels.filter((channel) => !known.has(channelKey(channel))),
        ];
      });
      setNextCursor(page.nextCursor);
    } catch {
      if (generation === channelGeneration.current) setChannelsError(true);
    } finally {
      if (generation === channelGeneration.current) setLoadingMore(false);
    }
  }

  async function shareNow() {
    if (
      inFlight.current ||
      !provider ||
      !channelId ||
      !title.trim() ||
      !summary.trim()
    )
      return;
    const selectedChannel = channels.find(
      (channel) => channelKey(channel) === channelId,
    );
    if (!selectedChannel) return;
    const input: Omit<ShareRecordInput, "requestId"> = {
      provider,
      channelId: selectedChannel.id,
      ...(selectedChannel.teamId ? { teamId: selectedChannel.teamId } : {}),
      title: title.trim(),
      summary: summary.trim(),
      url: share.url,
      context: share.context,
    };
    const fingerprint = JSON.stringify(input);
    if (requestIdentity.current?.fingerprint !== fingerprint) {
      requestIdentity.current = { fingerprint, id: crypto.randomUUID() };
    }
    const request: ShareRecordInput = {
      ...input,
      requestId: requestIdentity.current.id,
    };
    const generation = sendGeneration.current;
    inFlight.current = true;
    setSending(true);
    setFeedback(null);
    try {
      await personalIntegrations.shareRecordToChat(request);
      if (generation === sendGeneration.current) {
        requestIdentity.current = null;
        setFeedback("sent");
      }
    } catch (error) {
      const status =
        error && typeof error === "object"
          ? (error as { status?: unknown }).status
          : undefined;
      if (generation === sendGeneration.current)
        setFeedback(
          [400, 403, 404].includes(Number(status)) ? "failed" : "ambiguous",
        );
    } finally {
      if (generation === sendGeneration.current) {
        inFlight.current = false;
        setSending(false);
      }
    }
  }

  useEffect(() => {
    sendGeneration.current += 1;
    inFlight.current = false;
    setSending(false);
    requestIdentity.current = null;
    setTitle(share.title.slice(0, 500));
    setSummary(share.summary.slice(0, 5000));
    setReviewing(false);
    setFeedback(null);
  }, [shareFingerprint]);

  const selectedChannel = channels.find(
    (channel) => channelKey(channel) === channelId,
  );
  const canReview = Boolean(
    provider &&
    selectedChannel &&
    title.trim() &&
    summary.trim() &&
    title.length <= 500 &&
    summary.length <= 5000,
  );

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
      >
        <MessagesSquare aria-hidden="true" className="size-4" />
        {t("Compartir en chat")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {t(
                feedback === "sent"
                  ? "Vista previa del mensaje"
                  : "Compartir registro",
              )}
            </DialogTitle>
            <DialogDescription>
              {t("Elige un canal y revisa el mensaje antes de compartir.")}
            </DialogDescription>
          </DialogHeader>
          <p className="rounded-md bg-muted px-3 py-2 text-sm leading-5 text-muted-foreground">
            {provider === "microsoft_teams"
              ? t("Microsoft Teams publicará como tu cuenta conectada.")
              : t("Slack publicará como la aplicación de Savia.")}{" "}
            {t(
              "El contenido será visible para los miembros del canal. El enlace al registro requiere acceso a Savia.",
            )}
          </p>
          {connectionsLoading ? (
            <p role="status" className="py-4 text-sm text-muted-foreground">
              {t("Cargando integraciones…")}
            </p>
          ) : connectionsError ? (
            <div role="alert" className="space-y-3 text-sm">
              <p>{t("No pudimos cargar tus integraciones.")}</p>
              <Button
                type="button"
                variant="outline"
                onClick={() => setConnectionReload((value) => value + 1)}
              >
                {t("Reintentar")}
              </Button>
            </div>
          ) : connectedProviders.length === 0 ? (
            <div className="space-y-3 py-2 text-sm">
              <p>
                {t(
                  reconnectRequired
                    ? "Vuelve a conectar Slack o Microsoft Teams para compartir este registro."
                    : "Conecta Slack o Microsoft Teams para compartir este registro.",
                )}
              </p>
              <Button asChild variant="outline">
                <Link to="/my-integrations?tab=connections">
                  {t(
                    reconnectRequired
                      ? "Reconectar en integraciones"
                      : "Abrir integraciones",
                  )}
                </Link>
              </Button>
            </div>
          ) : feedback === "sent" ? (
            <div role="status" aria-live="polite" className="space-y-4 py-2">
              <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
                {t("Registro compartido en %{provider}.", {
                  provider: provider ? providerName[provider] : "",
                })}
              </p>
              <Button type="button" onClick={() => setOpen(false)}>
                {t("Cerrar")}
              </Button>
            </div>
          ) : reviewing ? (
            <section
              aria-labelledby="record-share-review"
              className="space-y-4"
            >
              <h3 id="record-share-review" className="text-sm font-semibold">
                {t("Revisa el mensaje")}
              </h3>
              <dl className="space-y-3 rounded-md border p-4 text-sm">
                <div>
                  <dt className="font-medium">{t("Canal de chat")}</dt>
                  <dd className="mt-1 break-words">
                    {selectedChannel?.teamName
                      ? `${selectedChannel.teamName} · `
                      : ""}
                    {selectedChannel?.name}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium">{t("Título")}</dt>
                  <dd className="mt-1 break-words">{title}</dd>
                </div>
                <div>
                  <dt className="font-medium">{t("Resumen")}</dt>
                  <dd className="mt-1 whitespace-pre-wrap break-words">
                    {summary}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium">{t("Enlace al registro")}</dt>
                  <dd className="mt-1 break-all">{share.url}</dd>
                </div>
              </dl>
              {feedback === "ambiguous" || feedback === "failed" ? (
                <div role="alert" className="space-y-2 text-sm">
                  <p>
                    {t(
                      feedback === "ambiguous"
                        ? "No pudimos confirmar el envío. Revisa el canal antes de intentarlo de nuevo."
                        : "No se pudo compartir el registro. Revisa los detalles, permisos y conexión.",
                    )}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={sending}
                    onClick={() => void shareNow()}
                  >
                    {sending ? t("Compartiendo…") : t("Intentar de nuevo")}
                  </Button>
                </div>
              ) : null}
              <DialogFooter className="gap-2 sm:justify-between">
                <Button
                  type="button"
                  variant="outline"
                  disabled={sending}
                  onClick={() => {
                    setReviewing(false);
                    setFeedback(null);
                  }}
                >
                  {t("Volver a editar")}
                </Button>
                <Button
                  type="button"
                  disabled={sending || !canReview}
                  onClick={() => void shareNow()}
                >
                  {sending ? t("Compartiendo…") : t("Compartir ahora")}
                </Button>
              </DialogFooter>
            </section>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="record-share-provider">{t("Proveedor")}</Label>
                <select
                  id="record-share-provider"
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={provider}
                  onChange={(event) =>
                    setProvider(event.target.value as CollaborationProvider)
                  }
                >
                  {connectedProviders.map((connection) => (
                    <option
                      key={connection.provider}
                      value={connection.provider}
                    >
                      {
                        providerName[
                          connection.provider as CollaborationProvider
                        ]
                      }
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="record-share-channel">{t("Canal")}</Label>
                <select
                  id="record-share-channel"
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  disabled={channelsLoading || channels.length === 0}
                  value={channelId}
                  onChange={(event) => setChannelId(event.target.value)}
                >
                  <option value="">
                    {channelsLoading
                      ? t("Cargando canales…")
                      : t("Elige un canal")}
                  </option>
                  {channels.map((channel) => (
                    <option
                      key={channelKey(channel)}
                      value={channelKey(channel)}
                    >
                      {channel.teamName ? `${channel.teamName} · ` : ""}
                      {channel.name}
                    </option>
                  ))}
                </select>
                {channelsLoading ? (
                  <p role="status" className="text-xs text-muted-foreground">
                    {t("Cargando canales…")}
                  </p>
                ) : null}
                {channelsError ? (
                  <div
                    role="alert"
                    className="flex flex-wrap items-center gap-2 text-sm"
                  >
                    <span>{t("No pudimos cargar los canales.")}</span>
                    <Button
                      type="button"
                      variant="link"
                      className="h-auto p-0"
                      onClick={() => setChannelReload((value) => value + 1)}
                    >
                      {t("Reintentar")}
                    </Button>
                    <Link
                      className="underline underline-offset-4"
                      to="/my-integrations?tab=connections"
                    >
                      {t("Reconectar en integraciones")}
                    </Link>
                  </div>
                ) : null}
                {!channelsLoading && !channelsError && channels.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t("No encontramos canales disponibles.")}
                  </p>
                ) : null}
                {nextCursor ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={loadingMore}
                    onClick={() => void loadMore()}
                  >
                    {loadingMore
                      ? t("Cargando canales…")
                      : t("Cargar más canales")}
                  </Button>
                ) : null}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="record-share-title">{t("Título")}</Label>
                <Input
                  id="record-share-title"
                  maxLength={500}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
                <span className="text-right text-xs text-muted-foreground">
                  {title.length}/500
                </span>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="record-share-summary">{t("Resumen")}</Label>
                <Textarea
                  id="record-share-summary"
                  maxLength={5000}
                  rows={5}
                  value={summary}
                  onChange={(event) => setSummary(event.target.value)}
                />
                <span className="text-right text-xs text-muted-foreground">
                  {summary.length}/5000
                </span>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  disabled={!canReview || channelsLoading}
                  onClick={() => {
                    setReviewing(true);
                    setFeedback(null);
                  }}
                >
                  {t("Revisar y compartir")}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
