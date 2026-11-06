import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

// Each command owns a process group, including pnpm's browser descendants.
export function startCommand(command, args, options = {}) {
  if (process.platform === "win32")
    throw new Error(
      "The disposable MCP runner requires macOS or Linux (or WSL).",
    );
  const { captureStderr = false, ...spawnOptions } = options;
  const child = spawn(command, args, { ...spawnOptions, detached: true });
  let output = "";
  child.stdout?.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr?.on("data", (chunk) => {
    if (captureStderr) output += chunk;
  });
  const done = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) resolve(output);
      else reject(new Error(`${command} exited ${signal ?? code}`));
    });
  });
  let stopping;
  function killGroup(signal) {
    if (!child.pid) return;
    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
  return {
    done,
    stop() {
      return (stopping ??= (async () => {
        killGroup("SIGTERM");
        // The wrapper can exit before descendants; still kill the whole group.
        await delay(500);
        killGroup("SIGKILL");
        await done.catch(() => {});
      })());
    },
  };
}
