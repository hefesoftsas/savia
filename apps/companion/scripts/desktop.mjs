import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const command = process.argv[2];
if (!["dev", "build"].includes(command)) {
  console.error("Usage: pnpm desktop:dev or pnpm desktop:build");
  process.exit(1);
}
const environment = { ...process.env };
const toolchain = path.join(root, "artifacts", "toolchain");
const cargoBin = path.join(toolchain, "cargo", "bin");
if (
  existsSync(
    path.join(cargoBin, process.platform === "win32" ? "cargo.exe" : "cargo"),
  )
) {
  environment.CARGO_HOME = path.join(toolchain, "cargo");
  environment.RUSTUP_HOME = path.join(toolchain, "rustup");
  environment.PATH = `${cargoBin}${path.delimiter}${environment.PATH ?? ""}`;
}
// Invoke the same pnpm runtime that launched this script; never interpolate a shell command.
const pnpmRuntime = process.env.npm_execpath;
if (!pnpmRuntime) {
  console.error("Launch the desktop scripts through pnpm.");
  process.exit(1);
}
const child = spawn(
  process.execPath,
  [pnpmRuntime, "exec", "tauri", command, ...process.argv.slice(3)],
  {
    cwd: root,
    env: environment,
    stdio: "inherit",
  },
);
child.on("error", () => {
  console.error("Could not launch the Tauri CLI.");
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
