export type IssueLinkProvider = "jira" | "linear";

export type ParsedIssueLink =
  | {
      provider: "jira";
      identifier: string;
      url: string;
      site: string;
    }
  | {
      provider: "linear";
      identifier: string;
      url: string;
      workspace: string;
    };

const ISSUE_KEY = /^[A-Z][A-Z0-9]{0,19}-[1-9][0-9]{0,9}$/;
const WORKSPACE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,119}$/;

/** Parse only canonical Jira Cloud and Linear issue links; never resolves or fetches the URL. */
export function parseIssueLink(value: string): ParsedIssueLink | null {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    value.trim() !== value ||
    value.includes("?") ||
    value.includes("#")
  )
    return null;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  )
    return null;

  const jiraHost =
    /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.atlassian\.net$/.exec(
      url.hostname,
    );
  if (jiraHost) {
    const match = /^\/browse\/([A-Z][A-Z0-9]{0,19}-[1-9][0-9]{0,9})$/.exec(
      url.pathname,
    );
    if (!match) return null;
    return {
      provider: "jira",
      identifier: match[1],
      url: url.toString(),
      site: url.hostname,
    };
  }

  if (url.hostname !== "linear.app") return null;
  const match = /^\/([^/]+)\/issue\/([^/]+)(?:\/([^/]+))?$/.exec(url.pathname);
  if (!match || !WORKSPACE.test(match[1]) || !ISSUE_KEY.test(match[2]))
    return null;
  if (match[3] !== undefined && !SLUG.test(match[3])) return null;

  return {
    provider: "linear",
    identifier: match[2],
    url: url.toString(),
    workspace: match[1],
  };
}
