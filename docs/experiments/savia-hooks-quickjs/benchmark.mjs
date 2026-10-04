import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import { compile, start, call, directory } from "./runtime.mjs";
import { benchmarks, corpus } from "./fixtures.mjs";

const samples = Number(process.env.PROBE_SAMPLES ?? 200);
const rounds = Number(process.env.PROBE_ROUNDS ?? 3);
const hz = Number(
  execFileSync("getconf", ["CLK_TCK"], { encoding: "utf8" }).trim(),
);
const sizes = await compile();
const rows = [];
async function runtimePid() {
  for (const name of await readdir("/proc")) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const stat = await readFile(`/proc/${name}/stat`, "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      if (Number(fields[1]) === process.pid && stat.includes("(workerd)"))
        return Number(name);
    } catch {
      /* Process exited while enumerating. */
    }
  }
  throw new Error("Dedicated workerd child not found");
}
async function usage(pid) {
  const stat = await readFile(`/proc/${pid}/stat`, "utf8");
  const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  const status = await readFile(`/proc/${pid}/status`, "utf8");
  return {
    cpuMs: ((Number(fields[11]) + Number(fields[12])) * 1000) / hz,
    rssKiB: Number(status.match(/VmRSS:\s+(\d+)/)[1]),
  };
}
function summary(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    mean: values.reduce((a, b) => a + b, 0) / values.length,
    p50: sorted[Math.ceil(sorted.length * 0.5) - 1],
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
  };
}
for (let round = 0; round < rounds; round++) {
  const names = ["quickjs", "dynamic-load", "dynamic-get"];
  const order = [...names.slice(round % 3), ...names.slice(0, round % 3)];
  for (const engine of order) {
    const started = performance.now();
    const mf = await start(engine === "quickjs" ? "quickjs" : "dynamic");
    const processStartMs = performance.now() - started;
    try {
      const pid = await runtimePid();
      const invoke = (fixture) =>
        call(mf, { ...fixture, cached: engine === "dynamic-get" });
      const coldStart = performance.now();
      assert.equal((await invoke(benchmarks[1])).ok, true);
      const firstCallMs = performance.now() - coldStart;
      for (const fixture of benchmarks) {
        for (let i = 0; i < 20; i++)
          assert.equal((await invoke(fixture)).ok, true);
        const before = await usage(pid);
        const wallMs = [];
        for (let i = 0; i < samples; i++) {
          const start = performance.now();
          const result = await invoke(fixture);
          wallMs.push(performance.now() - start);
          assert.equal(result.ok, true, `${engine}/${fixture.name}`);
        }
        const after = await usage(pid);
        rows.push({
          round,
          engine,
          fixture: fixture.name,
          samples,
          processStartMs,
          firstCallMs,
          requestBytes: Buffer.byteLength(JSON.stringify(fixture)),
          localWorkerdCpuMs: after.cpuMs - before.cpuMs,
          localWorkerdCpuMsPerHook: (after.cpuMs - before.cpuMs) / samples,
          rssKiBBefore: before.rssKiB,
          rssKiBAfter: after.rssKiB,
          wallMs: summary(wallMs),
          wallSamplesMs: wallMs,
        });
        console.log(
          JSON.stringify({
            round,
            engine,
            fixture: fixture.name,
            wall: summary(wallMs),
            cpuMsPerHook: (after.cpuMs - before.cpuMs) / samples,
          }),
        );
      }
    } finally {
      await mf.dispose();
    }
  }
}
const aggregate = [];
for (const engine of ["quickjs", "dynamic-load", "dynamic-get"]) {
  for (const fixture of benchmarks) {
    const matching = rows.filter(
      (x) => x.engine === engine && x.fixture === fixture.name,
    );
    aggregate.push({
      engine,
      fixture: fixture.name,
      samples: matching.reduce((n, x) => n + x.samples, 0),
      wallMs: summary(matching.flatMap((x) => x.wallSamplesMs)),
      localWorkerdCpuMsPerHook:
        matching.reduce((n, x) => n + x.localWorkerdCpuMs, 0) /
        (samples * rounds),
    });
  }
}
const result = {
  measuredAt: new Date().toISOString(),
  methodology:
    "Sequential loopback requests; 20 warmups per case; rotating engine order; dedicated workerd process per engine/round. Linux process CPU includes runtime, GC, IPC and other threads; NOT Cloudflare billed CPU. Wall time measured by Node outside Workers. No live provider calls.",
  environment: {
    node: process.version,
    platform: os.platform(),
    arch: os.arch(),
    cpuModel: os.cpus()[0].model,
    cpuCount: os.cpus().length,
    clockTicksPerSecond: hz,
    workerd: "1.20260828.1",
    quickjsEmscripten: "0.31.0",
  },
  corpus,
  sizes,
  aggregate,
  rows,
};
await writeFile(
  `${directory}/benchmark.json`,
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(aggregate, null, 2));
