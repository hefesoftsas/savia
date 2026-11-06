import { randomUUID } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, parse, resolve } from "node:path";

function outputText(value) {
  if (typeof value === "string") return value;
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  return "";
}

function safeOperation(value) {
  return typeof value === "string" &&
    /^[a-z][a-z0-9:-]*(?: [a-z][a-z0-9:-]*)?$/i.test(value)
    ? value
    : "command";
}

const ERROR_CATEGORIES = [
  {
    code: "D1_RESPONSE_TOO_LARGE",
    remediation: "REDUCE_PAGE_SIZE",
    pattern:
      /d1 query result exceeded the maximum response size|query result.{0,80}response size.{0,20}50\s*mb/,
  },
  {
    code: "PULUMI_UPDATE_IN_PROGRESS",
    remediation: "WAIT_FOR_UPDATE",
    pattern:
      /(?:another|concurrent) update (?:is )?(?:currently )?in progress|concurrentupdateerror|update already in progress/,
  },
  {
    code: "PULUMI_STATE_LOCKED",
    remediation: "CHECK_STATE_LOCK",
    pattern:
      /error acquiring (?:the )?state lock|failed to acquire (?:the )?state lock|(?:state|stack).{0,40}\block(?:ed)?\b|\block.{0,40}(?:state|stack)\b/,
  },
  {
    code: "PERMISSION_DENIED",
    remediation: "CHECK_ACCESS",
    pattern:
      /permission denied|access denied|not authorized|unauthorized|insufficient permissions|forbidden|\bhttp\s+403\b|\b403\s+forbidden\b/,
  },
  {
    code: "MISSING_MODULE",
    remediation: "INSTALL_DEPENDENCIES",
    pattern:
      /cannot find (?:module|package)|err_module_not_found|module_not_found/,
  },
  {
    code: "DNS_RESOLUTION_FAILED",
    remediation: "CHECK_DNS",
    pattern: /getaddrinfo\s+(?:enotfound|eai_again)\b/,
  },
  {
    code: "COMMAND_TIMEOUT",
    remediation: "RETRY_OR_ADJUST_TIMEOUT",
    pattern: /timed?\s*out|timeout|etimedout/,
  },
];

const PULUMI_EVENT_MARKERS = [
  "diagnosticEvent",
  "resourcePreEvent",
  "resourceOutputsEvent",
  "summaryEvent",
  "stdoutEvent",
  "policyEvent",
  "cancelEvent",
  "engineEvent",
];
const PULUMI_EVENT_MARKER = new RegExp(
  `"(?:${PULUMI_EVENT_MARKERS.join("|")})"`,
);
const MAX_EVENT_LINE_CHARS = 128 * 1024;
const MAX_EVENT_SCAN_CHARS = 4 * 1024 * 1024;
const MAX_RAW_CLASSIFICATION_CHARS = 128 * 1024;
const MAX_STREAM_DETECTION_CHARS = 16 * 1024;
const MAX_DIAGNOSTIC_CHARS = 8 * 1024;
const MAX_EVENT_LINES = 10_000;

function safeExitCode(error) {
  if (Number.isSafeInteger(error?.code)) return error.code;
  if (Number.isSafeInteger(error?.exitCode)) return error.exitCode;
  return null;
}

