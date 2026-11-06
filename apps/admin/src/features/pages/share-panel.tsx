import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMessages } from "@/i18n/core";
import { pagesMessages } from "./messages";
import { PagesClient, type PagePublicLink, type PageShare } from "./client";

type Tab = "members" | "public";
type Member = { principalId: string; displayName: string; email: string };

export function SharePanel({
  client,
  pageId,
  pageTitle,
  pageKind,
  onDone,
}: {
  client: PagesClient;
  pageId: string;
  pageTitle: string;
  pageKind: "page" | "folder";
  onDone(): void;
}) {
  const t = useMessages(pagesMessages);
  const [tab, setTab] = useState<Tab>("members");
  const [members, setMembers] = useState<Member[]>([]);
  const [membersLoaded, setMembersLoaded] = useState(false);
  const [membersLoading, setMembersLoading] = useState(true);
  const [membersError, setMembersError] = useState(false);
  const [shares, setShares] = useState<PageShare[]>([]);
  const [version, setVersion] = useState<number>();
  const [sharesLoaded, setSharesLoaded] = useState(false);
  const [sharesLoading, setSharesLoading] = useState(true);
  const [sharesError, setSharesError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [links, setLinks] = useState<PagePublicLink[]>([]);
  const [linksLoading, setLinksLoading] = useState(true);
  const [linksLoaded, setLinksLoaded] = useState(false);
  const [linksError, setLinksError] = useState(false);
  const [expiresAt, setExpiresAt] = useState("");
  const [creating, setCreating] = useState(false);
  const [pendingLink, setPendingLink] = useState<string>();
  const [notice, setNotice] = useState("");
  const [operationError, setOperationError] = useState(false);

  async function loadMembers() {
    setMembersLoading(true);
    setMembersError(false);
    try {
      setMembers(await client.members());
      setMembersLoaded(true);
    } catch {
      setMembersError(true);
    } finally {
      setMembersLoading(false);
    }
  }
  async function loadShares() {
    setSharesLoading(true);
    setSharesError(false);
    try {
      const result = await client.shares(pageId);
      setShares(result.shares);
      setVersion(result.version);
      setSharesLoaded(true);
    } catch {
      setSharesError(true);
    } finally {
      setSharesLoading(false);
    }
  }
  async function loadLinks() {
    setLinksLoading(true);
    setLinksError(false);
    try {
      setLinks(await client.publicLinks(pageId));
      setLinksLoaded(true);
    } catch {
      setLinksError(true);
    } finally {
      setLinksLoading(false);
    }
  }
  useEffect(() => {
    void loadMembers();
    void loadShares();
    void loadLinks();
    // Load each source independently when the dialog opens for this page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, pageId]);

  const displayedMembers = [
    ...members,
    ...shares
      .filter(
        (share) =>
          !members.some((member) => member.principalId === share.principalId),
      )
      .map((share) => ({
        principalId: share.principalId,
        displayName: share.principalId,
        email: "",
      })),
  ];
  const activeLinks = links.filter(
    (link) =>
      !link.revokedAt &&
      !(link.expiresAt && Date.parse(link.expiresAt) <= Date.now()),
  );

  async function copyLink(link: PagePublicLink) {
    const url = new URL(link.shortUrl || link.path, window.location.origin)
      .href;
    try {
      await navigator.clipboard.writeText(url);
      setNotice(t("Link copied"));
      setOperationError(false);
    } catch {
      setNotice(t("Copy unavailable"));
      setOperationError(true);
    }
  }

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label={t("Share")}
        className="flex gap-2 border-b"
      >
        <button
          role="tab"
          aria-selected={tab === "members"}
          className={`min-h-11 px-3 py-2 text-sm ${tab === "members" ? "border-b-2 border-primary font-medium text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          onClick={() => setTab("members")}
        >
          {t("Share with members")}
        </button>
        <button
          role="tab"
          aria-selected={tab === "public"}
          className={`min-h-11 px-3 py-2 text-sm ${tab === "public" ? "border-b-2 border-primary font-medium text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          onClick={() => setTab("public")}
        >
          {t("Public link")}
        </button>
      </div>
      {tab === "members" ? (
        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (
              version === undefined ||
              !membersLoaded ||
              !sharesLoaded ||
              saving
            )
              return;
            setSaving(true);
            setSaveError(false);
            try {
              await client.share(pageId, shares, version);
              onDone();
            } catch {
              setSaveError(true);
            } finally {
              setSaving(false);
            }
          }}
        >
          {(membersLoading || sharesLoading) && (
            <p role="status">{t("Loading")}</p>
          )}
          {membersError ? (
            <div role="alert" className="space-y-2">
              <p>{t("Members load failed")}</p>
              <Button
                type="button"
                variant="outline"
                onClick={() => void loadMembers()}
              >
                {t("Retry")}
              </Button>
            </div>
          ) : membersLoaded && members.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("No team members")}
            </p>
          ) : null}
          {saveError && <p role="alert">{t("Sharing save failed")}</p>}
          {sharesError ? (
            <div role="alert" className="space-y-2">
              <p>{t("Sharing load failed")}</p>
              <Button
                type="button"
                variant="outline"
                onClick={() => void loadShares()}
              >
                {t("Retry")}
              </Button>
            </div>
          ) : null}
          {sharesLoaded && membersLoaded && displayedMembers.length > 0 && (
            <div className="max-h-72 space-y-3 overflow-y-auto">
              {displayedMembers.map((member) => (
                <label
                  key={member.principalId}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span className="min-w-0 truncate">
                    {member.displayName || member.email}
                  </span>
                  <select
                    aria-label={`${t("Share")} ${member.displayName || member.email}`}
                    className="page-select !w-auto"
                    value={
                      shares.find(
                        (share) => share.principalId === member.principalId,
                      )?.role ?? "none"
                    }
                    onChange={(event) =>
                      setShares((value) => [
                        ...value.filter(
                          (share) => share.principalId !== member.principalId,
                        ),
                        ...(event.target.value === "none"
                          ? []
                          : [
                              {
                                principalId: member.principalId,
                                role: event.target.value as "reader" | "editor",
                              },
                            ]),
                      ])
                    }
                  >
                    <option value="none">{t("No access")}</option>
                    <option value="reader">{t("Reader")}</option>
                    <option value="editor">{t("Editor")}</option>
                  </select>
                </label>
              ))}
            </div>
          )}
          {membersLoaded && sharesLoaded && displayedMembers.length > 0 && (
            <Button type="submit" disabled={saving || version === undefined}>
              {t(saving ? "Saving" : "Save")}
            </Button>
          )}
        </form>
      ) : (
        <section className="space-y-4" aria-label={t("Public link")}>
          <p className="rounded-md bg-muted px-3 py-3 text-sm">
            {t("Public access notice")}
          </p>
          <p className="text-sm font-medium">
            {pageTitle} · {pageKind === "folder" ? t("Folder") : t("Content")}
          </p>
          <label className="block space-y-1 text-sm">
            <span>{t("Link expiration")}</span>
            <Input
              type="datetime-local"
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
            />
          </label>
          <Button
            type="button"
            disabled={creating || linksLoading || !linksLoaded}
            onClick={async () => {
              setCreating(true);
              setOperationError(false);
              setNotice("");
              try {
                const link = await client.createPublicLink(
                  pageId,
                  expiresAt ? new Date(expiresAt).toISOString() : undefined,
                );
                setLinks((current) => [link, ...current]);
                setLinksLoaded(true);
                setExpiresAt("");
                setNotice(t("Public link created"));
              } catch {
                setOperationError(true);
                setNotice(t("Operation failed"));
              } finally {
                setCreating(false);
              }
            }}
          >
            {t(creating ? "Creating link" : "Create public link")}
          </Button>
          {linksLoading && <p role="status">{t("Loading")}</p>}
          {linksError && (
            <div role="alert" className="space-y-2">
              <p>{t("Links load failed")}</p>
              <Button
                type="button"
                variant="outline"
                onClick={() => void loadLinks()}
              >
                {t("Retry")}
              </Button>
            </div>
          )}
          {operationError && <p role="alert">{notice}</p>}
          {!operationError && notice && <p role="status">{notice}</p>}
          {linksLoaded && links.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {t("No public links")}
            </p>
          )}
          <ul className="max-h-64 space-y-3 overflow-y-auto">
            {links.map((link) => {
              const url = new URL(
                link.shortUrl || link.path,
                window.location.origin,
              ).href;
              const expired = Boolean(
                link.expiresAt && Date.parse(link.expiresAt) <= Date.now(),
              );
              const isActiveLink = activeLinks.some(
                (activeLink) => activeLink.id === link.id,
              );
              const status = link.revokedAt
                ? "Revoked public link"
                : isActiveLink
                  ? "Active"
                  : "Expired";
              return (
                <li key={link.id} className="space-y-2 border-t pt-3 text-sm">
                  <div className="break-all text-muted-foreground">{url}</div>
                  <p
                    className={
                      link.revokedAt || expired
                        ? "text-muted-foreground"
                        : "font-medium"
                    }
                  >
                    {t(status)}
                  </p>
                  {link.expiresAt && (
                    <p className="text-muted-foreground">
                      {t("Expires")}:{" "}
                      {new Date(link.expiresAt).toLocaleString()}
                    </p>
                  )}
                  {link.revokedAt || expired ? null : (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => void copyLink(link)}
                      >
                        {t("Copy link")}
                      </Button>
                      <a
                        className="inline-flex h-9 items-center rounded-md border px-3 text-sm"
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {t("Open link")}
                      </a>
                      {!link.shortUrl && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={pendingLink === link.id}
                          onClick={async () => {
                            setPendingLink(link.id);
                            setOperationError(false);
                            setNotice("");
                            try {
                              const { shortUrl } =
                                await client.shortenPublicLink(pageId, link.id);
                              setLinks((current) =>
                                current.map((item) =>
                                  item.id === link.id
                                    ? { ...item, shortUrl }
                                    : item,
                                ),
                              );
                              setNotice(t("Short link ready"));
                            } catch {
                              setOperationError(true);
                              setNotice(t("Short link failed"));
                            } finally {
                              setPendingLink(undefined);
                            }
                          }}
                        >
                          {t(
                            pendingLink === link.id
                              ? "Creating link"
                              : "Create short link",
                          )}
                        </Button>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={pendingLink === link.id}
                        onClick={async () => {
                          setPendingLink(link.id);
                          setOperationError(false);
                          setNotice("");
                          try {
                            await client.revokePublicLink(pageId, link.id);
                            setLinks((current) =>
                              current.map((item) =>
                                item.id === link.id
                                  ? {
                                      ...item,
                                      revokedAt: new Date().toISOString(),
                                    }
                                  : item,
                              ),
                            );
                            setNotice(t("Link revoked"));
                          } catch {
                            setOperationError(true);
                            setNotice(t("Operation failed"));
                          } finally {
                            setPendingLink(undefined);
                          }
                        }}
                      >
                        {t(pendingLink === link.id ? "Saving" : "Revoke link")}
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
