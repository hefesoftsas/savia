import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  readFile,
  readdir,
  stat,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runWithCommandDiagnostics } from "./command-diagnostics.mjs";

const execute = promisify(execFile);

test("command failures preserve output privately without recording command inputs", async () => {
  const root = await mkdtemp(join(tmpdir(), "savia-command-diagnostics-"));
  try {
    const directory = join(root, "operation");
    await assert.rejects(
      runWithCommandDiagnostics({
        execute: (executable, args, options) =>
          execute(executable, args, options),
        executable: process.execPath,
        args: [
          "-e",
          'process.stdout.write("diagnostic stdout"); process.stderr.write("diagnostic stderr"); process.exit(23)',
          "sensitive-argument",
        ],
        options: {
          env: { DIAGNOSTIC_SECRET: "sensitive-env" },
          input: "sensitive-stdin",
        },
        directory,
        operation: "release apply",
        publicError: "Runtime helper failed",
      }),
      (error) => {
        assert.equal(error.message, "Runtime helper failed");
        return true;
      },
    );

    const errorsDirectory = join(directory, "command-errors"),
      files = await readdir(errorsDirectory);
    assert.equal(files.length, 1);
    assert.match(files[0], /^[\da-f-]+\.json$/i);
    const path = join(errorsDirectory, files[0]),
      record = JSON.parse(await readFile(path, "utf8"));
    assert.deepEqual(record, {
      executable: process.execPath.split(/[\\/]/).at(-1),
      operation: "release apply",
      exitcode: 23,
      signal: null,
      stdout: "diagnostic stdout",
      stderr: "diagnostic stderr",
    });
    assert.equal((await stat(errorsDirectory)).mode & 0o777, 0o700);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    const serialized = JSON.stringify(record);
    for (const secret of [
      "sensitive-argument",
      "sensitive-env",
      "sensitive-stdin",
    ])
      assert.equal(serialized.includes(secret), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("successful commands and unset or relative directories do not create diagnostics", async () => {
  const root = await mkdtemp(join(tmpdir(), "savia-command-diagnostics-"));
  try {
    await runWithCommandDiagnostics({
      execute: async () => ({ stdout: "ok", stderr: "" }),
      executable: process.execPath,
      args: [],
      directory: join(root, "success"),
      operation: "read",
      publicError: "generic",
    });
    assert.equal(await readdir(root).then((files) => files.length), 0);

    for (const directory of [undefined, "relative/operation"]) {
      await assert.rejects(
        runWithCommandDiagnostics({
          execute: async () => {
            const error = new Error("private child failure");
            error.stdout = "failure stdout";
            error.stderr = "failure stderr";
            error.code = 2;
            throw error;
          },
          executable: "/some/private/path/tool",
          args: ["sensitive"],
          directory,
          operation: "mutation",
          publicError: "generic failure",
        }),
        { message: "generic failure" },
      );
    }
    const blockedDirectory = join(root, "not-a-directory");
    await writeFile(blockedDirectory, "block");
    await assert.rejects(
      runWithCommandDiagnostics({
        execute: async () => {
          const error = new Error("private child failure");
          error.stdout = "failure stdout";
          error.stderr = "failure stderr";
          error.code = 2;
          throw error;
        },
        executable: "tool",
        args: [],
        directory: blockedDirectory,
        operation: "mutation",
        publicError: "generic failure",
      }),
      { message: "generic failure" },
    );
    assert.deepEqual(await readdir(root), ["not-a-directory"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