function stdoutEvidence(value) {
  const text = outputText(value);
  const prefixEnd = text.indexOf("\n");
  const prefix = text.slice(
    0,
    Math.min(
      prefixEnd < 0 ? text.length : prefixEnd,
      MAX_STREAM_DETECTION_CHARS,
    ),
  );
  const structured =
    prefix.trimStart().startsWith("{") && PULUMI_EVENT_MARKER.test(prefix);
  if (!structured) return text.slice(0, MAX_RAW_CLASSIFICATION_CHARS);

  const messages = [];
  const tailStart = Math.max(0, text.length - MAX_EVENT_SCAN_CHARS);
  let start = tailStart;
  // The tail may begin inside a large resource event. Detect the stream from
  // its prefix, then skip this incomplete line without parsing its payload.
  if (tailStart > 0) {
    const newline = text.indexOf("\n", tailStart);
    if (newline < 0) return "";
    start = newline + 1;
  }
  let lines = 0;
  const scanLimit = text.length;
  while (start <= scanLimit && lines < MAX_EVENT_LINES) {
    const newline = text.indexOf("\n", start);
    const end = newline < 0 || newline > scanLimit ? scanLimit : newline;
    const length = end - start;
    if (length <= MAX_EVENT_LINE_CHARS && length > 0) {
      const line = text.slice(start, end).trim();
      if (line.startsWith("{") && line.includes('"diagnosticEvent"')) {
        try {
          const event = JSON.parse(line);
          const diagnostic = event?.diagnosticEvent;
          if (
            typeof diagnostic?.message === "string" &&
            String(diagnostic.severity).toLowerCase() === "error"
          )
            messages.push(diagnostic.message.slice(0, MAX_DIAGNOSTIC_CHARS));
        } catch {
          // A malformed structured event must not expose resource metadata to
          // the classifier; it will produce a generic command diagnostic.
        }
      }
    }
    if (newline < 0 || newline >= scanLimit) break;
    start = newline + 1;
    lines += 1;
  }
  return messages.join("\n");
}

function classifyFailure(error) {
  const stdout = outputText(error?.stdout);
  const stderr = outputText(error?.stderr);
  const evidence = [
    stdout || stderr
      ? ""
      : typeof error?.message === "string"
        ? error.message
        : "",
    stdoutEvidence(stdout),
    stderr,
  ]
    .join("\n")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
  const propagated = evidence.match(/diagnostic=([a-z0-9_]+)/);
  if (propagated) {
    const category = ERROR_CATEGORIES.find(
      ({ code }) => code.toLowerCase() === propagated[1],
    );
    if (category) return category;
  }
  return (
    ERROR_CATEGORIES.find(({ pattern }) => pattern.test(evidence)) ?? {
      code: "COMMAND_FAILED",
      remediation: "INSPECT_PRIVATE_DIAGNOSTICS",
    }
  );
}

function safePublicLabel(value) {
  if (typeof value === "string" && /^runtime helper failed(?:$|:)/i.test(value))
    return "Runtime helper failed";
  if (
    typeof value === "string" &&
    /^environment command failed(?:$|:)/i.test(value)
  )
    return "Environment command failed";
  return "Command failed";
}

export async function preserveCommandFailure({
  directory,
  executable,
  operation,
  error,
}) {
  if (typeof directory !== "string" || !isAbsolute(directory)) return;
  const operationDirectory = resolve(directory),
    root = parse(operationDirectory).root;
  if (operationDirectory === root) return;
  try {
    const destination = join(operationDirectory, "command-errors"),
      record = {
        executable:
          basename(String(executable)).replace(/[^\w.-]/g, "_") || "command",
        operation: safeOperation(operation),
        exitcode: safeExitCode(error),
        signal: typeof error?.signal === "string" ? error.signal : null,
        stdout: outputText(error?.stdout),
        stderr: outputText(error?.stderr),
      },
      path = join(destination, `${randomUUID()}.json`);
    await mkdir(destination, { recursive: true, mode: 0o700 });
    await chmod(destination, 0o700);
    await writeFile(path, JSON.stringify(record, null, 2), {
      flag: "wx",
      mode: 0o600,
    });
    await chmod(path, 0o600);
  } catch {
    // Diagnostics must never replace the original command failure.
  }
}

export async function runWithCommandDiagnostics({
  execute,
  executable,
  args,
  options,
  directory,
  operation,
  publicError,
}) {
  try {
    return await execute(executable, args, options);
  } catch (error) {
    await preserveCommandFailure({ directory, executable, operation, error });
    const category = classifyFailure(error);
    const exitcode = safeExitCode(error);
    throw new Error(
      `${safePublicLabel(publicError)} (diagnostic=${category.code}; remediation=${category.remediation}; operation=${safeOperation(operation)}; exit=${exitcode ?? "unknown"})`,
    );
  }
}
