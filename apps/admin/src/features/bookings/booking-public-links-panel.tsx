import type { ApiClient } from "@/api/api-client";
import {
  Ban,
  Check,
  Copy,
  ExternalLink,
  Link2,
  QrCode,
  Share2,
  Trash2,
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { PwaSpinner } from "@/pwa/pwa-splash";
import { Button } from "@/components/ui/button";
import { intlLocale, useAppLocale, useMessages } from "@/i18n/core";
import QRCode from "react-qr-code";
import { useCallback, useEffect, useMemo, useState } from "react";
import { bookingMessages } from "./booking-messages";
import type { BookingLinkScope, BookingPublicLink } from "./booking-types";

function LinkAction({
  label,
  children,
  ...props
}: Omit<ComponentProps<typeof Button>, "children"> & {
  label: string;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-11 shrink-0"
          aria-label={label}
          {...props}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

type ServiceOption = { id: string; name: string };
type Expiry = "24h" | "7d" | "30d" | "never";

function expiryDate(expiry: Expiry) {
  if (expiry === "never") return null;
  const hours = expiry === "24h" ? 24 : expiry === "7d" ? 24 * 7 : 24 * 30;
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function linkIsActive(link: BookingPublicLink) {
  return (
    !link.revokedAt &&
    !(link.expiresAt && Date.parse(link.expiresAt) <= Date.now())
  );
}

export function BookingPublicLinksPanel({
  tenantId,
  currentProfessionalId,
  currentProfessionalName,
  canManageTeamLinks,
  apiClient,
  services,
}: {
  tenantId: string;
  currentProfessionalId: string | null;
  currentProfessionalName?: string;
  canManageTeamLinks: boolean;
  apiClient: ApiClient;
  services: ServiceOption[];
}) {
  const t = useMessages(bookingMessages);
  const locale = useAppLocale();
  const [links, setLinks] = useState<BookingPublicLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [notice, setNotice] = useState("");
  const [expiry, setExpiry] = useState<Expiry>("30d");
  const [serviceId, setServiceId] = useState("");
  const [dailyLimit, setDailyLimit] = useState(25);
  const [busy, setBusy] = useState(false);
  const [activeOperation, setActiveOperation] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [shorteningId, setShorteningId] = useState("");
  const [qrVisible, setQrVisible] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState("");

  const endpoint = `/v1/tenants/${encodeURIComponent(tenantId)}/booking/public-links`;
  const loadLinks = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const response = await apiClient.get<{
        data: { links: BookingPublicLink[] };
      }>(endpoint);
      setLinks(response.data.links);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [apiClient, endpoint]);

  useEffect(() => {
    void loadLinks();
  }, [loadLinks]);

  const activeLinks = useMemo(() => links.filter(linkIsActive), [links]);
  const expiryLabel = (link: BookingPublicLink) =>
    link.expiresAt
      ? t("Expires %{date}", {
          date: new Intl.DateTimeFormat(intlLocale(locale), {
            dateStyle: "medium",
          }).format(new Date(link.expiresAt)),
        })
      : t("No expiry");

  async function create(scope: BookingLinkScope) {
    setBusy(true);
    setError(false);
    setNotice("");
    try {
      const response = await apiClient.post<{ data: BookingPublicLink }>(
        endpoint,
        {
          scope,
          serviceId: serviceId || null,
          expiresAt: expiryDate(expiry),
          dailyLimit,
        },
      );
      setLinks((current) => [
        response.data,
        ...current.filter((link) => link.id !== response.data.id),
      ]);
      setNotice(t("Booking link created."));
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(link: BookingPublicLink) {
    setActiveOperation(link.id);
    setConfirming(null);
    setError(false);
    setNotice("");
    try {
      const response = await apiClient.post<{ data: BookingPublicLink }>(
        `${endpoint}/${encodeURIComponent(link.id)}/revoke`,
        { version: link.version },
      );
      setLinks((current) =>
        current.map((item) => (item.id === link.id ? response.data : item)),
      );
      setNotice(t("Booking link revoked."));
    } catch {
      setError(true);
    } finally {
      setActiveOperation("");
    }
  }

  async function remove(link: BookingPublicLink) {
    setActiveOperation(link.id);
    setError(false);
    setNotice("");
    try {
      await apiClient.delete(`${endpoint}/${encodeURIComponent(link.id)}`, {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: link.version }),
      });
      setLinks((current) => current.filter((item) => item.id !== link.id));
      setConfirming(null);
      setNotice(t("Booking link deleted."));
    } catch {
      setError(true);
    } finally {
      setActiveOperation("");
    }
  }

  async function shorten(link: BookingPublicLink) {
    setShorteningId(link.id);
    setError(false);
    try {
      const response = await apiClient.post<{ data: { shortUrl: string } }>(
        `${endpoint}/${encodeURIComponent(link.id)}/short-url`,
      );
      setLinks((current) =>
        current.map((item) =>
          item.id === link.id
            ? { ...item, shortUrl: response.data.shortUrl }
            : item,
        ),
      );
    } catch {
      setError(true);
    } finally {
      setShorteningId("");
    }
  }

  async function copy(link: BookingPublicLink, short = false) {
    try {
      await navigator.clipboard.writeText(
        short ? link.shortUrl! : link.publicUrl,
      );
      setCopied(`${link.id}:${short ? "short" : "full"}`);
      setNotice(t("Link copied."));
    } catch {
      setError(true);
    }
  }

  async function share(link: BookingPublicLink) {
    if (!navigator.share) return;
    try {
      await navigator.share({
        title: t("Appointments"),
        url: link.shortUrl || link.publicUrl,
      });
      setNotice(t("Booking link shared."));
    } catch (shareError) {
      if (!(
        shareError instanceof DOMException && shareError.name === "AbortError"
      ))
        setError(true);
    }
  }

  const scopeName = (scope: BookingLinkScope) =>
    scope.kind === "team" ? t("Team agenda") : t("My booking link");

  return (
    <section
      aria-labelledby="booking-links-heading"
      className="grid gap-5 border-t pt-6"
    >
      <div className="grid gap-1">
        <h2 id="booking-links-heading" className="text-lg font-semibold">
          {t("Booking links")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("Create and manage links customers can use to book appointments.")}
        </p>
      </div>
      <div className="grid gap-4 rounded-lg border bg-card p-4">
        {currentProfessionalId && currentProfessionalName && (
          <p className="text-sm text-muted-foreground">
            {t("Personal link for %{name}", { name: currentProfessionalName })}
          </p>
        )}
        <label className="grid gap-2 text-sm font-medium">
          {t("Link expiry")}
          <select
            className="h-11 rounded-md border border-input bg-background px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm"
            value={expiry}
            onChange={(event) => setExpiry(event.target.value as Expiry)}
          >
            <option value="24h">{t("24 hours")}</option>
            <option value="7d">{t("7 days")}</option>
            <option value="30d">{t("30 days (default)")}</option>
            <option value="never">{t("No expiry")}</option>
          </select>
        </label>
        <label className="grid gap-2 text-sm font-medium">
          {t("Service (optional)")}
          <select
            className="h-11 rounded-md border border-input bg-background px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm"
            value={serviceId}
            onChange={(event) => setServiceId(event.target.value)}
          >
            <option value="">{t("Any eligible service")}</option>
            {services.map((service) => (
              <option key={service.id} value={service.id}>
                {service.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-2 text-sm font-medium">
          {t("Daily booking limit")}
          <input
            aria-label={t("Daily booking limit")}
            className="h-11 w-full rounded-md border border-input bg-background px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm"
            type="number"
            min={1}
            max={1000}
            step={1}
            required
            value={dailyLimit}
            onChange={(event) =>
              setDailyLimit(
                Math.min(1000, Math.max(1, Number(event.target.value) || 1)),
              )
            }
          />
        </label>
        <p className="text-sm text-muted-foreground">
          {t(
            "New links default to 25 bookings per day. Set a link-specific limit below.",
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            className="min-h-11"
            disabled={loading || busy || !currentProfessionalId}
            onClick={() =>
              currentProfessionalId &&
              void create({
                kind: "professional",
                professionalId: currentProfessionalId,
              })
            }
          >
            {t("Create my booking link")}
          </Button>
          {canManageTeamLinks && (
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={loading || busy}
              onClick={() => void create({ kind: "team" })}
            >
              {t("Create team agenda link")}
            </Button>
          )}
        </div>
        {!currentProfessionalId && (
          <p role="status" className="text-sm text-muted-foreground">
            {t(
              "Your booking profile is not set up yet. Ask an administrator to add you as an active professional before creating a personal link.",
            )}
          </p>
        )}
        {!canManageTeamLinks && (
          <p className="text-sm text-muted-foreground">
            {t("Team booking links are available to booking administrators.")}
          </p>
        )}
      </div>
      {notice && (
        <p role="status" className="text-sm text-green-700 dark:text-green-400">
          {notice}
        </p>
      )}
      {error && (
        <div className="grid justify-items-start gap-2">
          <p role="alert" className="text-sm text-destructive">
            {t(
              "Booking links could not be updated. Check your connection and retry.",
            )}
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={loading || busy || !!activeOperation || !!shorteningId}
            onClick={() => void loadLinks()}
          >
            {t("Retry")}
          </Button>
        </div>
      )}
      {loading && (
        <div
          role="status"
          className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground"
        >
          <PwaSpinner size="sm" />
          <span>{t("Loading booking links…")}</span>
        </div>
      )}
      {!loading && !error && !links.length && (
        <p className="text-sm text-muted-foreground">
          {t("No booking links yet. Create a personal link to get started.")}
        </p>
      )}
      {!loading && !!links.length && (
        <ul className="m-0 grid min-w-0 list-none gap-4 p-0">
          {links.map((link) => {
            const active = linkIsActive(link);
            const service = services.find((item) => item.id === link.serviceId);
            return (
              <li
                key={link.id}
                className="grid min-w-0 gap-3 border-b pb-4 last:border-0 sm:grid-cols-[minmax(0,1fr)_auto]"
              >
                <div className="grid min-w-0 gap-1">
                  <h3 className="font-medium">
                    {scopeName(link.scope)}
                    {service ? ` · ${service.name}` : ""}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {expiryLabel(link)} ·{" "}
                    {t("%{count} bookings per day", { count: link.dailyLimit })}
                  </p>
                  {!active && (
                    <p className="text-sm text-muted-foreground">
                      {link.revokedAt ? t("Revoked") : t("Expired")}
                    </p>
                  )}
                  <div className="mt-2 grid min-w-0 gap-3">
                    <div className="grid min-w-0 gap-1.5">
                      <span className="text-xs font-medium text-muted-foreground">
                        {t("Full link")}
                      </span>
                      <div className="flex min-w-0 items-center gap-2">
                        <Input
                          aria-label={t("Public link address")}
                          className="min-w-0 font-mono text-xs"
                          value={link.publicUrl}
                          readOnly
                          onFocus={(event) => event.target.select()}
                        />
                        <LinkAction
                          label={t("Copy link")}
                          onClick={() => void copy(link)}
                          disabled={!active}
                        >
                          {copied === `${link.id}:full` ? (
                            <Check className="size-4" aria-hidden="true" />
                          ) : (
                            <Copy className="size-4" aria-hidden="true" />
                          )}
                        </LinkAction>
                      </div>
                    </div>
                    <div className="grid min-w-0 gap-1.5">
                      <span className="text-xs font-medium text-muted-foreground">
                        {t("Short link")}
                      </span>
                      <div className="flex min-w-0 items-center gap-2">
                        {link.shortUrl ? (
                          <Input
                            aria-label={t("Short link address")}
                            className="min-w-0 font-mono text-xs"
                            value={link.shortUrl}
                            readOnly
                            onFocus={(event) => event.target.select()}
                          />
                        ) : (
                          <span className="flex min-h-9 min-w-0 flex-1 items-center rounded-md border border-dashed px-3 text-xs text-muted-foreground">
                            {shorteningId === link.id
                              ? t("Generating short link…")
                              : t("Short link not generated yet.")}
                          </span>
                        )}
                        <LinkAction
                          label={t("Copy short link")}
                          onClick={() => void copy(link, true)}
                          disabled={!active || !link.shortUrl}
                        >
                          {copied === `${link.id}:short` ? (
                            <Check className="size-4" aria-hidden="true" />
                          ) : (
                            <Copy className="size-4" aria-hidden="true" />
                          )}
                        </LinkAction>
                        {!link.shortUrl && active && (
                          <LinkAction
                            label={t("Shorten URL")}
                            onClick={() => void shorten(link)}
                            disabled={!!shorteningId || !!activeOperation}
                          >
                            {shorteningId === link.id ? (
                              <PwaSpinner size="xs" />
                            ) : (
                              <Link2 className="size-4" aria-hidden="true" />
                            )}
                          </LinkAction>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-start gap-2">
                  {typeof navigator !== "undefined" &&
                    typeof navigator.share === "function" && (
                      <LinkAction
                        label={t("Share")}
                        onClick={() => void share(link)}
                        disabled={!active}
                      >
                        <Share2 className="size-4" aria-hidden="true" />
                      </LinkAction>
                    )}
                  {active && (
                    <LinkAction label={t("Open link")} asChild>
                      <a
                        href={link.shortUrl || link.publicUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <ExternalLink className="size-4" aria-hidden="true" />
                      </a>
                    </LinkAction>
                  )}
                  <LinkAction
                    label={t("QR code")}
                    disabled={!active}
                    aria-expanded={active && !!qrVisible[link.id]}
                    onClick={() =>
                      setQrVisible((current) => ({
                        ...current,
                        [link.id]: !current[link.id],
                      }))
                    }
                  >
                    <QrCode className="size-4" aria-hidden="true" />
                  </LinkAction>
                  <LinkAction
                    label={
                      activeOperation === link.id && confirming !== link.id
                        ? t("Revoking…")
                        : t("Revoke link")
                    }
                    disabled={!active || !!activeOperation || !!shorteningId}
                    onClick={() => void revoke(link)}
                  >
                    {activeOperation === link.id && confirming !== link.id ? (
                      <PwaSpinner size="xs" />
                    ) : (
                      <Ban className="size-4" aria-hidden="true" />
                    )}
                  </LinkAction>
                  <LinkAction
                    label={t("Delete link")}
                    variant="ghost"
                    className="size-11 shrink-0 text-destructive hover:bg-destructive/10"
                    disabled={!!activeOperation || !!shorteningId}
                    onClick={() => setConfirming(link.id)}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </LinkAction>
                </div>
                {confirming === link.id && (
                  <div
                    role="group"
                    aria-label={t("Delete link")}
                    className="grid gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm sm:col-span-2"
                  >
                    <p className="font-medium">
                      {t("Delete this booking link?")}
                    </p>
                    <p className="text-muted-foreground">
                      {t(
                        "Existing appointments and their private management links will remain available.",
                      )}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="destructive"
                        disabled={!!activeOperation}
                        onClick={() => void remove(link)}
                      >
                        {activeOperation === link.id && (
                          <PwaSpinner size="xs" />
                        )}
                        {activeOperation === link.id
                          ? t("Deleting…")
                          : t("Confirm deletion")}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={!!activeOperation}
                        onClick={() => setConfirming(null)}
                      >
                        {t("Cancel deletion")}
                      </Button>
                    </div>
                  </div>
                )}
                {active && qrVisible[link.id] && (
                  <div className="w-fit rounded-md border bg-white p-3 sm:col-span-2">
                    <QRCode
                      value={link.shortUrl || link.publicUrl}
                      size={144}
                      title={t("QR code for %{name}", {
                        name: scopeName(link.scope),
                      })}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!!activeLinks.length && (
        <p className="text-xs text-muted-foreground">
          {t(
            "Revoking a booking link does not affect confirmed appointments or their private management links.",
          )}
        </p>
      )}
    </section>
  );
}
