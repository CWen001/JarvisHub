#!/usr/bin/env node

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const composeFile = resolve(root, "apps/hono-api/docker-compose.yml");
const url = `http://127.0.0.1:${process.env.WEB_PORT || "5173"}`;

if ((process.argv[2] || "start") !== "start") {
  console.error("Usage: jvs-watch start");
  process.exit(1);
}

const code = await run("docker", [
  "compose",
  "--project-name", "jvs-watch",
  "--file", composeFile,
  "up", "-d", "--build",
]);

if (code !== 0) {
  console.error("启动失败。请确认 Docker Desktop 已安装并正在运行。");
  process.exit(code || 1);
}

console.log(`服务正在启动：${url}`);
for (let attempt = 0; attempt < 600; attempt += 1) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
    if (response.ok) {
      openBrowser(url);
      console.log(`已打开：${url}`);
      process.exit(0);
    }
  } catch {
    // The first Docker build can take several minutes.
  }
  await sleep(1000);
}

console.error(`服务启动超时。请检查 Docker 日志：${url}`);
process.exit(1);

function run(command, args) {
  return new Promise((resolveExit, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit", windowsHide: true });
    child.once("error", reject);
    child.once("exit", (exitCode) => resolveExit(exitCode ?? 1));
  });
}

function openBrowser(target) {
  if (process.platform === "darwin") {
    spawn("open", [target], { detached: true, stdio: "ignore" }).unref();
  } else if (process.platform === "win32") {
    spawn("cmd.exe", ["/d", "/s", "/c", "start", "", target], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }).unref();
  } else {
    spawn("xdg-open", [target], { detached: true, stdio: "ignore" }).unref();
  }
}
