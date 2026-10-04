import {
  defaultTicketStatuses,
  type TicketPullRequest,
  type TicketSummary,
  type TicketSummaryComment,
  type TicketSummaryConfig,
} from "@savia/studio-shared/ticket-summary";
import { parseIssueLink } from "@savia/studio-shared/issue-links";
import type {
  ActivePersonalIntegrationConnection,
  PersonalIntegrationNangoClient,
} from "./contracts";
import {
  PersonalIntegrationAccessError,
  PersonalIntegrationUpstreamError,
} from "./contracts";

const jiraSiteLimit = 3;
const jiraPageSize = 30;
const ticketLimit = 30;
const githubPullRequestLimit = 15;
const commentTextLimit = 500;
const jiraApiHeaders = { accept: "application/json" } as const;

type JiraIssue = {
  key: string;
  cloudId: string;
  title: string;
  url: string;
  status: string;
  updatedAt: string;
  comments: { total: number | null; latest: TicketSummaryComment | null };
  pullRequests: TicketPullRequest[];
  prLookup: "complete" | "partial" | "unavailable";
};

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown, limit = 2000): string | undefined {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, limit)
    : undefined;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function jiraResources(value: unknown): {
  sites: Array<{ id: string; host: string }>;
  clipped: boolean;
} {
  if (!Array.isArray(value)) return { sites: [], clipped: false };
  const resources: Array<{ id: string; host: string }> = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const resource = object(entry);
    if (typeof resource?.id !== "string" || typeof resource.url !== "string")
      continue;
    try {
      const url = new URL(resource.url);
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.port ||
        !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.atlassian\.net$/i.test(
          url.hostname,
        ) ||
        seen.has(resource.id)
      )
        continue;
      seen.add(resource.id);
      resources.push({ id: resource.id, host: url.hostname.toLowerCase() });
      if (resources.length > jiraSiteLimit) break;
    } catch {
      // Ignore malformed Jira site metadata rather than building a proxy URL.
    }
  }
  return {
    sites: resources.slice(0, jiraSiteLimit),
    clipped: resources.length > jiraSiteLimit,
  };
}

function richText(value: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 12 || out.length > 1000) return out;
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) {
    for (const child of value) richText(child, out, depth + 1);
  } else {
    const record = object(value);
    if (!record) return out;
    for (const [key, child] of Object.entries(record)) {
      if (["text", "url", "href"].includes(key) && typeof child === "string")
        out.push(child);
      else if (child && typeof child === "object")
        richText(child, out, depth + 1);
    }
  }
  return out;
}

function latestJiraComment(
  fields: Record<string, unknown>,
  ticketUrl: string,
): { total: number | null; latest: TicketSummaryComment | null } {
  const comments = object(fields.comment);
  const entries = Array.isArray(comments?.comments) ? comments.comments : [];
  const latest = entries
    .map((value) => object(value))
    .filter((value): value is Record<string, unknown> => Boolean(value))
    .map((comment) => ({
      author:
        text(object(comment.author)?.displayName, 255) ??
        text(object(comment.author)?.emailAddress, 255) ??
        "Unknown",
      body: richText(comment.body)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, commentTextLimit),
      createdAt: text(comment.created, 100) ?? "",
    }))
    .filter(
      (comment) =>
        comment.createdAt && Number.isFinite(Date.parse(comment.createdAt)),
    )
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  return {
    total: number(comments?.total),
    latest: latest
      ? { ...latest, body: latest.body || "(No text)", url: ticketUrl }
      : null,
  };
}

