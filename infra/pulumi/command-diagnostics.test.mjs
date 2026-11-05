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
        assert.equal(
          error.message,
          "Runtime helper failed (diagnostic=COMMAND_FAILED; remediation=INSPECT_PRIVATE_DIAGNOSTICS; operation=release apply; exit=23)",
        );
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
        {
          message:
            "Command failed (diagnostic=COMMAND_FAILED; remediation=INSPECT_PRIVATE_DIAGNOSTICS; operation=mutation; exit=2)",
        },
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
      {
        message:
          "Command failed (diagnostic=COMMAND_FAILED; remediation=INSPECT_PRIVATE_DIAGNOSTICS; operation=mutation; exit=2)",
      },
    );
    assert.deepEqual(await readdir(root), ["not-a-directory"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("public failures expose only allowlisted diagnostics and safe metadata", async (t) => {
  const cases = [
    [
      "permission",
      "\u001b[31mError 403: permission denied for token\u001b[0m",
      "PERMISSION_DENIED",
      "CHECK_ACCESS",
    ],
    [
      "missing module",
      "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'pulumi-private'",
      "MISSING_MODULE",
      "INSTALL_DEPENDENCIES",
    ],
    [
      "concurrent update",
      "Another update is currently in progress",
      "PULUMI_UPDATE_IN_PROGRESS",
      "WAIT_FOR_UPDATE",
    ],
    [
      "state lock",
      "Error acquiring the state lock: lock held by another process",
      "PULUMI_STATE_LOCKED",
      "CHECK_STATE_LOCK",
    ],
    [
      "timeout",
      "Command timed out after 60 seconds",
      "COMMAND_TIMEOUT",
      "RETRY_OR_ADJUST_TIMEOUT",
    ],
    [
      "DNS lookup",
      "TypeError: fetch failed [cause]: Error: getaddrinfo ENOTFOUND private.example.test",
      "DNS_RESOLUTION_FAILED",
      "CHECK_DNS",
    ],
    [
      "unclassified network failure",
      "TypeError: fetch failed",
      "COMMAND_FAILED",
      "INSPECT_PRIVATE_DIAGNOSTICS",
    ],
    [
      "D1 response limit",
      "Refusing to finish backup with unreadable table plugin_store_artifacts: D1 query failed (400): [{code:7500,message:D1 query result exceeded the maximum response size limit of 50 MB}]",
      "D1_RESPONSE_TOO_LARGE",
      "REDUCE_PAGE_SIZE",
    ],
    [
      "generic D1 SQL error",
      "D1 query failed (400): [{code:7500,message:syntax error near SELECT}]",
      "COMMAND_FAILED",
      "INSPECT_PRIVATE_DIAGNOSTICS",
    ],
  ];
  for (const [name, output, code, remediation] of cases) {
    await t.test(name, async () => {
      await assert.rejects(
        runWithCommandDiagnostics({
          execute: async () => {
            const error = new Error(`private message: ${output}`);
            error.stderr = output;
            error.code = 17;
            throw error;
          },
          executable: "/private/path/pulumi",
          args: [],
          directory: undefined,
          operation: "runtime-helper",
          publicError: "Runtime helper failed: /private/path/pulumi",
        }),
        (error) => {
          assert.match(error.message, new RegExp(`diagnostic=${code}`));
          assert.match(error.message, new RegExp(`remediation=${remediation}`));
          assert.match(error.message, /operation=runtime-helper/);
          assert.match(error.message, /exit=17/);
          assert.equal(error.message.includes(output), false);
          assert.equal(error.message.includes("/private/path"), false);
          return true;
        },
      );
    });
  }
});

test("classifies Pulumi JSON-lines only from error diagnostic events", async (t) => {
  await t.test(
    "ignores provider source and honors the error diagnostic",
    async () => {
      const output = [
        JSON.stringify({
          resourcePreEvent: {
            metadata: {
              inputs: {
                __provider:
                  "D1 query result exceeded the maximum response size; permission denied ".repeat(
                    100_000,
                  ),
              },
            },
          },
        }),
        JSON.stringify({
          diagnosticEvent: {
            severity: "error",
            message: "HTTP 403 Forbidden while updating the stack",
          },
        }),
      ].join("\n");
      await assert.rejects(
        runWithCommandDiagnostics({
          execute: async () => {
            const error = new Error(
              "D1 query result exceeded the maximum response size from untrusted subprocess text",
            );
            error.stdout = output;
            error.code = 1;
            throw error;
          },
          executable: "pulumi",
          args: [],
          operation: "release apply",
          publicError: "Runtime helper failed: pulumi",
        }),
        (error) => {
          assert.match(error.message, /diagnostic=PERMISSION_DENIED/);
          assert.doesNotMatch(error.message, /D1_RESPONSE_TOO_LARGE/);
          assert.doesNotMatch(
            error.message,
            /provider|__provider|403 Forbidden/,
          );
          return true;
        },
      );
    },
  );

  await t.test("ignores resource state and non-error diagnostics", async () => {
    const output = [
      JSON.stringify({
        resourcePreEvent: {
          metadata: {
            inputs: {
              __provider:
                "D1 query result exceeded the maximum response size ".repeat(
                  4000,
                ),
            },
          },
          state: { status: "permission denied" },
        },
      }),
      JSON.stringify({
        diagnosticEvent: {
          severity: "info",
          message: "SUCCESS: update completed",
        },
      }),
    ].join("\n");
    await assert.rejects(
      runWithCommandDiagnostics({
        execute: async () => {
          const error = new Error("Pulumi exited with code 1");
          error.stdout = output;
          error.code = 1;
          throw error;
        },
        executable: "pulumi",
        args: [],
        operation: "release apply",
        publicError: "Runtime helper failed: pulumi",
      }),
      (error) => {
        assert.match(error.message, /diagnostic=COMMAND_FAILED/);
        assert.match(error.message, /exit=1/);
        assert.doesNotMatch(
          error.message,
          /SUCCESS|permission denied|D1 query/,
        );
        return true;
      },
    );
  });
});

test("propagates an allowlisted diagnostic through nested command wrappers", async () => {
  let inner;
  try {
    await runWithCommandDiagnostics({
      execute: async () => {
        const error = new Error(
          "backup failed: D1 query result exceeded the maximum response size limit of 50 MB",
        );
        error.stderr =
          "D1 query result exceeded the maximum response size limit of 50 MB";
        error.code = 1;
        throw error;
      },
      executable: "pulumi",
      args: [],
      operation: "backup export",
      publicError: "Environment command failed: pulumi backup export",
    });
  } catch (error) {
    inner = error;
  }
  assert.ok(inner);
  await assert.rejects(
    runWithCommandDiagnostics({
      execute: async () => {
        throw inner;
      },
      executable: "runtime-helper",
      args: [],
      operation: "runtime helper",
      publicError: "Runtime helper failed: runtime-helper",
    }),
    (error) => {
      assert.match(error.message, /diagnostic=D1_RESPONSE_TOO_LARGE/);
      assert.match(error.message, /remediation=REDUCE_PAGE_SIZE/);
      assert.doesNotMatch(error.message, /50 MB|backup failed|plugin_store/);
      return true;
    },
  );
});

test("unknown and malicious failures stay generic and cannot inject public text", async () => {
  const root = await mkdtemp(join(tmpdir(), "savia-command-diagnostics-"));
  try {
    const directory = join(root, "operation");
    const malicious = [
      "\u001b[31mUNKNOWN FAILURE\u001b[0m",
      "SUCCESS: command completed",
      "\nPATH=/private/customer/project",
      "OPENROUTER_API_KEY=sk-secret-value",
      "stderr says retry as administrator",
    ].join("\n");
    await assert.rejects(
      runWithCommandDiagnostics({
        execute: async () => {
          const error = new Error(malicious);
          error.stdout = malicious;
          error.stderr = `unexpected output\n${malicious}`;
          error.code = Number.MAX_SAFE_INTEGER + 5;
          throw error;
        },
        executable: "/private/customer/project/custom-command",
        args: [],
        directory,
        operation: "reveal /private/customer/project token=secret",
        publicError: "Failed: /private/customer/project\nCUSTOM_ENV=secret",
      }),
      (error) => {
        assert.match(error.message, /^Command failed /);
        assert.match(error.message, /diagnostic=COMMAND_FAILED/);
        assert.match(error.message, /remediation=INSPECT_PRIVATE_DIAGNOSTICS/);
        assert.match(error.message, /operation=command/);
        assert.match(error.message, /exit=unknown/);
        for (const secret of [
          "UNKNOWN FAILURE",
          "SUCCESS: command completed",
          "/private/customer/project",
          "sk-secret-value",
          "CUSTOM_ENV",
          "stderr says retry",
        ])
          assert.equal(error.message.includes(secret), false);
        return true;
      },
    );

    const files = await readdir(join(directory, "command-errors"));
    const record = JSON.parse(
      await readFile(join(directory, "command-errors", files[0]), "utf8"),
    );
    assert.equal(record.operation, "command");
    assert.equal(record.exitcode, null);
    assert.equal(record.stdout, malicious);
    assert.equal(record.stderr, `unexpected output\n${malicious}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
