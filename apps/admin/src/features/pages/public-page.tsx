import { useEffect, useState, type ReactNode } from "react";
import { useMessages, useAppLocale } from "@/i18n/core";
import { pagesMessages } from "./messages";
import "./public-page.css";

type PublicNode = Record<string, unknown> & {
  children?: PublicNode[];
  text?: string;
};
type PublicPageData = {
  root: { id: string; title: string };
  page: {
    id: string;
    title: string;
    kind: "page" | "folder";
    content: PublicNode[];
    updatedAt: string;
  };
  children: Array<{ id: string; title: string; kind: "page" | "folder" }>;
  breadcrumbs: Array<{ id: string; title: string }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function parsePublicPage(value: unknown): PublicPageData | undefined {
  if (!isRecord(value) || !isRecord(value.data)) return;
  const data = value.data;
  if (
    !isRecord(data.root) ||
    !isRecord(data.page) ||
    !Array.isArray(data.children) ||
    !Array.isArray(data.breadcrumbs)
  )
    return;
  const item = data.page;
  if (
    typeof item.id !== "string" ||
    typeof item.title !== "string" ||
    (item.kind !== "page" && item.kind !== "folder") ||
    !Array.isArray(item.content)
  )
    return;
  if (typeof data.root.id !== "string" || typeof data.root.title !== "string")
    return;
  const summaries = (items: unknown[]) =>
    items.every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.id === "string" &&
        typeof entry.title === "string" &&
        (entry.kind === undefined ||
          entry.kind === "page" ||
          entry.kind === "folder"),
    );
  if (!summaries(data.children) || !summaries(data.breadcrumbs)) return;
  return {
    root: { id: data.root.id, title: data.root.title },
    page: {
      id: item.id,
      title: item.title,
      kind: item.kind,
      content: item.content as PublicNode[],
      updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : "",
    },
    children: data.children as PublicPageData["children"],
    breadcrumbs: data.breadcrumbs as PublicPageData["breadcrumbs"],
  };
}

export function safePublicHref(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  try {
    const url = new URL(value, window.location.origin);
    if (["https:", "http:", "mailto:"].includes(url.protocol)) return url.href;
  } catch {
    /* invalid link */
  }
}

function textContent(nodes: PublicNode[] | undefined): string {
  return (nodes ?? [])
    .map((node) =>
      typeof node.text === "string" ? node.text : textContent(node.children),
    )
    .join("");
}

type RenderContext = {
  token: string;
  pageId: string;
  apiBase: string;
  collectionLabel: string;
  downloadLabel: string;
  detailsLabel: string;
  completedTaskLabel: string;
  openTaskLabel: string;
  ticketSummaryPrivateLabel: string;
};

function PublicAttachment({
  context,
  fileId,
  name,
  mime,
  alt,
}: {
  context: RenderContext;
  fileId: string;
  name: string;
  mime: string;
  alt: string;
}) {
  const t = useMessages(pagesMessages);
  const [asset, setAsset] = useState<{ url: string; mime: string }>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    setAsset(undefined);
    setFailed(false);
    const endpoint = `${context.apiBase}/api/public/pages/${encodeURIComponent(context.token)}/pages/${encodeURIComponent(context.pageId)}/files/${encodeURIComponent(fileId)}`;
    void fetch(endpoint, {
      credentials: "omit",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          if (!controller.signal.aborted) setFailed(true);
          return;
        }
        const actualMime = (response.headers.get("content-type") ?? mime)
          .split(";")[0]
          .toLowerCase();
        if (["text/html", "application/xhtml+xml"].includes(actualMime)) {
          if (!controller.signal.aborted) setFailed(true);
          return;
        }
        objectUrl = URL.createObjectURL(await response.blob());
        if (!controller.signal.aborted)
          setAsset({ url: objectUrl, mime: actualMime });
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      })
      .finally(() => {
        if (controller.signal.aborted && objectUrl)
          URL.revokeObjectURL(objectUrl);
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [context.apiBase, context.pageId, context.token, fileId, mime, attempt]);
  if (!asset)
    return (
      <div
        className="public-page-attachment"
        role={failed ? "alert" : "status"}
      >
        <span>
          {failed ? t("Attachment unavailable") : t("Loading attachment")}
        </span>
        {failed && (
          <button
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
          >
            {t("Retry")}
          </button>
        )}
      </div>
    );
  const safeImageTypes = [
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/avif",
  ];
  if (safeImageTypes.includes(asset.mime))
    return (
      <figure>
        <img src={asset.url} alt={alt} loading="lazy" />
        <figcaption>{name}</figcaption>
      </figure>
    );
  return (
    <p>
      <a href={asset.url} download={name}>
        {name || t("Download attachment")}
      </a>
    </p>
  );
}
function inline(
  nodes: PublicNode[] | undefined,
  context: RenderContext,
  keyPrefix = "inline",
): ReactNode[] {
  return (nodes ?? []).map((node, index) => {
    if (typeof node.text === "string") {
      let result: ReactNode = node.text;
      if (node.code === true)
        result = <code key={`${keyPrefix}-${index}`}>{result}</code>;
      if (node.bold === true)
        result = <strong key={`${keyPrefix}-${index}`}>{result}</strong>;
      if (node.italic === true)
        result = <em key={`${keyPrefix}-${index}`}>{result}</em>;
      if (node.underline === true)
        result = <u key={`${keyPrefix}-${index}`}>{result}</u>;
      if (node.strikethrough === true)
        result = <s key={`${keyPrefix}-${index}`}>{result}</s>;
      const href = safePublicHref(node.url);
      if (href)
        result = (
          <a
            key={`${keyPrefix}-${index}`}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
          >
            {result}
          </a>
        );
      return <span key={`${keyPrefix}-${index}`}>{result}</span>;
    }
    return (
      <span key={`${keyPrefix}-${index}`}>
        {blocks([node], context, keyPrefix)}
      </span>
    );
  });
}

