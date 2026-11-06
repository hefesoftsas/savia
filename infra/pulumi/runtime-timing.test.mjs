import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatRuntimeTimingSummary,
  readRuntimeTimings,
  recordRuntimeTiming,
} from "./runtime-timing.mjs";

test("runtime timings persist only allowlisted labels, duration, and outcome", async () => {
  const directory = await mkdtemp(join(tmpdir(), "savia-runtime-timing-"));
  try {
    await recordRuntimeTiming(directory, "phase:backup", 12.8, "success");
    await recordRuntimeTiming(directory, "backup:flows", 8, "failure");
    const files = await readdir(directory);
    assert.equal(files.length, 1);
    const content = await readFile(join(directory, files[0]), "utf8");
    assert.deepEqual(
      content
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line)),
      [
        { label: "phase:backup", durationMs: 13, outcome: "success" },
        { label: "backup:flows", durationMs: 8, outcome: "failure" },
      ],
    );
    assert.doesNotMatch(content, /sentinel|args|env|error|output/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("runtime timing writer rejects label injection and omits unsafe rows", async () => {
  const directory = await mkdtemp(join(tmpdir(), "savia-runtime-timing-"));
  try {
    await assert.rejects(
      recordRuntimeTiming(
        directory,
        "phase:backup\n::error::sentinel",
        4,
        "success",
      ),
      /label/i,
    );
    await assert.rejects(
      recordRuntimeTiming(directory, "phase:backup", -1, "success"),
      /duration/i,
    );
    assert.deepEqual(await readdir(directory), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("timing write failures are best effort and do not throw into release operations", async () => {
  const directory = await mkdtemp(join(tmpdir(), "savia-runtime-timing-"));
  try {
    const blocker = join(directory, "not-a-directory");
    await writeFile(blocker, "blocker");
    assert.equal(
      await recordRuntimeTiming(blocker, "phase:deploy", 3, "success"),
      false,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("timing summary filters malformed and forged rows before rendering", async () => {
  const directory = await mkdtemp(join(tmpdir(), "savia-runtime-timing-"));
  try {
    const path = join(directory, "timings-1.jsonl");
    await writeFile(
      path,
      [
        JSON.stringify({
          label: "phase:deploy",
          durationMs: 45,
          outcome: "success",
        }),
        "{malformed",
        JSON.stringify({
          label: "phase:deploy\n::error::sentinel",
          durationMs: 1,
          outcome: "success",
        }),
        JSON.stringify({
          label: "phase:deploy",
          durationMs: 1,
          outcome: "success",
          secret: "sentinel",
        }),
        JSON.stringify({
          label: "phase:verify",
          durationMs: 1,
          outcome: "failure",
        }),
      ].join("\n"),
    );
    const rows = await readRuntimeTimings(directory);
    assert.deepEqual(rows, [
      { label: "phase:deploy", durationMs: 45, outcome: "success" },
      { label: "phase:verify", durationMs: 1, outcome: "failure" },
    ]);
    const summary = formatRuntimeTimingSummary(rows);
    assert.match(summary, /phase:deploy.*45 ms.*success/);
    assert.match(summary, /phase:verify.*1 ms.*failure/);
    assert.doesNotMatch(summary, /sentinel|malformed|secret|::error::/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("concurrent timing appends stay as separate complete JSONL rows", async () => {
  const directory = await mkdtemp(join(tmpdir(), "savia-runtime-timing-"));
  try {
    await Promise.all(
      Array.from({ length: 80 }, (_, index) =>
        recordRuntimeTiming(directory, "phase:deploy", index, "success"),
      ),
    );
    const [file] = await readdir(directory);
    const content = await readFile(join(directory, file), "utf8");
    assert.equal(content.trim().split("\n").length, 80);
    assert.equal((await readRuntimeTimings(directory)).length, 80);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("summary CLI reads the timing file from paths containing spaces and appends only sanitized markdown", async () => {
  const directory = await mkdtemp(join(tmpdir(), "savia timing cli "));
  try {
    const timingDirectory = join(directory, "private operations");
    const summaryPath = join(directory, "step summary.md");
    await recordRuntimeTiming(timingDirectory, "phase:deploy", 21, "success");
    await writeFile(
      join(timingDirectory, `timings-${process.pid + 1}.jsonl`),
      `${JSON.stringify({ label: "phase:deploy\n::error::SENTINEL", durationMs: 99, outcome: "success" })}\n`,
    );
    const output = execFileSync(
      process.execPath,
      [
        fileURLToPath(new URL("./runtime-timing.mjs", import.meta.url)),
        "summary",
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          SAVIA_RUNTIME_OPERATION_DIRECTORY: timingDirectory,
          GITHUB_STEP_SUMMARY: summaryPath,
        },
      },
    );
    const summary = await readFile(summaryPath, "utf8");
    assert.match(output, /phase:deploy.*21 ms.*success/);
    assert.match(summary, /phase:deploy.*21 ms.*success/);
    assert.doesNotMatch(output + summary, /SENTINEL|::error::/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
