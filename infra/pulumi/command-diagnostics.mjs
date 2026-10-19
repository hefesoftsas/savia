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
        exitcode: Number.isInteger(error?.code)
          ? error.code
          : Number.isInteger(error?.exitCode)
            ? error.exitCode
            : null,
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
    throw new Error(publicError);
  }
}
