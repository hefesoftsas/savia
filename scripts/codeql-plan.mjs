import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const CODEQL_LANGUAGES = Object.freeze([
  "actions",
  "javascript-typescript",
  "python",
  "rust",
]);

const MAX_PULL_REQUEST_FILE_PAGES = 30;
const PAGE_SIZE = 100;

const JAVASCRIPT_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".vue",
  ".svelte",
  ".html",
]);
const DOCUMENT_OR_IMAGE_EXTENSIONS = new Set([
  ".md",
  ".markdown",
  ".mdx",
  ".rst",
  ".txt",
  ".adoc",
  ".asciidoc",
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".ico",
  ".avif",
  ".bmp",
  ".tif",
  ".tiff",
]);

function basename(path) {
  return path.slice(path.lastIndexOf("/") + 1).toLowerCase();
}

function hasCodeqlControlPath(path) {
  return (
    path === ".github/workflows/codeql.yml" ||
    path === ".github/codeql" ||
    path.startsWith(".github/codeql/") ||
    path.startsWith("scripts/codeql-plan")
  );
}

function languageForPath(path) {
  const languages = new Set();
  if (/^\.github\/workflows\/.+\.ya?ml$/i.test(path)) languages.add("actions");
  if (path.startsWith(".github/actions/")) languages.add("actions");

  const name = basename(path);
  const dot = name.lastIndexOf(".");
  const extension = dot >= 0 ? name.slice(dot) : "";
  if (
    JAVASCRIPT_EXTENSIONS.has(extension) ||
    name === "package.json" ||
    name === "package-lock.json" ||
    name === "npm-shrinkwrap.json" ||
    name === "pnpm-lock.yaml" ||
    name === "yarn.lock"
  )
    languages.add("javascript-typescript");
  if (
    extension === ".py" ||
    extension === ".pyi" ||
    name.startsWith("requirements") ||
    name === "pyproject.toml" ||
    name === "pipfile" ||
    name === "pipfile.lock" ||
    name === "poetry.lock" ||
    name === "uv.lock"
  )
    languages.add("python");
  if (
    extension === ".rs" ||
    name === "cargo.toml" ||
    name === "cargo.lock" ||
    name === "rust-toolchain" ||
    name === "rust-toolchain.toml"
  )
    languages.add("rust");
  return languages;
}

/** Choose the CodeQL languages affected by a set of changed paths. */
export function selectCodeqlLanguages(paths) {
  if (!Array.isArray(paths)) return [...CODEQL_LANGUAGES];
  const selected = new Set();
  let hasUnknown = false;

  for (const input of paths) {
    if (typeof input !== "string" || !input.trim()) {
      hasUnknown = true;
      continue;
    }
    const path = input.replaceAll("\\", "/").replace(/^\.\//, "");
    if (hasCodeqlControlPath(path)) return [...CODEQL_LANGUAGES];
    const languages = languageForPath(path);
    if (languages.size) {
      for (const language of languages) selected.add(language);
      continue;
    }
    if (
      DOCUMENT_OR_IMAGE_EXTENSIONS.has(
        path.slice(path.lastIndexOf(".")).toLowerCase(),
      )
    )
      continue;
    hasUnknown = true;
  }

  return hasUnknown
    ? [...CODEQL_LANGUAGES]
    : CODEQL_LANGUAGES.filter((language) => selected.has(language));
}

function assertRepository(repository) {
  if (
    typeof repository !== "string" ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)
  )
    throw new Error("GITHUB_REPOSITORY must be an owner/repository name.");
}

async function githubGet({ url, token, fetchImpl }) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28",
      },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error(
      "GitHub API request failed while reading pull request state.",
    );
  }
  if (!response.ok)
    throw new Error(
      `GitHub API request failed while reading pull request state (HTTP ${response.status}).`,
    );
  try {
    return await response.json();
  } catch {
    throw new Error("GitHub API returned invalid pull request state.");
  }
}

function pullRequestUrl(repository, number) {
  return new URL(`https://api.github.com/repos/${repository}/pulls/${number}`);
}

function assertPullRequestRevision(live, baseSha, headSha) {
  if (live?.base?.sha !== baseSha || live?.head?.sha !== headSha)
    throw new Error(
      "Pull request changed while CodeQL files were being selected.",
    );
}

