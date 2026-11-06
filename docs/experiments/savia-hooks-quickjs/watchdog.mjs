import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { directory } from "./runtime.mjs";

const child = spawn(process.execPath, [`${directory}/regexp-probe.mjs`], {
  detached: true,
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "",
  error = "",
  timedOut = false,
  started;
let timer = setTimeout(kill, 30_000);
function kill() {
  timedOut = true;
  process.kill(-child.pid, "SIGKILL");
}
child.stdout.on("data", (chunk) => {
  output += chunk;
  if (!started && output.includes("ready")) {
    started = performance.now();
    clearTimeout(timer);
    timer = setTimeout(kill, 5000);
  }
});
child.stderr.on("data", (chunk) => {
  error += chunk;
});
child.on("error", (err) => {
  throw err;
});
child.on("exit", async (code, signal) => {
  clearTimeout(timer);
  const result = {
    measuredAt: new Date().toISOString(),
    test: "QuickJS catastrophic RegExp /^(a+)+$/ on 32 a characters plus !",
    expected:
      "Guest should finish or be interrupted within the normal hook budget",
    status: started && timedOut ? "failed-isolation-budget" : "inspect-result",
    externalTimeoutMs: 5000,
    elapsedAfterReadyMs: started ? performance.now() - started : null,
    timedOut,
    exitCode: code,
    signal,
    stdout: output,
    stderr: error,
  };
  await writeFile(
    `${directory}/regexp-result.json`,
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result, null, 2));
  if (!started) process.exitCode = 1;
});
