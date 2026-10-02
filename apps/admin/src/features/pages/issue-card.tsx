import { useEffect, useState } from "react";
import type { ApiClient } from "@/api/api-client";
import { parseIssueLink } from "@savia/studio-shared/issue-links";
import { useMessages } from "@/i18n/core";
import { pagesMessages } from "./messages";
import { CircleDot, ExternalLink, UserRound } from "lucide-react";
import Jira from "@thesvg/react/jira";
import Linear from "@thesvg/react/linear";

type Preview = {
  title: string;
  identifier: string;
  status: string | null;
  assignee: string | null;
};
export function IssueCard({ url, api }: { url: string; api: ApiClient }) {
  const t = useMessages(pagesMessages);
  const parsed = parseIssueLink(url);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  useEffect(() => {
    const controller = new AbortController();
    setPreview(null);
    setState("loading");
    if (!parsed) {
      setState("failed");
      return;
    }
    void api
      .post<{ data: Preview }>(
        "/v1/personal-integrations/issue-preview",
        { url: parsed.url },
        { signal: controller.signal },
      )
      .then(({ data }) => {
        if (!controller.signal.aborted) {
          setPreview(data);
          setState("ready");
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setState("failed");
      });
    return () => controller.abort();
  }, [api, url]);
  if (!parsed) return <p role="alert">{t("Invalid link")}</p>;
  const ProviderIcon = parsed.provider === "jira" ? Jira : Linear;
  const providerName = parsed.provider === "jira" ? "Jira" : "Linear";
  const initials = preview?.assignee
    ?.trim()
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => Array.from(part)[0])
    .join("")
    .toLocaleUpperCase();
  return (
    <div className="page-issue" aria-busy={state === "loading"}>
      <div className="page-issue-heading">
        <span className="page-issue-provider">
          <ProviderIcon width={20} height={20} aria-hidden="true" />
          <span>{providerName}</span>
          <span className="page-issue-identifier">{parsed.identifier}</span>
        </span>
        <ExternalLink size={15} aria-hidden="true" />
      </div>
      <a
        href={parsed.url}
        target="_blank"
        rel="noopener noreferrer"
        className="page-issue-title"
      >
        {preview?.title ?? parsed.identifier}
      </a>
      {preview && (
        <dl className="page-issue-metadata">
          <div className="page-issue-field">
            <dt>{t("Issue status")}</dt>
            <dd className="page-issue-status">
              <CircleDot size={14} aria-hidden="true" />
              {preview.status || t("Status unavailable")}
            </dd>
          </div>
          <div className="page-issue-field">
            <dt>{t("Assigned to")}</dt>
            <dd className="page-issue-assignee">
              <span className="page-issue-avatar" aria-hidden="true">
                {initials || <UserRound size={13} />}
              </span>
              <span>{preview.assignee || t("Unassigned")}</span>
            </dd>
          </div>
        </dl>
      )}
      {state === "loading" && (
        <p role="status" className="page-issue-notice">
          {t("Loading")}
        </p>
      )}
      {state === "failed" && (
        <p className="page-issue-notice">
          {t("Preview unavailable")}{" "}
          <a className="underline" href="#/my-integrations?tab=connections">
            {t("Connect")}
          </a>
        </p>
      )}
    </div>
  );
}