async function listPullRequestFiles({ repository, token, number, fetchImpl }) {
  const paths = [];
  for (let page = 1; page <= MAX_PULL_REQUEST_FILE_PAGES; page += 1) {
    const url = new URL(
      `https://api.github.com/repos/${repository}/pulls/${number}/files`,
    );
    url.searchParams.set("per_page", String(PAGE_SIZE));
    url.searchParams.set("page", String(page));
    const files = await githubGet({ url, token, fetchImpl });
    if (!Array.isArray(files))
      throw new Error(
        "GitHub API returned an invalid pull request file listing.",
      );
    for (const file of files) {
      if (
        typeof file?.filename !== "string" ||
        !file.filename ||
        ("previous_filename" in file &&
          (typeof file.previous_filename !== "string" ||
            !file.previous_filename))
      )
        throw new Error(
          "GitHub API returned an invalid pull request file entry.",
        );
      paths.push(file.filename);
      if ("previous_filename" in file) paths.push(file.previous_filename);
    }
    if (files.length < PAGE_SIZE) return paths;
  }
  throw new Error(
    `Pull request file listing exceeds the supported limit of ${MAX_PULL_REQUEST_FILE_PAGES * PAGE_SIZE} files.`,
  );
}

/** Resolve selected languages for supported GitHub event payloads. */
export async function resolveCodeqlPlan({
  env = process.env,
  event,
  fetchImpl = fetch,
} = {}) {
  if (env.GITHUB_EVENT_NAME === "workflow_dispatch") {
    const requested = event?.inputs?.language || "all";
    if (requested === "all")
      return { languages: [...CODEQL_LANGUAGES], shouldScan: true };
    if (!CODEQL_LANGUAGES.includes(requested))
      throw new Error("Unsupported manual language selection.");
    return { languages: [requested], shouldScan: true };
  }

  if (env.GITHUB_EVENT_NAME !== "pull_request")
    throw new Error(
      `Unsupported GitHub event: ${env.GITHUB_EVENT_NAME || "(missing)"}.`,
    );

  const repository = env.GITHUB_REPOSITORY;
  const token = env.GITHUB_TOKEN;
  assertRepository(repository);
  if (!token)
    throw new Error("GITHUB_TOKEN is required to list pull request files.");
  const number = event?.pull_request?.number;
  if (!Number.isSafeInteger(number) || number < 1)
    throw new Error("The event must include a valid pull request number.");
  if (event?.pull_request?.base?.repo?.full_name !== repository)
    throw new Error(
      "The pull request base repository does not match GITHUB_REPOSITORY.",
    );
  const baseSha = event?.pull_request?.base?.sha;
  const headSha = event?.pull_request?.head?.sha;
  if (
    typeof baseSha !== "string" ||
    !/^[0-9a-f]{40}$/i.test(baseSha) ||
    typeof headSha !== "string" ||
    !/^[0-9a-f]{40}$/i.test(headSha)
  )
    throw new Error(
      "The event must include valid pull request base and head revisions.",
    );

  assertPullRequestRevision(
    await githubGet({
      url: pullRequestUrl(repository, number),
      token,
      fetchImpl,
    }),
    baseSha,
    headSha,
  );

  const paths = await listPullRequestFiles({
    repository,
    token,
    number,
    fetchImpl,
  });
  assertPullRequestRevision(
    await githubGet({
      url: pullRequestUrl(repository, number),
      token,
      fetchImpl,
    }),
    baseSha,
    headSha,
  );
  const languages = selectCodeqlLanguages(paths);
  return { languages, shouldScan: languages.length > 0 };
}

export async function runCodeqlPlan(env = process.env) {
  const eventPath = env.GITHUB_EVENT_PATH;
  const outputPath = env.GITHUB_OUTPUT;
  if (!eventPath) throw new Error("GITHUB_EVENT_PATH is required.");
  if (!outputPath) throw new Error("GITHUB_OUTPUT is required.");

  let event;
  try {
    event = JSON.parse(readFileSync(eventPath, "utf8"));
  } catch {
    throw new Error("The GitHub event payload is unavailable or invalid.");
  }
  const plan = await resolveCodeqlPlan({ env, event });
  appendFileSync(
    outputPath,
    `languages=${JSON.stringify(plan.languages)}\nshould_scan=${plan.shouldScan}\n`,
    "utf8",
  );
  return plan;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runCodeqlPlan().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "CodeQL selection failed."}\n`,
    );
    process.exitCode = 1;
  });
}