function jiraIssue(
  value: unknown,
  host: string,
  cloudId: string,
): JiraIssue | undefined {
  const issue = object(value);
  const fields = object(issue?.fields);
  const key = text(issue?.key, 64);
  const title = text(fields?.summary, 2000);
  const status = text(object(fields?.status)?.name, 255);
  const updatedAt = text(fields?.updated, 100);
  if (
    !key ||
    !/^[A-Z][A-Z0-9]{0,19}-[1-9][0-9]{0,9}$/.test(key) ||
    !title ||
    !status ||
    !updatedAt ||
    !Number.isFinite(Date.parse(updatedAt))
  )
    return undefined;
  const url = `https://${host}/browse/${key}`;
  const extracted = [
    fields?.description,
    ...richText(object(fields?.comment)?.comments),
  ]
    .flatMap((part) => richText(part))
    .join(" ");
  const links = [...extracted.matchAll(/https:\/\/[^\s<>"')\]}]+/g)]
    .map((match) => parseIssueLink(match[0].replace(/[.,;]+$/, "")))
    .filter(
      (link) => link?.provider === "github" && link.kind === "pull_request",
    )
    .map((link) => link!.url);
  return {
    key,
    cloudId,
    title,
    url,
    status,
    updatedAt,
    comments: latestJiraComment(fields!, url),
    pullRequests: [...new Set(links)].map((prUrl) => ({
      url: prUrl,
      title: "Pull request",
      state: "unknown",
      reviewDecision: "unknown",
      comments: { total: null, latest: null },
      unresolvedThreads: null,
      available: false,
    })),
    prLookup: "unavailable",
  };
}

async function jsonResponse(response: Response): Promise<unknown> {
  return response.json().catch(() => undefined);
}

async function jiraSiteIssues(
  nango: PersonalIntegrationNangoClient,
  jira: ActivePersonalIntegrationConnection,
  site: { id: string; host: string },
  config: TicketSummaryConfig,
): Promise<{ issues: JiraIssue[]; partial: boolean }> {
  const base = `/ex/jira/${encodeURIComponent(site.id)}/rest/api/3`;
  const statusResponse = await nango.proxy({
    method: "GET",
    path: `${base}/status`,
    connection: jira,
    upstreamHeaders: jiraApiHeaders,
  });
  if (statusResponse.status === 401 || statusResponse.status === 403)
    throw new PersonalIntegrationAccessError();
  if (!statusResponse.ok) throw new PersonalIntegrationUpstreamError();
  const statusList = await jsonResponse(statusResponse);
  if (!Array.isArray(statusList)) throw new PersonalIntegrationUpstreamError();
  const wanted = (config.statuses ?? defaultTicketStatuses).map((name) =>
    name.trim().toLocaleLowerCase(),
  );
  const ids = statusList.flatMap((value) => {
    const status = object(value);
    return typeof status?.id === "string" &&
      typeof status.name === "string" &&
      wanted.includes(status.name.trim().toLocaleLowerCase()) &&
      /^\d{1,20}$/.test(status.id)
      ? [status.id]
      : [];
  });
  if (ids.length === 0) return { issues: [], partial: false };
  const clauses = [
    "assignee = currentUser()",
    `status in (${[...new Set(ids)].join(", ")})`,
  ];
  if (config.project) clauses.push(`project = ${config.project}`);
  const jql = `${clauses.join(" AND ")} ORDER BY updated DESC`;
  const response = await nango.proxy({
    method: "POST",
    path: `${base}/search/jql`,
    connection: jira,
    body: {
      jql,
      maxResults: jiraPageSize,
      fields: ["summary", "status", "updated", "description", "comment"],
    },
    upstreamHeaders: jiraApiHeaders,
  });
  if (response.status === 401 || response.status === 403)
    throw new PersonalIntegrationAccessError();
  if (!response.ok) throw new PersonalIntegrationUpstreamError();
  const payload = object(await jsonResponse(response));
  if (!payload || !Array.isArray(payload.issues))
    throw new PersonalIntegrationUpstreamError();
  const issues = payload.issues
    .map((value) => jiraIssue(value, site.host, site.id))
    .filter((value): value is JiraIssue => Boolean(value));
  return {
    issues,
    partial:
      issues.length !== payload.issues.length ||
      payload.isLast !== true ||
      (typeof payload.nextPageToken === "string" &&
        payload.nextPageToken.length > 0),
  };
}

async function jiraLatestComment(
  nango: PersonalIntegrationNangoClient,
  jira: ActivePersonalIntegrationConnection,
  issue: JiraIssue,
): Promise<{ total: number | null; latest: TicketSummaryComment | null }> {
  const response = await nango.proxy({
    method: "GET",
    path: `/ex/jira/${encodeURIComponent(issue.cloudId)}/rest/api/3/issue/${encodeURIComponent(issue.key)}/comment?orderBy=-created&maxResults=1`,
    connection: jira,
    upstreamHeaders: jiraApiHeaders,
  });
  if (response.status === 401 || response.status === 403)
    throw new PersonalIntegrationAccessError();
  if (!response.ok) throw new PersonalIntegrationUpstreamError();
  const payload = object(await jsonResponse(response));
  if (!payload || !Array.isArray(payload.comments))
    throw new Error("Latest Jira comment response was invalid");
  const value = object(payload.comments[0]);
  if (!value) return { total: number(payload.total), latest: null };
  const createdAt = text(value.created, 100);
  if (!createdAt || !Number.isFinite(Date.parse(createdAt)))
    return { total: number(payload.total), latest: null };
  return {
    total: number(payload.total),
    latest: {
      author:
        text(object(value.author)?.displayName, 255) ??
        text(object(value.author)?.emailAddress, 255) ??
        "Unknown",
      body:
        richText(value.body)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, commentTextLimit) || "(No text)",
      createdAt,
      url: /^\d{1,20}$/.test(text(value.id, 20) ?? "")
        ? `${issue.url}#comment-${value.id}`
        : issue.url,
    },
  };
}

function githubQuery(issues: JiraIssue[]): string | undefined {
  const aliases: string[] = [];
  for (const [index, issue] of issues.entries()) {
    const search = `is:pr in:title,body \"${issue.key}\"`;
    aliases.push(
      `t${index}: search(query: ${JSON.stringify(search)}, type: ISSUE, first: 5) { pageInfo { hasNextPage } nodes { ... on PullRequest { url title body } } }`,
    );
  }
  return aliases.length ? `query { ${aliases.join(" ")} }` : undefined;
}

const pullRequestFields = `url title state isDraft merged reviewDecision comments(last: 1) { totalCount nodes { author { login } body createdAt url } } reviews(last: 1) { nodes { author { login } body submittedAt url } } reviewThreads(first: 20) { totalCount pageInfo { hasNextPage } nodes { isResolved comments(last: 1) { totalCount nodes { author { login } body createdAt url } } } }`;

function pullRequestDetailsQuery(
  urls: string[],
): { query: string; urls: string[] } | undefined {
  const safeUrls = [...new Set(urls)]
    .filter((url) => {
      const parsed = parseIssueLink(url);
      return parsed?.provider === "github" && parsed.kind === "pull_request";
    })
    .slice(0, githubPullRequestLimit);
  if (!safeUrls.length) return undefined;
  const aliases = safeUrls.flatMap((url, index) => {
    const parsed = parseIssueLink(url);
    if (
      !parsed ||
      parsed.provider !== "github" ||
      parsed.kind !== "pull_request"
    )
      return [];
    return [
      `p${index}: repository(owner: ${JSON.stringify(parsed.owner)}, name: ${JSON.stringify(parsed.repository)}) { pullRequest(number: ${Number(parsed.number)}) { ${pullRequestFields} } }`,
    ];
  });
  return { query: `query { ${aliases.join(" ")} }`, urls: safeUrls };
}

function safeGitHubComment(value: unknown): TicketSummaryComment | null {
  const comment = object(value);
  const link = text(comment?.url, 2048);
  const author = text(object(comment?.author)?.login, 255);
  const body = text(comment?.body, commentTextLimit);
  const createdAt = text(comment?.createdAt ?? comment?.submittedAt, 100);
  let safeLink = false;
  try {
    const url = new URL(link ?? "");
    safeLink =
      url.protocol === "https:" &&
      url.hostname === "github.com" &&
      !url.port &&
      !url.username &&
      !url.password;
  } catch {
    safeLink = false;
  }
  if (
    !link ||
    !safeLink ||
    !author ||
    !body ||
    !createdAt ||
    !Number.isFinite(Date.parse(createdAt))
  )
    return null;
  return { author, body, createdAt, url: link };
}

function normalizePullRequest(value: unknown): TicketPullRequest | undefined {
  const pr = object(value);
  const parsed = typeof pr?.url === "string" ? parseIssueLink(pr.url) : null;
  if (parsed?.provider !== "github" || parsed.kind !== "pull_request")
    return undefined;
  const state: TicketPullRequest["state"] =
    pr?.merged === true
      ? "merged"
      : pr?.isDraft === true
        ? "draft"
        : pr?.state === "OPEN"
          ? "open"
          : pr?.state === "CLOSED"
            ? "closed"
            : "unknown";
  const reviewDecision: TicketPullRequest["reviewDecision"] =
    pr?.reviewDecision === "APPROVED"
      ? "approved"
      : pr?.reviewDecision === "CHANGES_REQUESTED"
        ? "changes_requested"
        : pr?.reviewDecision === "REVIEW_REQUIRED"
          ? "review_required"
          : "unknown";
  const commentsValue = object(pr?.comments);
  const threads = object(pr?.reviewThreads);
  const threadNodes = Array.isArray(threads?.nodes) ? threads.nodes : [];
  const threadComments = threadNodes.flatMap((thread) => {
    const comments = object(object(thread)?.comments);
    return Array.isArray(comments?.nodes) ? comments.nodes : [];
  });
  const reviews = object(pr?.reviews);
  const reviewNodes = Array.isArray(reviews?.nodes) ? reviews.nodes : [];
  const discussion = [
    ...(Array.isArray(commentsValue?.nodes) ? commentsValue.nodes : []),
    ...threadComments,
    ...reviewNodes,
  ]
    .map(safeGitHubComment)
    .filter((comment): comment is TicketSummaryComment => Boolean(comment));
  const pageInfo = object(threads?.pageInfo);
  const threadsComplete =
    pageInfo?.hasNextPage === false &&
    number(threads?.totalCount) !== null &&
    number(threads?.totalCount) === threadNodes.length &&
    threadNodes.every(
      (thread) => typeof object(thread)?.isResolved === "boolean",
    );
  const threadCommentCount = threadNodes.reduce(
    (total, thread) =>
      total + (number(object(object(thread)?.comments)?.totalCount) ?? 0),
    0,
  );
  const threadCommentsComplete =
    threadsComplete &&
    threadNodes.every((thread) => {
      const comments = object(object(thread)?.comments);
      const total = number(comments?.totalCount);
      const nodes = Array.isArray(comments?.nodes) ? comments.nodes : [];
      return (
        total !== null &&
        (total === 0 ? nodes.length === 0 : nodes.length === 1)
      );
    });
  const latest = threadCommentsComplete
    ? (discussion.sort(
        (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
      )[0] ?? null)
    : null;
  return {
    url: parsed.url,
    title: text(pr?.title, 2000) ?? "Pull request",
    state,
    reviewDecision,
    comments: {
      total:
        number(commentsValue?.totalCount) === null ||
        !threadCommentsComplete ||
        reviewNodes.some((review) =>
          Boolean(text(object(review)?.body, commentTextLimit)),
        )
          ? null
          : number(commentsValue?.totalCount)! + threadCommentCount,
      latest,
    },
    unresolvedThreads: !threadsComplete
      ? null
      : threadNodes.filter((thread) => object(thread)?.isResolved === false)
          .length,
    available: true,
  };
}

export async function fetchTicketSummary(
  nango: PersonalIntegrationNangoClient,
  jira: ActivePersonalIntegrationConnection,
  github: ActivePersonalIntegrationConnection | null,
  config: TicketSummaryConfig,
): Promise<TicketSummary> {
  const warnings = new Set<TicketSummary["warnings"][number]>();
  const resourceResponse = await nango.proxy({
    method: "GET",
    path: "/oauth/token/accessible-resources",
    connection: jira,
    upstreamHeaders: jiraApiHeaders,
  });
  if (resourceResponse.status === 401 || resourceResponse.status === 403)
    throw new PersonalIntegrationAccessError();
  if (!resourceResponse.ok) throw new PersonalIntegrationUpstreamError();
  const resourceResult = jiraResources(await jsonResponse(resourceResponse));
  const sites = resourceResult.sites;
  if (!sites.length) throw new PersonalIntegrationUpstreamError();
  if (resourceResult.clipped) warnings.add("limit_reached");
  const siteResults = await Promise.all(
    sites.map(async (site) => {
      try {
        return {
          ...(await jiraSiteIssues(nango, jira, site, config)),
          succeeded: true,
        };
      } catch (error) {
        return {
          issues: [],
          partial: true,
          succeeded: false,
          accessFailure: error instanceof PersonalIntegrationAccessError,
        };
      }
    }),
  );
  if (!siteResults.some((result) => result.succeeded)) {
    if (siteResults.some((result) => result.accessFailure))
      throw new PersonalIntegrationAccessError();
    throw new PersonalIntegrationUpstreamError();
  }
  if (siteResults.some((result) => result.partial))
    warnings.add("jira_partial");
  const sorted = siteResults
    .flatMap((result) => result.issues)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  if (sorted.length > ticketLimit) warnings.add("limit_reached");
  const issues = sorted.slice(0, ticketLimit);
  await Promise.all(
    issues.map(async (issue) => {
      try {
        issue.comments = await jiraLatestComment(nango, jira, issue);
      } catch {
        warnings.add("jira_partial");
        issue.comments = { total: issue.comments.total, latest: null };
      }
    }),
  );
  if (!github) {
    if (issues.length) warnings.add("github_unavailable");
    for (const issue of issues) issue.prLookup = "unavailable";
  } else {
    const query = githubQuery(issues);
    const candidates = new Map<string, Set<number>>();
    const addCandidate = (url: string, ticketIndex: number) => {
      const parsed = parseIssueLink(url);
      if (parsed?.provider !== "github" || parsed.kind !== "pull_request")
        return;
      const indexes = candidates.get(parsed.url) ?? new Set<number>();
      indexes.add(ticketIndex);
      candidates.set(parsed.url, indexes);
    };
    for (const [index, issue] of issues.entries())
      for (const pr of issue.pullRequests) addCandidate(pr.url, index);
    let searchesSucceeded = false;
    if (query) {
      const response = await nango
        .proxy({
          method: "POST",
          path: "/graphql",
          connection: github,
          body: { query },
          upstreamHeaders: { accept: "application/json" },
        })
        .catch(() => undefined);
      if (!response?.ok) {
        warnings.add("github_unavailable");
        for (const issue of issues) issue.prLookup = "partial";
      } else {
        const payload = object(await jsonResponse(response));
        const data = object(payload?.data);
        if (!data || payload?.errors) warnings.add("github_partial");
        searchesSucceeded = Boolean(data);
        for (const [index, issue] of issues.entries()) {
          const result = object(data?.[`t${index}`]);
          const nodes = Array.isArray(result?.nodes) ? result.nodes : [];
          for (const node of nodes) {
            const url = text(object(node)?.url, 2048);
            if (!url) continue;
            const body = `${text(object(node)?.title, 2000) ?? ""} ${text(object(node)?.body, 20_000) ?? ""}`;
            const keyMatch = new RegExp(
              `(^|[^A-Z0-9])${issue.key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Z0-9]|$)`,
              "i",
            ).test(body);
            if (keyMatch) addCandidate(url, index);
          }
          const pageInfo = object(result?.pageInfo);
          const searchComplete =
            Array.isArray(result?.nodes) && pageInfo?.hasNextPage === false;
          issue.prLookup = searchComplete ? "complete" : "partial";
          if (!searchComplete) warnings.add("github_partial");
          if (pageInfo?.hasNextPage === true) warnings.add("limit_reached");
        }
      }
    }
    if (issues.length && !searchesSucceeded) {
      for (const issue of issues) issue.prLookup = "partial";
    }
    const allCandidateUrls = [...candidates.keys()];
    const urls = allCandidateUrls.slice(0, githubPullRequestLimit);
    if (allCandidateUrls.length > urls.length) {
      warnings.add("limit_reached");
      for (const url of allCandidateUrls.slice(githubPullRequestLimit)) {
        for (const ticketIndex of candidates.get(url) ?? []) {
          const issue = issues[ticketIndex]!;
          issue.prLookup = "partial";
          if (!issue.pullRequests.some((pr) => pr.url === url))
            issue.pullRequests.push({
              url,
              title: "Pull request",
              state: "unknown",
              reviewDecision: "unknown",
              comments: { total: null, latest: null },
              unresolvedThreads: null,
              available: false,
            });
        }
      }
    }
    const detailsQuery = pullRequestDetailsQuery(urls);
    if (detailsQuery) {
      const detailsResponse = await nango
        .proxy({
          method: "POST",
          path: "/graphql",
          connection: github,
          body: { query: detailsQuery.query },
          upstreamHeaders: { accept: "application/json" },
        })
        .catch(() => undefined);
      if (!detailsResponse?.ok) warnings.add("github_unavailable");
      else {
        const detailPayload = object(await jsonResponse(detailsResponse));
        const detailData = object(detailPayload?.data);
        if (!detailData || detailPayload?.errors)
          warnings.add("github_partial");
        for (const [prIndex, url] of detailsQuery.urls.entries()) {
          const result = object(detailData?.[`p${prIndex}`]);
          const pr = normalizePullRequest(result?.pullRequest);
          if (!pr || pr.url !== url) {
            warnings.add("github_partial");
            for (const ticketIndex of candidates.get(url) ?? [])
              issues[ticketIndex]!.prLookup = "partial";
            continue;
          }
          if (pr.unresolvedThreads === null) warnings.add("github_partial");
          for (const ticketIndex of candidates.get(url) ?? []) {
            const issue = issues[ticketIndex]!;
            issue.pullRequests = [
              ...new Map(
                [...issue.pullRequests, pr].map((item) => [item.url, item]),
              ).values(),
            ];
          }
        }
      }
    }
    for (const url of urls) {
      const parsed = parseIssueLink(url);
      const loaded = issues.some((issue) =>
        issue.pullRequests.some((pr) => pr.url === url && pr.available),
      );
      if (!loaded) {
        for (const ticketIndex of candidates.get(url) ?? []) {
          const issue = issues[ticketIndex]!;
          if (
            !issue.pullRequests.some((pr) => pr.url === url) &&
            parsed?.provider === "github"
          )
            issue.pullRequests.push({
              url,
              title: "Pull request",
              state: "unknown",
              reviewDecision: "unknown",
              comments: { total: null, latest: null },
              unresolvedThreads: null,
              available: false,
            });
          issue.prLookup = "partial";
        }
      }
    }
  }
  const result: TicketSummary = {
    updatedAt: new Date().toISOString(),
    tickets: issues.map(
      ({ updatedAt: _updatedAt, cloudId: _cloudId, ...issue }) => issue,
    ),
    partial: warnings.size > 0,
    warnings: [...warnings],
  };
  return result;
}
