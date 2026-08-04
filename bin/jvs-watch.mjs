#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const command = process.argv[2];
const supportedCommands = new Set(["start", "restart", "stop", "help"]);

if (!supportedCommands.has(command)) {
  console.error("Usage: jvs-watch <start|restart|stop|help>");
  process.exit(1);
}

const launcherPath = realpathSync(fileURLToPath(import.meta.url));
const projectRoot = resolve(dirname(launcherPath), "..");
const runScript = resolve(projectRoot, "run.sh");
const bash = resolveBash();

if (!bash) {
  console.error("Git Bash was not found. Install Git for Windows, then retry.");
  process.exit(1);
}

const child = spawn(bash, [runScript, ...process.argv.slice(2)], {
  cwd: projectRoot,
  env: process.env,
  stdio: "inherit",
  windowsHide: false,
});

child.once("error", (error) => {
  console.error(`Failed to start run.sh: ${error.message}`);
  process.exitCode = 1;
});

child.once("exit", (code) => {
  process.exitCode = code ?? 1;
});

function resolveBash() {
  if (process.env.JVS_WATCH_BASH && existsSync(process.env.JVS_WATCH_BASH)) {
    return process.env.JVS_WATCH_BASH;
  }

  if (process.platform !== "win32") return "/bin/bash";

  const candidates = [
    process.env.ProgramFiles && resolve(process.env.ProgramFiles, "Git", "bin", "bash.exe"),
    process.env.ProgramFiles && resolve(process.env.ProgramFiles, "Git", "usr", "bin", "bash.exe"),
    process.env["ProgramFiles(x86)"] && resolve(process.env["ProgramFiles(x86)"], "Git", "bin", "bash.exe"),
    process.env.LOCALAPPDATA && resolve(process.env.LOCALAPPDATA, "Programs", "Git", "bin", "bash.exe"),
  ].filter(Boolean);

  return candidates.find((candidate) => existsSync(candidate));
}
