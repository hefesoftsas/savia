import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  TicketSummary,
  TicketSummaryConfig,
} from "@savia/studio-shared/ticket-summary";
import {
  defaultTicketStatuses,
  ticketSummaryConfigSchema,
  ticketSummarySchema,
} from "@savia/studio-shared/ticket-summary";
import type { ApiClient } from "@/api/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppLocale, useMessages } from "@/i18n/core";
import { editorMessages } from "./editor-messages";
import "./ticket-summary-block.css";

function validHref(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function dateLabel(value: string, locale: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function excerpt(value: string) {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 180 ? `${compact.slice(0, 177)}…` : compact;
}

export function TicketSummaryBlock({
  api,
  config = {},
  connected,
  readOnly = false,
  onConfigChange,
}: {
  api: ApiClient;
  config?: TicketSummaryConfig;
  connected: boolean;
  readOnly?: boolean;
  onConfigChange(config: TicketSummaryConfig): void;
}) {
  const t = useMessages(editorMessages);
  const locale = useAppLocale();
  const id = useId();
  const configKey = JSON.stringify(config);
  const stableConfig = useMemo(() => config, [configKey]);
  const [summary, setSummary] = useState<TicketSummary>();
  const [summaryConfigKey, setSummaryConfigKey] = useState<string>();
  const visibleSummary = summaryConfigKey === configKey ? summary : undefined;
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [configError, setConfigError] = useState(false);
  const [project, setProject] = useState(config.project ?? "");
  const [statuses, setStatuses] = useState(
    (config.statuses ?? defaultTicketStatuses).join(", "),
  );
  const [suspended, setSuspended] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const controllerRef = useRef<AbortController | undefined>(undefined);
  const requestId = useRef(0);
  const currentConfigKey = useRef(configKey);
  currentConfigKey.current = configKey;

  const load = useCallback(
    async (signal: AbortSignal) => {
      const id = ++requestId.current;
      setSummary(undefined);
      setSummaryConfigKey(undefined);
      setFailed(false);
      setLoading(true);
      try {
        if (signal.aborted) return;
        const result = await api.post<{ data: unknown }>(
          "/v1/personal-integrations/ticket-summary",
          stableConfig,
          { signal },
        );
        if (
          signal.aborted ||
          id !== requestId.current ||
          configKey !== currentConfigKey.current
        )
          return;
        const parsed = ticketSummarySchema.safeParse(result.data);
        if (!parsed.success) throw new Error("Invalid ticket summary response");
        setSummary(parsed.data);
        setSummaryConfigKey(configKey);
      } catch {
        if (!signal.aborted && id === requestId.current) setFailed(true);
      } finally {
        if (!signal.aborted && id === requestId.current) setLoading(false);
      }
    },
    [api, stableConfig, configKey],
  );

  useEffect(() => {
    setProject(stableConfig.project ?? "");
    setStatuses((stableConfig.statuses ?? defaultTicketStatuses).join(", "));
  }, [configKey]);

  useEffect(() => {
    if (!connected) {
      setSuspended(false);
      setSummary(undefined);
      return;
    }
    if (!suspended) {
      const controller = new AbortController();
      controllerRef.current = controller;
      void load(controller.signal);
      return () => controller.abort();
    }
  }, [connected, configKey, reloadKey, suspended, load]);

  useEffect(() => {
    const clear = (suspend: boolean) => {
      requestId.current += 1;
      controllerRef.current?.abort();
      setSummary(undefined);
      setLoading(false);
      setFailed(false);
      setSuspended(suspend);
    };
    const identityChanged = () => clear(true);
    const sessionCleared = () => clear(true);
    const integrationsChanged = () => {
      clear(false);
      setReloadKey((value) => value + 1);
    };
    window.addEventListener("savia:identity-changed", identityChanged);
    window.addEventListener("savia:session-cleared", sessionCleared);
    window.addEventListener(
      "savia:personal-integrations-changed",
      integrationsChanged,
    );
    return () => {
      window.removeEventListener("savia:identity-changed", identityChanged);
      window.removeEventListener("savia:session-cleared", sessionCleared);
      window.removeEventListener(
        "savia:personal-integrations-changed",
        integrationsChanged,
      );
      controllerRef.current?.abort();
      requestId.current += 1;
    };
  }, []);

  function applyConfig() {
    const candidate = {
      ...(project.trim() ? { project: project.trim() } : {}),
      statuses: statuses
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    };
    const parsed = ticketSummaryConfigSchema.safeParse(candidate);
    if (!parsed.success) {
      setConfigError(true);
      return;
    }
    setConfigError(false);
    onConfigChange(parsed.data);
  }

  const grouped = useMemo(() => {
    const groups = new Map<string, TicketSummary["tickets"]>();
    for (const ticket of visibleSummary?.tickets ?? []) {
      groups.set(ticket.status, [...(groups.get(ticket.status) ?? []), ticket]);
    }
    return [...groups.entries()];
  }, [visibleSummary]);

  if (!connected)
    return (
      <section className="ticket-summary-block" aria-label={t("My tickets")}>
        <p>{t("Connect Jira to see your tickets.")}</p>
        <a href="/#/my-integrations?tab=connections">{t("Connect Jira")}</a>
      </section>
    );

  return (
    <section className="ticket-summary-block" aria-label={t("My tickets")}>
      <header className="ticket-summary-header">
        <div>
          <h2>{t("My tickets")}</h2>
          <p className="ticket-summary-description">
            {t("Your tickets are private to this reader's connected account.")}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => setReloadKey((value) => value + 1)}
          disabled={loading || suspended}
        >
          {t("Refresh")}
        </Button>
      </header>
      {!readOnly && (
        <details className="ticket-summary-settings">
          <summary>{t("Configure summary")}</summary>
          <div className="ticket-summary-settings-fields">
            <label>
              {t("Jira project key")}
              <Input
                value={project}
                onChange={(event) => {
                  setProject(event.target.value);
                  setConfigError(false);
                }}
                placeholder={t("Optional project key")}
                aria-invalid={configError}
              />
            </label>
            <label>
              {t("Statuses")}
              <Input
                value={statuses}
                onChange={(event) => {
                  setStatuses(event.target.value);
                  setConfigError(false);
                }}
                aria-describedby={`${id}-status-hint`}
                aria-invalid={configError}
              />
            </label>
            <p id={`${id}-status-hint`}>{t("Comma-separated status names")}</p>
            {configError && (
              <p role="alert">
                {t("Check project key and add at least one status.")}
              </p>
            )}
            <div className="ticket-summary-settings-actions">
              <Button type="button" onClick={applyConfig}>
                {t("Apply")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onConfigChange({})}
              >
                {t("Reset")}
              </Button>
            </div>
          </div>
        </details>
      )}
      <div aria-live="polite" className="ticket-summary-state">
        {loading && <p role="status">{t("Loading tickets")}</p>}
        {failed && <p role="alert">{t("Tickets unavailable")}</p>}
        {!loading &&
          !failed &&
          visibleSummary &&
          visibleSummary.tickets.length === 0 && (
            <p>
              {t(
                visibleSummary.partial
                  ? "No tickets in loaded results"
                  : "No tickets found",
              )}
            </p>
          )}
      </div>
      {visibleSummary && (
        <>
          <ul
            className="ticket-summary-counts"
            aria-label={t("Tickets by status")}
          >
            {grouped.map(([status, tickets]) => (
              <li key={status}>
                <span>{status}</span>
                <span>{tickets.length}</span>
              </li>
            ))}
          </ul>
          <div className="ticket-summary-groups">
            {grouped.map(([status, tickets]) => (
              <section
                key={`${id}-group-${grouped.findIndex(([name]) => name === status)}`}
                aria-labelledby={`${id}-status-${grouped.findIndex(([name]) => name === status)}`}
              >
                <h3
                  id={`${id}-status-${grouped.findIndex(([name]) => name === status)}`}
                >
                  {status} <span>({tickets.length})</span>
                </h3>
                <ul className="ticket-summary-list">
                  {tickets.map((ticket) => (
                    <li key={ticket.url} className="ticket-summary-row">
                      <div className="ticket-summary-ticket-title">
                        {validHref(ticket.url) ? (
                          <a
                            href={ticket.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {ticket.key} · {ticket.title}
                          </a>
                        ) : (
                          <span>
                            {ticket.key} · {ticket.title}
                          </span>
                        )}
                      </div>
                      <div className="ticket-summary-ticket-meta">
                        <span>{ticket.status}</span>
                        <CommentSummary comments={ticket.comments} t={t} />
                      </div>
                      {ticket.comments.latest &&
                        validHref(ticket.comments.latest.url) && (
                          <p className="ticket-summary-comment">
                            <a
                              href={ticket.comments.latest.url}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {ticket.comments.latest.author}
                            </a>
                            <time dateTime={ticket.comments.latest.createdAt}>
                              {dateLabel(
                                ticket.comments.latest.createdAt,
                                locale,
                              )}
                            </time>
                            <span>{excerpt(ticket.comments.latest.body)}</span>
                          </p>
                        )}
                      {!ticket.comments.latest &&
                        ticket.comments.total !== 0 && (
                          <p className="ticket-summary-muted">
                            {ticket.comments.total === null
                              ? t("Comment data unavailable")
                              : t("Latest comment unavailable")}
                          </p>
                        )}
                      {ticket.pullRequests.length > 0 && (
                        <ul className="ticket-summary-prs">
                          {ticket.pullRequests.map((pr) => (
                            <li key={pr.url}>
                              {validHref(pr.url) ? (
                                <a
                                  href={pr.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  {pr.title}
                                </a>
                              ) : (
                                <span>{pr.title}</span>
                              )}
                              {pr.available ? (
                                <span className="ticket-summary-pr-meta">
                                  {t(
                                    pr.state === "open"
                                      ? "Open"
                                      : pr.state === "draft"
                                        ? "Draft"
                                        : pr.state === "closed"
                                          ? "Closed"
                                          : pr.state === "merged"
                                            ? "Merged"
                                            : "Pull request state unavailable",
                                  )}{" "}
                                  ·{" "}
                                  {t(
                                    pr.reviewDecision === "approved"
                                      ? "Approved"
                                      : pr.reviewDecision ===
                                          "changes_requested"
                                        ? "Changes requested"
                                        : pr.reviewDecision ===
                                            "review_required"
                                          ? "Review required"
                                          : "Review status unavailable",
                                  )}{" "}
                                  ·{" "}
                                  {pr.unresolvedThreads === null
                                    ? t("Thread count unavailable")
                                    : `${pr.unresolvedThreads} ${t(pr.unresolvedThreads === 1 ? "unresolved thread" : "unresolved threads")}`}
                                </span>
                              ) : (
                                <span className="ticket-summary-muted">
                                  {t("Pull request details unavailable")}
                                </span>
                              )}
                              <CommentSummary comments={pr.comments} t={t} />
                              {pr.comments.latest &&
                                validHref(pr.comments.latest.url) && (
                                  <p className="ticket-summary-comment">
                                    <a
                                      href={pr.comments.latest.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                    >
                                      {pr.comments.latest.author}
                                    </a>
                                    <time
                                      dateTime={pr.comments.latest.createdAt}
                                    >
                                      {dateLabel(
                                        pr.comments.latest.createdAt,
                                        locale,
                                      )}
                                    </time>
                                    <span>
                                      {excerpt(pr.comments.latest.body)}
                                    </span>
                                  </p>
                                )}
                              {!pr.comments.latest &&
                                pr.comments.total !== 0 && (
                                  <p className="ticket-summary-muted">
                                    {pr.comments.total === null
                                      ? t("Comment data unavailable")
                                      : t("Latest comment unavailable")}
                                  </p>
                                )}
                            </li>
                          ))}
                        </ul>
                      )}
                      {ticket.prLookup !== "complete" && (
                        <p className="ticket-summary-muted">
                          {t(
                            ticket.prLookup === "unavailable"
                              ? "Pull request lookup unavailable"
                              : "Pull request results incomplete",
                          )}
                        </p>
                      )}
                      {ticket.prLookup === "complete" &&
                        ticket.pullRequests.length === 0 && (
                          <p className="ticket-summary-muted">
                            {t("No pull requests found")}
                          </p>
                        )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          <p className="ticket-summary-updated">
            {t("Updated")}:{" "}
            <time dateTime={visibleSummary.updatedAt}>
              {dateLabel(visibleSummary.updatedAt, locale)}
            </time>
          </p>
          {visibleSummary.warnings.map((warning) => (
            <p className="ticket-summary-muted" key={warning}>
              {t(
                warning === "limit_reached"
                  ? "Ticket limit reached"
                  : warning === "jira_partial"
                    ? "Some Jira details are unavailable"
                    : warning === "github_unavailable"
                      ? "GitHub details unavailable"
                      : "Some GitHub details are incomplete",
              )}
            </p>
          ))}
          {visibleSummary.partial && !visibleSummary.warnings.length && (
            <p className="ticket-summary-muted">
              {t("Some ticket details are incomplete")}
            </p>
          )}
        </>
      )}
    </section>
  );
}

function CommentSummary({
  comments,
  t,
}: {
  comments: TicketSummary["tickets"][number]["comments"];
  t: (message: keyof typeof editorMessages) => string;
}) {
  if (comments.total === null)
    return (
      <span className="ticket-summary-muted">
        {t("Comment count unavailable")}
      </span>
    );
  return (
    <span>
      {comments.total === 0
        ? t("No comments")
        : `${comments.total} ${t(comments.total === 1 ? "comment" : "comments")}`}
    </span>
  );
}