function blocks(
  nodes: PublicNode[],
  context: RenderContext,
  keyPrefix = "block",
): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`;
    const children = inline(node.children, context, key);
    switch (node.type) {
      case "h1":
        return <h2 key={key}>{children}</h2>;
      case "h2":
        return <h3 key={key}>{children}</h3>;
      case "h3":
        return <h4 key={key}>{children}</h4>;
      case "blockquote":
        return <blockquote key={key}>{children}</blockquote>;
      case "ul":
      case "bulleted_list":
        return <ul key={key}>{blocks(node.children ?? [], context, key)}</ul>;
      case "ol":
        return <ol key={key}>{blocks(node.children ?? [], context, key)}</ol>;
      case "li":
      case "list-item":
        return <li key={key}>{children}</li>;
      case "bullet":
        return (
          <p key={key} className="public-page-bullet">
            {children}
          </p>
        );
      case "numbered":
        return (
          <p key={key} className="public-page-numbered">
            {children}
          </p>
        );
      case "callout":
        return (
          <aside key={key} className="public-page-callout">
            {children}
          </aside>
        );
      case "a": {
        const href = safePublicHref(node.url);
        return href ? (
          <a key={key} href={href} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        ) : (
          <span key={key}>{children}</span>
        );
      }
      case "todo":
        return (
          <div key={key} className="public-page-todo">
            <input
              type="checkbox"
              checked={node.checked === true}
              readOnly
              aria-label={
                node.checked === true
                  ? context.completedTaskLabel
                  : context.openTaskLabel
              }
            />
            {children}
          </div>
        );
      case "toggle":
        return (
          <details key={key}>
            <summary>
              {textContent(node.children?.slice(0, 1)) || context.detailsLabel}
            </summary>
            <div>{blocks(node.children?.slice(1) ?? [], context, key)}</div>
          </details>
        );
      case "code_block":
        return (
          <pre key={key}>
            <code>{textContent(node.children)}</code>
          </pre>
        );
      case "divider":
        return <hr key={key} />;
      case "table":
        return (
          <div className="public-page-table-wrap" key={key}>
            <table>
              <tbody>
                {(node.children ?? []).map((row, rowIndex) => (
                  <tr key={`${key}-row-${rowIndex}`}>
                    {(row.children ?? []).map((cell, cellIndex) => (
                      <td key={`${key}-cell-${cellIndex}`}>
                        {blocks(
                          cell.children ?? [],
                          context,
                          `${key}-${rowIndex}-${cellIndex}`,
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case "table_row":
        return (
          <tr key={key}>
            {(node.children ?? []).map((cell, cellIndex) => (
              <td key={`${key}-cell-${cellIndex}`}>
                {blocks(cell.children ?? [], context, `${key}-${cellIndex}`)}
              </td>
            ))}
          </tr>
        );
      case "table_cell":
        return <td key={key}>{blocks(node.children ?? [], context, key)}</td>;
      case "attachment": {
        const fileId = typeof node.fileId === "string" ? node.fileId : "";
        const pageId = context.pageId;
        const name =
          typeof node.name === "string" ? node.name : context.downloadLabel;
        const mime =
          typeof node.mimeType === "string" ? node.mimeType.toLowerCase() : "";
        if (!fileId || !pageId) return <p key={key}>{name}</p>;
        return (
          <PublicAttachment
            key={key}
            context={context}
            fileId={fileId}
            name={name}
            mime={mime}
            alt={typeof node.alt === "string" ? node.alt : name}
          />
        );
      }
      case "issue": {
        const href = safePublicHref(node.url);
        return href ? (
          <p key={key}>
            <a href={href} target="_blank" rel="noopener noreferrer">
              {href}
            </a>
          </p>
        ) : (
          <p key={key}>{String(node.url ?? "")}</p>
        );
      }
      case "collection":
        return (
          <aside key={key} className="public-page-private">
            {context.collectionLabel}
          </aside>
        );
      case "ticket_summary":
        return (
          <aside key={key} className="public-page-private">
            {context.ticketSummaryPrivateLabel}
          </aside>
        );
      case "p":
      case "paragraph":
      case undefined:
        return <p key={key}>{children}</p>;
      default:
        return node.children ? <div key={key}>{children}</div> : null;
    }
  });
}

export function PublicPage({
  token,
  pageId,
}: {
  token: string;
  pageId?: string;
}) {
  const t = useMessages(pagesMessages);
  const locale = useAppLocale();
  const [data, setData] = useState<PublicPageData>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<"invalid" | "load" | "">("");
  const apiBase = (
    import.meta.env.VITE_SAVIA_API_URL ?? window.location.origin
  ).replace(/\/$/, "");
  const endpoint = `${apiBase}/api/public/pages/${encodeURIComponent(token)}${pageId ? `/pages/${encodeURIComponent(pageId)}` : ""}`;
  useEffect(() => {
    const controller = new AbortController();
    setData(undefined);
    setError("");
    setLoading(true);
    void fetch(endpoint, {
      credentials: "omit",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          setError(
            response.status === 404 || response.status === 410
              ? "invalid"
              : "load",
          );
          return;
        }
        const parsed = parsePublicPage(await response.json());
        if (!parsed) {
          setError("load");
          return;
        }
        if (!controller.signal.aborted) setData(parsed);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("load");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [endpoint]);
  return (
    <main className="public-page" lang={locale}>
      <header className="public-page-header">
        <a href={`/public/pages/${encodeURIComponent(token)}`}>
          {data?.root.title ?? "Savia"}
        </a>
      </header>
      {loading ? (
        <p role="status">{t("Loading public page")}</p>
      ) : error ? (
        <section role="alert" className="public-page-error">
          <h1>{t("Public page unavailable")}</h1>
          <p>
            {t(
              error === "invalid"
                ? "Invalid public link"
                : "Public page load failed",
            )}
          </p>
        </section>
      ) : data ? (
        <article className="public-page-document">
          {data.breadcrumbs.filter((crumb) => crumb.id !== data.root.id)
            .length > 0 && (
            <nav
              aria-label={t("Breadcrumbs")}
              className="public-page-breadcrumbs"
            >
              <a href={`/public/pages/${encodeURIComponent(token)}`}>
                {data.root.title}
              </a>
              {data.breadcrumbs
                .filter((crumb) => crumb.id !== data.root.id)
                .map((crumb) => (
                  <span key={crumb.id}>
                    {" "}
                    /{" "}
                    <a
                      href={`/public/pages/${encodeURIComponent(token)}/${encodeURIComponent(crumb.id)}`}
                    >
                      {crumb.title}
                    </a>
                  </span>
                ))}
            </nav>
          )}
          <h1>{data.page.title}</h1>
          {data.page.content.length ? (
            <div className="public-page-content">
              {blocks(data.page.content, {
                token,
                pageId: data.page.id,
                apiBase,
                collectionLabel: t("Private collection"),
                downloadLabel: t("Download attachment"),
                detailsLabel: t("Details"),
                completedTaskLabel: t("Completed task"),
                openTaskLabel: t("Open task"),
                ticketSummaryPrivateLabel: t(
                  "Ticket summary private placeholder",
                ),
              })}
            </div>
          ) : (
            <p className="public-page-muted">{t("No page content")}</p>
          )}
          {data.children.length > 0 && (
            <nav className="public-page-children" aria-label={t("Subpages")}>
              <h2>{t("Inside folder")}</h2>
              <ul>
                {data.children.map((child) => (
                  <li key={child.id}>
                    <a
                      href={`/public/pages/${encodeURIComponent(token)}/${encodeURIComponent(child.id)}`}
                    >
                      {child.title}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          )}
        </article>
      ) : null}
      <footer>{t("Public link")}</footer>
    </main>
  );
}
