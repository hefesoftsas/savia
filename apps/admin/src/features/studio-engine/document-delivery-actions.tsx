import { useMessages, useAppLocale, intlLocale } from "@/i18n/core";
import { documentDeliveryMessages as messages } from "@/i18n/locales/document-delivery";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  CloudUpload,
  ExternalLink,
  Folder,
  LoaderCircle,
  Mail,
  RotateCw,
  Send,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { studioFetch } from "./api";
import { getStudioRuntime } from "./runtime";

type DeliveryAction = "onedrive" | "outlook";
type DeliveryStage = "edit" | "review" | "done";
type Provider = "outlook" | "onedrive_personal" | "onedrive_business";

type DeliveryFile = {
  id: string;
  name: string;
  mime: string;
  size: number;
  version: number;
};

type Connection = {
  key?: string;
  provider: Provider;
  status: string;
  externalAccountLabel: string | null;
};

type HistoryEntry = {
  id: string;
  action: DeliveryAction;
  provider: Provider;
  version: number;
  status: "succeeded" | "failed" | "unknown";
  createdAt: string;
  actorId: string;
  actorName?: string;
};

type DeliveryContext = {
  file: DeliveryFile;
  connections: Connection[];
  history: HistoryEntry[];
};

type FolderEntry = { id: string; name: string };
type FolderCrumb = { id?: string; name: string };
type Confirmation = {
  confirmationId: string;
  token: string;
  expiresAt: string;
};
type ReviewSnapshot = {
  action: DeliveryAction;
  file: DeliveryFile;
  connection: Connection;
  folderPath: FolderCrumb[];
  name: string;
  to: string[];
  subject: string;
  body: string;
};
type DeliveryResult = {
  action: DeliveryAction;
  status: "succeeded" | "failed" | "unknown";
  webUrl?: string | null;
};

const OUTLOOK_MAX_SIZE = 2 * 1024 * 1024;
const ONEDRIVE_MAX_SIZE = 5 * 1024 * 1024;

async function readData<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await studioFetch(path, {
    ...init,
    ...(init?.body
      ? {
          headers: {
            "Content-Type": "application/json",
            ...init.headers,
          },
        }
      : {}),
  });
  const body = (await response.json().catch(() => ({}))) as {
    data?: T;
    error?: string | { message?: string };
  };
  if (!response.ok) {
    throw new Error(
      typeof body.error === "string"
        ? body.error
        : (body.error?.message ?? "Request failed."),
    );
  }
  return body.data as T;
}

function providerName(
  provider: Provider,
  t: (key: keyof typeof messages & string) => string,
) {
  if (provider === "outlook") return t("Outlook");
  return provider === "onedrive_business"
    ? t("OneDrive para empresas")
    : t("OneDrive Personal");
}

function providerMatches(action: DeliveryAction, provider: Provider) {
  return action === "outlook" ? provider === "outlook" : provider !== "outlook";
}

