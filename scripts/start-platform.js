import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const preferredPort = Number(process.env.PORT || "3000");
const runnerPort = process.env.RUNNER_PORT || "8010";
const runnerUrl = process.env.RUNNER_URL || `http://127.0.0.1:${runnerPort}`;
const pythonBin = process.env.PYTHON_BIN || "python3";
const workspaceRoot = process.cwd();
const runtimeFile = path.join(workspaceRoot, "data", "runtime.json");
const sqliteDataFile = path.join(workspaceRoot, "data", "app.db");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureRuntimeDir() {
  fs.mkdirSync(path.dirname(runtimeFile), { recursive: true });
}

function readRuntimeState() {
  try {
    return JSON.parse(fs.readFileSync(runtimeFile, "utf8"));
  } catch {
    return null;
  }
}

function writeRuntimeState(payload) {
  ensureRuntimeDir();
  fs.writeFileSync(runtimeFile, JSON.stringify(payload, null, 2));
}

function clearRuntimeState() {
  try {
    fs.unlinkSync(runtimeFile);
  } catch {}
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function listListeningPids(args) {
  const result = spawnSync("lsof", args, { encoding: "utf8" });
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(result.stderr || "failed to inspect listening ports");
  }

  return result.stdout
    .split("\n")
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/\s+/)[1])
    .map((value) => Number(value))
    .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
}

function listWorkspaceProcessPids() {
  const result = spawnSync("ps", ["-Ao", "pid,command"], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || "failed to inspect process list");
  }

  return result.stdout
    .split("\n")
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(.*)$/);
      if (!match) {
        return null;
      }
      return {
        pid: Number(match[1]),
        command: match[2]
      };
    })
    .filter((item) => item && Number.isInteger(item.pid) && item.pid > 0 && item.pid !== process.pid)
    .filter((item) => {
      const command = item.command;
      return (
        command.includes("node scripts/start-platform.js") ||
        command.includes("node src/server.js") ||
        command.includes("runner/server.py") ||
        (command.includes("sqlite3") && command.includes(sqliteDataFile))
      );
    })
    .map((item) => item.pid);
}

function collectStalePids() {
  const runtimeState = readRuntimeState();
  const runtimePids = [runtimeState?.runnerPid, runtimeState?.serverPid].filter(
    (pid) => Number.isInteger(pid) && pid > 0
  );
  const runnerPids = listListeningPids(["-nP", `-iTCP:${runnerPort}`, "-sTCP:LISTEN"]);
  const serverPids = listListeningPids(["-nP", `-iTCP:${preferredPort}-${preferredPort + 20}`, "-sTCP:LISTEN"]);
  const workspacePids = listWorkspaceProcessPids();

  return [...new Set([...runtimePids, ...runnerPids, ...serverPids, ...workspacePids])];
}

async function cleanupStaleProcesses() {
  const stalePids = collectStalePids();
  if (!stalePids.length) {
    return;
  }

  console.log(`Cleaning stale platform processes: ${stalePids.join(", ")}`);

  stalePids.forEach((pid) => {
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
  });

  await sleep(500);

  const survivors = stalePids.filter((pid) => isAlive(pid));
  if (!survivors.length) {
    clearRuntimeState();
    return;
  }

  survivors.forEach((pid) => {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  });

  await sleep(150);
  clearRuntimeState();
}

function startProcess(command, args, env) {
  return spawn(command, args, {
    stdio: "inherit",
    env: { ...process.env, ...env }
  });
}

await cleanupStaleProcesses();

const runner = startProcess(pythonBin, ["runner/server.py"], {
  RUNNER_PORT: runnerPort
});

const server = startProcess("node", ["src/server.js"], {
  RUNNER_URL: runnerUrl
});

writeRuntimeState({
  startedAt: new Date().toISOString(),
  runnerPid: runner.pid,
  serverPid: server.pid,
  preferredPort,
  runnerPort: Number(runnerPort)
});

let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  clearRuntimeState();
  server.kill("SIGTERM");
  runner.kill("SIGTERM");
  process.exit(code);
}

runner.on("exit", (code) => {
  if (!shuttingDown) {
    if (code !== 0) {
      console.error(`Python runner exited with code ${code ?? 1}`);
    }
    shutdown(code ?? 0);
  }
});

server.on("exit", (code) => {
  if (!shuttingDown) {
    if (code !== 0) {
      console.error(`Node control plane exited with code ${code ?? 1}`);
    }
    shutdown(code ?? 0);
  }
});

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