export function DocumentDeliveryActions({
  file,
  disabled = false,
}: {
  file: DeliveryFile;
  disabled?: boolean;
}) {
  const t = useMessages(messages);
  const locale = intlLocale(useAppLocale());
  const queryClient = useQueryClient();
  const [action, setAction] = useState<DeliveryAction | null>(null);
  const [stage, setStage] = useState<DeliveryStage>("edit");
  const [provider, setProvider] = useState<Provider | "">("");
  const [folderPath, setFolderPath] = useState<FolderCrumb[]>([]);
  const [name, setName] = useState(file.name);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState(file.name);
  const [body, setBody] = useState("");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [reviewSnapshot, setReviewSnapshot] = useState<ReviewSnapshot | null>(
    null,
  );
  const [result, setResult] = useState<DeliveryResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const contextKey = [
    "document-delivery",
    getStudioRuntime().apiBasePath,
    file.id,
  ] as const;
  const context = useQuery({
    enabled: Boolean(action),
    queryKey: contextKey,
    queryFn: () =>
      readData<DeliveryContext>(
        `/api/file/${encodeURIComponent(file.id)}/delivery`,
      ),
    retry: false,
  });
  const accounts = useMemo(
    () =>
      (context.data?.connections ?? []).filter(
        (connection) =>
          connection.status === "connected" &&
          action !== null &&
          providerMatches(action, connection.provider),
      ),
    [action, context.data?.connections],
  );
  const selectedConnection = accounts.find(
    (item) => item.provider === provider,
  );
  const displayedConnection =
    (stage === "review" || stage === "done"
      ? reviewSnapshot?.connection
      : selectedConnection) ?? selectedConnection;
  const displayedFile =
    (stage === "review" || stage === "done"
      ? reviewSnapshot?.file
      : context.data?.file) ?? file;
  const activeFolder = folderPath.at(-1);
  const folderParams = new URLSearchParams({ provider });
  if (activeFolder?.id) folderParams.set("parentId", activeFolder.id);
  const folders = useQuery({
    enabled:
      action === "onedrive" && stage === "edit" && Boolean(selectedConnection),
    queryKey: [
      "document-delivery-folders",
      getStudioRuntime().apiBasePath,
      file.id,
      provider,
      activeFolder?.id ?? "root",
    ],
    queryFn: () =>
      readData<FolderEntry[]>(
        `/api/file/${encodeURIComponent(file.id)}/delivery/folders?${folderParams.toString()}`,
      ),
    retry: false,
  });

  useEffect(() => {
    if (!provider && accounts[0]) setProvider(accounts[0].provider);
  }, [accounts, provider]);

  function open(next: DeliveryAction) {
    setAction(next);
    setStage("edit");
    setProvider("");
    setFolderPath([]);
    setName(file.name);
    setTo("");
    setSubject(file.name);
    setBody("");
    setConfirmation(null);
    setReviewSnapshot(null);
    setResult(null);
    setError("");
  }

  function close() {
    if (busy) return;
    setAction(null);
    setStage("edit");
    setError("");
  }

  const outlookTooLarge = file.size > OUTLOOK_MAX_SIZE;
  const oneDriveTooLarge = file.size > ONEDRIVE_MAX_SIZE;
  const recipients = to
    .split(/[;,\n]/)
    .map((address) => address.trim())
    .filter(Boolean);
  const providerProblems = (context.data?.connections ?? []).filter(
    (connection) =>
      action !== null &&
      providerMatches(action, connection.provider) &&
      connection.status !== "connected",
  );
  const fileExtension = displayedFile.name.split(".").at(-1)?.toUpperCase();
  const formattedFileSize =
    displayedFile.size < 1024 * 1024
      ? `${Math.ceil(displayedFile.size / 1024)} KB`
      : `${(displayedFile.size / (1024 * 1024)).toLocaleString(locale, { maximumFractionDigits: 1 })} MB`;

  async function prepare() {
    setError("");
    if (!action) return;
    if (!selectedConnection) {
      setError(t("Elige una cuenta conectada."));
      return;
    }
    if (!selectedConnection.key) {
      setError(t("La cuenta debe volver a conectarse para continuar."));
      return;
    }
    if (action === "outlook" && recipients.length === 0) {
      setError(t("Debes indicar al menos un destinatario."));
      return;
    }
    if (
      action === "outlook" &&
      recipients.some((address) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address))
    ) {
      setError(t("Revisa las direcciones de correo."));
      return;
    }
    if (action === "outlook" && recipients.length > 20) {
      setError(t("Puedes enviar a un máximo de 20 destinatarios."));
      return;
    }
    if (action === "outlook" && !subject.trim()) {
      setError(t("Debes escribir un asunto."));
      return;
    }
    if (action === "outlook" && !body.trim()) {
      setError(t("Escribe un mensaje antes de continuar."));
      return;
    }
    setBusy(true);
    try {
      const preparedFile = context.data?.file ?? file;
      const preparedConnection = { ...selectedConnection };
      const payload =
        action === "onedrive"
          ? {
              action,
              version: preparedFile.version,
              provider: selectedConnection.provider,
              connectionKey: selectedConnection.key,
              ...(activeFolder?.id ? { folderId: activeFolder.id } : {}),
              name: name.trim() || file.name,
            }
          : {
              action,
              version: preparedFile.version,
              connectionKey: selectedConnection.key,
              to: recipients,
              subject: subject.trim(),
              body,
            };
      const prepared = await readData<Confirmation>(
        `/api/file/${encodeURIComponent(file.id)}/delivery/prepare`,
        { method: "POST", body: JSON.stringify(payload) },
      );
      setReviewSnapshot({
        action,
        file: preparedFile,
        connection: preparedConnection,
        folderPath: [...folderPath],
        name: name.trim() || file.name,
        to: [...recipients],
        subject: subject.trim(),
        body,
      });
      setConfirmation(prepared);
      setStage("review");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t("No se pudo preparar la entrega."),
      );
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!confirmation || !action) return;
    setError("");
    setBusy(true);
    try {
      const completed = await readData<DeliveryResult>(
        `/api/file/${encodeURIComponent(file.id)}/delivery/confirm`,
        {
          method: "POST",
          body: JSON.stringify(confirmation),
        },
      );
      if (completed.status !== "succeeded") {
        throw new Error(
          t(
            "La entrega no se confirmó. Revisa el historial antes de volver a intentarlo.",
          ),
        );
      }
      setResult(completed);
      setStage("done");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t("No se pudo completar la entrega."),
      );
      setConfirmation(null);
      setStage("done");
    } finally {
      setConfirmation(null);
      setBusy(false);
      void queryClient.invalidateQueries({ queryKey: contextKey });
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-1">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 gap-1.5 px-2.5 text-xs"
          disabled={disabled || oneDriveTooLarge}
          title={
            oneDriveTooLarge
              ? t("Este archivo supera el límite de 5 MiB para OneDrive.")
              : undefined
          }
          onClick={() => open("onedrive")}
        >
          <CloudUpload size={14} aria-hidden="true" />
          {t("Guardar copia")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 gap-1.5 px-2.5 text-xs"
          disabled={disabled || outlookTooLarge}
          title={
            outlookTooLarge
              ? t("Este archivo supera el límite de 2 MiB para Outlook.")
              : undefined
          }
          onClick={() => open("outlook")}
        >
          <Send size={14} aria-hidden="true" />
          {t("Enviar")}
        </Button>
      </div>
      {(oneDriveTooLarge || outlookTooLarge) && (
        <p className="mt-1 text-xs text-muted-foreground">
          {[
            ...(oneDriveTooLarge
              ? [t("Este archivo supera el límite de 5 MiB para OneDrive.")]
              : []),
            ...(outlookTooLarge
              ? [t("Este archivo supera el límite de 2 MiB para Outlook.")]
              : []),
          ].join(" ")}
        </p>
      )}
      {action && (
        <Dialog
          open
          onOpenChange={(isOpen) => {
            if (!isOpen) close();
          }}
        >
          <DialogContent className="max-h-[90dvh] min-w-0 grid-cols-[minmax(0,1fr)] overflow-y-auto [overflow-wrap:anywhere] sm:max-w-2xl">
            <DialogHeader className="pr-8">
              <DialogTitle className="flex items-center gap-2">
                {action === "onedrive" ? (
                  <CloudUpload size={19} aria-hidden="true" />
                ) : (
                  <Mail size={19} aria-hidden="true" />
                )}
                {action === "onedrive"
                  ? t("Preparar copia en OneDrive")
                  : t("Preparar correo en Outlook")}
              </DialogTitle>
              <DialogDescription>
                {stage !== "done"
                  ? t("Aún no se ha enviado ni guardado nada.")
                  : result
                    ? result.action === "onedrive"
                      ? t("Copia guardada en OneDrive.")
                      : t("Outlook aceptó el envío.")
                    : t(
                        "La entrega no se confirmó. Revisa el historial antes de volver a intentarlo.",
                      )}
              </DialogDescription>
            </DialogHeader>

            {context.isPending ? (
              <div
                className="flex items-center gap-2 py-8 text-sm text-muted-foreground"
                role="status"
              >
                <LoaderCircle
                  size={16}
                  className="animate-spin"
                  aria-hidden="true"
                />
                {t("Cargando datos de entrega…")}
              </div>
            ) : context.error && stage !== "done" ? (
              <div className="space-y-3 rounded-md border p-4" role="alert">
                <p className="text-sm text-destructive">
                  {context.error.message}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void context.refetch()}
                >
                  <RotateCw size={14} aria-hidden="true" /> {t("Reintentar")}
                </Button>
              </div>
            ) : (
              <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5">
                <section className="min-w-0 rounded-md border bg-muted/20 p-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="grid size-10 shrink-0 place-items-center rounded-md bg-background text-primary">
                      {action === "onedrive" ? (
                        <CloudUpload size={18} />
                      ) : (
                        <Mail size={18} />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold [overflow-wrap:anywhere]">
                        {displayedFile.name}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {fileExtension} · {formattedFileSize} ·{" "}
                        {t("Versión %{version}", {
                          version: displayedFile.version,
                        })}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
                    <span>{t("Cuenta de Microsoft")}</span>
                    {displayedConnection ? (
                      <span className="font-medium text-foreground">
                        {providerName(displayedConnection.provider, t)}
                        {displayedConnection.externalAccountLabel
                          ? ` · ${t("Conectada como %{account}", { account: displayedConnection.externalAccountLabel })}`
                          : ""}
                      </span>
                    ) : (
                      <span>
                        {t("Elige una cuenta conectada para continuar.")}
                      </span>
                    )}
                  </div>
                </section>

                {accounts.length > 1 && stage === "edit" && (
                  <fieldset className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
                    <legend className="mb-1 text-sm font-medium">
                      {t("Cuenta de Microsoft")}
                    </legend>
                    <div className="flex flex-wrap gap-2">
                      {accounts.map((account) => (
                        <Button
                          key={account.provider}
                          type="button"
                          size="sm"
                          variant={
                            provider === account.provider
                              ? "default"
                              : "outline"
                          }
                          className="h-auto max-w-full whitespace-normal text-left [overflow-wrap:anywhere]"
                          aria-pressed={provider === account.provider}
                          onClick={() => {
                            setProvider(account.provider);
                            setFolderPath([]);
                          }}
                        >
                          {providerName(account.provider, t)}
                          {account.externalAccountLabel
                            ? ` · ${account.externalAccountLabel}`
                            : ""}
                        </Button>
                      ))}
                    </div>
                  </fieldset>
                )}

                {accounts.length === 0 && (
                  <div className="flex flex-col gap-2 rounded-md border border-dashed p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-medium">
                        {providerProblems.some(
                          (connection) =>
                            connection.status === "reconnect_required",
                        )
                          ? t("La cuenta necesita reconectarse para continuar.")
                          : action === "onedrive"
                            ? t("OneDrive necesita una cuenta conectada.")
                            : t("Outlook necesita una cuenta conectada.")}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t("Elige una cuenta conectada para continuar.")}
                      </p>
                    </div>
                    <Button asChild variant="outline" size="sm">
                      <a href="/my-integrations?tab=connections">
                        {t("Conectar cuenta")}
                      </a>
                    </Button>
                  </div>
                )}

                {selectedConnection && !selectedConnection.key && (
                  <p className="text-sm text-destructive" role="alert">
                    {t("La cuenta debe volver a conectarse para continuar.")}
                  </p>
                )}

                {action === "onedrive" &&
                  stage !== "done" &&
                  selectedConnection && (
                    <section className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
                      {stage === "edit" ? (
                        <>
                          <div className="flex items-center justify-between gap-2">
                            <Label>{t("Explorar OneDrive")}</Label>
                            <div className="flex min-w-0 items-center gap-1 overflow-x-auto text-xs text-muted-foreground">
                              {folderPath.map((crumb, index) => (
                                <span
                                  key={`${crumb.id}-${index}`}
                                  className="flex shrink-0 items-center gap-1"
                                >
                                  <ChevronRight size={12} aria-hidden="true" />
                                  <button
                                    type="button"
                                    className="max-w-28 truncate rounded-sm underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                    onClick={() =>
                                      setFolderPath(
                                        folderPath.slice(0, index + 1),
                                      )
                                    }
                                  >
                                    {crumb.name}
                                  </button>
                                </span>
                              ))}
                              {folderPath.length === 0 && (
                                <span className="rounded-sm font-medium text-foreground">
                                  {t("Carpeta raíz")}
                                </span>
                              )}
                            </div>
                          </div>
                          {folderPath.length > 0 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="w-fit px-1"
                              onClick={() =>
                                setFolderPath(folderPath.slice(0, -1))
                              }
                            >
                              <ArrowLeft size={14} aria-hidden="true" />{" "}
                              {t("Volver a carpetas")}
                            </Button>
                          )}
                          {folders.isPending ? (
                            <p
                              className="flex items-center gap-2 py-3 text-sm text-muted-foreground"
                              role="status"
                            >
                              <LoaderCircle
                                size={15}
                                className="animate-spin"
                                aria-hidden="true"
                              />{" "}
                              {t("Cargando carpetas…")}
                            </p>
                          ) : folders.error ? (
                            <div
                              className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
                              role="alert"
                            >
                              <p className="text-sm text-destructive">
                                {folders.error.message}
                              </p>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => void folders.refetch()}
                              >
                                <RotateCw size={14} aria-hidden="true" />{" "}
                                {t("Reintentar")}
                              </Button>
                            </div>
                          ) : (
                            <ul
                              className="max-h-48 divide-y overflow-y-auto rounded-md border"
                              aria-label={t("Explorar OneDrive")}
                            >
                              <li>
                                <button
                                  type="button"
                                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                                  onClick={() => setFolderPath([])}
                                >
                                  <Folder size={15} aria-hidden="true" />
                                  <span className="flex-1">
                                    {t("Carpeta raíz")}
                                  </span>
                                  {folderPath.length === 0 && (
                                    <Check
                                      size={15}
                                      aria-label={t("Carpeta raíz")}
                                    />
                                  )}
                                </button>
                              </li>
                              {(folders.data ?? []).map((folder) => (
                                <li key={folder.id}>
                                  <button
                                    type="button"
                                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                                    onClick={() =>
                                      setFolderPath([...folderPath, folder])
                                    }
                                  >
                                    <Folder
                                      size={15}
                                      aria-hidden="true"
                                      className="text-primary"
                                    />
                                    <span className="min-w-0 flex-1 truncate">
                                      {folder.name}
                                    </span>
                                    <ChevronRight
                                      size={15}
                                      aria-hidden="true"
                                    />
                                  </button>
                                </li>
                              ))}
                              {!folders.data?.length && (
                                <li className="px-3 py-3 text-sm text-muted-foreground">
                                  {t("No hay carpetas en esta ubicación.")}
                                </li>
                              )}
                            </ul>
                          )}
                          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
                            <Label htmlFor={`delivery-name-${file.id}`}>
                              {t("Nombre de la copia")}
                            </Label>
                            <Input
                              id={`delivery-name-${file.id}`}
                              value={name}
                              onChange={(event) => setName(event.target.value)}
                            />
                          </div>
                        </>
                      ) : (
                        <div className="grid gap-2 rounded-md border p-3 text-sm">
                          <p className="font-medium">
                            {t(
                              "Elige una carpeta de destino y confirma la copia.",
                            )}
                          </p>
                          <p className="break-all text-muted-foreground">
                            {reviewSnapshot?.folderPath
                              .map((crumb) => crumb.name)
                              .join(" / ") || t("Carpeta raíz")}
                          </p>
                          <p>
                            {reviewSnapshot?.name ?? (name.trim() || file.name)}
                          </p>
                        </div>
                      )}
                    </section>
                  )}

                {action === "outlook" &&
                  stage !== "done" &&
                  selectedConnection && (
                    <section className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
                      {stage === "edit" ? (
                        <>
                          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
                            <Label htmlFor={`delivery-to-${file.id}`}>
                              {t("Para")}
                            </Label>
                            <Input
                              id={`delivery-to-${file.id}`}
                              autoComplete="email"
                              placeholder="nombre@ejemplo.com"
                              value={to}
                              onChange={(event) => setTo(event.target.value)}
                            />
                            <p className="text-xs text-muted-foreground">
                              {t(
                                "Usa comas o punto y coma para separar direcciones.",
                              )}
                            </p>
                          </div>
                          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
                            <Label htmlFor={`delivery-subject-${file.id}`}>
                              {t("Asunto")}
                            </Label>
                            <Input
                              id={`delivery-subject-${file.id}`}
                              value={subject}
                              onChange={(event) =>
                                setSubject(event.target.value)
                              }
                            />
                          </div>
                          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
                            <Label htmlFor={`delivery-body-${file.id}`}>
                              {t("Mensaje")}
                            </Label>
                            <Textarea
                              id={`delivery-body-${file.id}`}
                              rows={4}
                              value={body}
                              onChange={(event) => setBody(event.target.value)}
                            />
                          </div>
                        </>
                      ) : (
                        <div className="grid gap-3 rounded-md border p-3 text-sm">
                          <p>
                            {t(
                              "Revisa los destinatarios y el mensaje antes de enviarlo.",
                            )}
                          </p>
                          <div>
                            <span className="font-medium">{t("Para")}:</span>{" "}
                            {recipients.join(", ")}
                          </div>
                          <div>
                            <span className="font-medium">{t("Asunto")}:</span>{" "}
                            {subject}
                          </div>
                          {body && (
                            <p className="whitespace-pre-wrap text-muted-foreground">
                              {body}
                            </p>
                          )}
                          <p className="text-xs text-muted-foreground">
                            {reviewSnapshot?.file.name ?? displayedFile.name} ·{" "}
                            {t("Versión %{version}", {
                              version:
                                reviewSnapshot?.file.version ??
                                displayedFile.version,
                            })}
                          </p>
                        </div>
                      )}
                    </section>
                  )}

                {stage === "done" && result && (
                  <div
                    className="flex items-start gap-3 rounded-md border p-4"
                    role="status"
                  >
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                      <Check size={17} aria-hidden="true" />
                    </span>
                    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
                      <p className="font-medium">
                        {result.action === "onedrive"
                          ? t("Copia guardada en OneDrive.")
                          : t("Outlook aceptó el envío.")}
                      </p>
                      {result.webUrl && result.action === "onedrive" && (
                        <a
                          href={result.webUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-sm text-primary underline underline-offset-4"
                        >
                          {t("Abrir copia en OneDrive")}{" "}
                          <ExternalLink size={13} aria-hidden="true" />
                        </a>
                      )}
                    </div>
                  </div>
                )}

                {context.error ? (
                  <section className="grid gap-2 border-t pt-4" role="alert">
                    <p className="text-sm text-muted-foreground">
                      {t(
                        "No se pudo actualizar el historial. Esto no cambia el resultado de la entrega.",
                      )}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-fit"
                      disabled={context.isFetching}
                      onClick={() => void context.refetch()}
                    >
                      <RotateCw size={14} aria-hidden="true" />
                      {t("Actualizar historial")}
                    </Button>
                  </section>
                ) : context.data?.history.length ? (
                  <section className="grid gap-2 border-t pt-4">
                    <h3 className="text-sm font-semibold">
                      {t("Historial reciente")}
                    </h3>
                    <ul className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
                      {context.data.history.slice(0, 5).map((entry) => (
                        <li
                          key={entry.id}
                          className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs"
                        >
                          <span className="font-medium">
                            {providerName(entry.provider, t)} ·{" "}
                            {t("Versión %{version}", {
                              version: entry.version,
                            })}
                          </span>
                          <span className="text-muted-foreground">
                            {t(
                              entry.status === "succeeded"
                                ? "Éxito"
                                : entry.status === "failed"
                                  ? "Fallido"
                                  : "Desconocido",
                            )}{" "}
                            · {new Date(entry.createdAt).toLocaleString(locale)}{" "}
                            ·{" "}
                            {t("Por %{actor}", {
                              actor: entry.actorName ?? entry.actorId,
                            })}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : (
                  <p className="border-t pt-3 text-xs text-muted-foreground">
                    {t("Aún no hay entregas registradas.")}
                  </p>
                )}
              </div>
            )}

            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
            <DialogFooter className="gap-2 sm:justify-between">
              {stage !== "done" && (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={close}
                >
                  {t("Cerrar")}
                </Button>
              )}
              {stage === "review" && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setStage("edit")}
                >
                  {t("Cambiar detalles")}
                </Button>
              )}
              {stage === "edit" && (
                <Button
                  type="button"
                  disabled={
                    busy ||
                    !selectedConnection?.key ||
                    (action === "onedrive" ? oneDriveTooLarge : outlookTooLarge)
                  }
                  onClick={() => void prepare()}
                >
                  {busy ? (
                    <LoaderCircle
                      size={15}
                      className="animate-spin"
                      aria-hidden="true"
                    />
                  ) : null}
                  {busy ? t("Preparando…") : t("Revisar entrega")}
                </Button>
              )}
              {stage === "review" && confirmation && (
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() => void confirm()}
                >
                  {busy ? (
                    <LoaderCircle
                      size={15}
                      className="animate-spin"
                      aria-hidden="true"
                    />
                  ) : null}
                  {busy
                    ? t("Procesando…")
                    : action === "onedrive"
                      ? t("Confirmar y guardar")
                      : t("Confirmar y enviar")}
                </Button>
              )}
              {stage === "done" && (
                <Button type="button" onClick={close}>
                  {t("Cerrar")}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
