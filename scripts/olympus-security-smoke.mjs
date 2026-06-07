#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseUrl = process.env.OLYMPUS_SMOKE_URL || "http://127.0.0.1:9119/olympus";
const apiUrl = new URL("/api/plugins/olympus/overview", baseUrl).toString();
const dashboardSourceDir = path.join(repoRoot, "dashboard");
const hermesHome = process.env.HERMES_HOME || path.join(process.env.HOME || "", ".hermes");
const dashboardTargetDir = path.join(hermesHome, "plugins", "olympus", "dashboard");

const leakPatterns = [
  { name: "absolute user path", pattern: /\/Users\/|\\Users\\/ },
  { name: "raw Hermes path", pattern: /\.hermes[\\/]/ },
  { name: "raw database filename", pattern: /\b(?:state|kanban)\.db\b/ },
  { name: "gateway pid file", pattern: /\bgateway\.pid\b/ },
  { name: "raw worker pid key", pattern: /"worker_pid"\s*:/ },
  { name: "raw current run id key", pattern: /"current_run_id"\s*:/ },
  { name: "raw run id key", pattern: /"run_id"\s*:/ },
  { name: "raw session id key", pattern: /"session_id"\s*:/ },
  { name: "raw task run id value", pattern: /raw-(?:run|current-run|event|task|session)-id/i },
  { name: "workspace path key", pattern: /"workspace_path"\s*:/ },
  { name: "cwd key", pattern: /"cwd"\s*:/ },
  { name: "internal name key", pattern: /"_name"\s*:/ },
  { name: "raw config secret key", pattern: /"(?:api_key|session_key|base_url|password|secret|token)"\s*:/i },
  { name: "prompt/personality key", pattern: /"(?:prompt|personality)"\s*:/i },
  { name: "GitHub token", pattern: /github_pat_[A-Za-z0-9_]+|ghp_[A-Za-z0-9_]+/ },
  { name: "OpenAI-style secret", pattern: /sk-[A-Za-z0-9_-]{12,}/ },
  { name: "secret assignment", pattern: /(api[_-]?key|secret|password|passwd)\s*[:=]/i },
  { name: "bearer token", pattern: /bearer\s+[a-z0-9._~+/=-]+/i },
];
const traceSpineBlockedKeys = new Set([
  "current_run_id",
  "event_id",
  "handoff_error",
  "messages",
  "run_id",
  "session_id",
  "task_id",
  "transcript",
  "worker_pid",
]);

function requestText(url, options = {}, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const parsed = new URL(url);
    const client = parsed.protocol === "https:" ? https : http;
    const req = client.request(parsed, {
      method: options.method || "GET",
      headers: options.headers || {},
    }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        resolve({ body, statusCode: res.statusCode || 0 });
      });
    });
    req.on("error", () => resolve({ body: "", statusCode: 0 }));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve({ body: "", statusCode: 0 });
    });
    req.end();
  });
}

async function fetchSessionToken(url) {
  const response = await requestText(url);
  const match = response.body.match(/window\.__HERMES_SESSION_TOKEN__="([^"]+)"/);
  return match ? match[1] : "";
}

async function isHermesDashboard(url) {
  const response = await requestText(url);
  return response.statusCode >= 200 &&
    response.statusCode < 400 &&
    response.body.includes("window.__HERMES_SESSION_TOKEN__");
}

async function waitForServer(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isHermesDashboard(url)) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

function commandExists(command) {
  const result = spawnSync("sh", ["-lc", `command -v ${command}`], { encoding: "utf8" });
  return result.status === 0;
}

function linkAlreadyTargetsRepo() {
  try {
    const stat = fs.lstatSync(dashboardTargetDir);
    return stat.isSymbolicLink() && path.resolve(path.dirname(dashboardTargetDir), fs.readlinkSync(dashboardTargetDir)) === dashboardSourceDir;
  } catch {
    return false;
  }
}

function ensureDashboardLink() {
  if (linkAlreadyTargetsRepo()) return;
  if (fs.existsSync(dashboardTargetDir) && process.env.OLYMPUS_SMOKE_RELINK !== "1") {
    throw new Error(`Hermes already has an Olympus dashboard at ${dashboardTargetDir}. Set OLYMPUS_SMOKE_RELINK=1 to replace it for this smoke run.`);
  }
  const result = spawnSync(path.join(repoRoot, "scripts", "install-dashboard-link.sh"), [], { cwd: repoRoot, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`install-dashboard-link.sh failed:\n${result.stderr || result.stdout}`);
}

async function startHermesIfNeeded() {
  if (await isHermesDashboard(baseUrl)) return null;
  if (!commandExists("hermes")) {
    throw new Error("hermes command is not installed; start Hermes yourself or install Hermes before running security smoke.");
  }
  ensureDashboardLink();
  const child = spawn("hermes", ["dashboard", "--no-open", "--skip-build"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += String(chunk); });
  child.stderr.on("data", (chunk) => { output += String(chunk); });
  const ready = await waitForServer(baseUrl);
  if (!ready) {
    child.kill("SIGTERM");
    throw new Error(`Hermes dashboard did not become ready on ${baseUrl}.\n${output.slice(-2000)}`);
  }
  return child;
}

async function fetchOverview(sessionToken) {
  const response = await requestText(apiUrl, {
    headers: sessionToken ? { "X-Hermes-Session-Token": sessionToken } : {},
  }, 10000);
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`Overview request failed with ${response.statusCode}: ${response.body.slice(0, 500)}`);
  }
  try {
    return JSON.parse(response.body);
  } catch (error) {
    throw new Error(`Overview response was not JSON: ${error && error.message ? error.message : error}`);
  }
}

function assertPayload(payload) {
  const failures = [];
  if (!payload || typeof payload !== "object") failures.push("overview payload is not an object");
  if (!payload.evidence_sources) failures.push("missing evidence_sources");
  if (!payload.skill_hygiene) failures.push("missing skill_hygiene");
  if (!payload.config_policy) failures.push("missing config_policy");
  if (!payload.trace_spine) failures.push("missing trace_spine");
  const serialized = JSON.stringify(payload);
  for (const item of leakPatterns) {
    const match = serialized.match(item.pattern);
    if (match) failures.push(`${item.name}: ${match[0]}`);
  }
  const traceKeyLeaks = [];
  function scanTrace(value, pathName) {
    if (Array.isArray(value)) {
      value.forEach((item, idx) => scanTrace(item, `${pathName}[${idx}]`));
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      const nextPath = `${pathName}.${key}`;
      if (traceSpineBlockedKeys.has(key)) traceKeyLeaks.push(nextPath);
      scanTrace(item, nextPath);
    }
  }
  scanTrace(payload.trace_spine, "trace_spine");
  traceKeyLeaks.forEach((item) => failures.push(`trace_spine raw field: ${item}`));
  const privacy = payload.evidence_sources &&
    payload.evidence_sources.summary &&
    payload.evidence_sources.summary.privacy;
  if (process.env.OLYMPUS_EXPOSE_LOCAL_LABELS !== "1" && privacy !== "local labels hidden") {
    failures.push(`unexpected privacy state: ${privacy || "missing"}`);
  }
  return failures;
}

async function main() {
  const server = await startHermesIfNeeded();
  try {
    const sessionToken = await fetchSessionToken(baseUrl);
    const payload = await fetchOverview(sessionToken);
    const failures = assertPayload(payload);
    const summary = {
      ok: failures.length === 0,
      url: apiUrl,
      sessionTokenDetected: Boolean(sessionToken),
      evidenceSources: payload.evidence_sources && payload.evidence_sources.items ? payload.evidence_sources.items.length : 0,
      skillHygieneSignals: payload.skill_hygiene && payload.skill_hygiene.signals ? payload.skill_hygiene.signals.length : 0,
      configPolicyFindings: payload.config_policy && payload.config_policy.findings ? payload.config_policy.findings.length : 0,
      failures,
    };
    console.log(JSON.stringify(summary, null, 2));
    if (failures.length) process.exitCode = 1;
  } finally {
    if (server) server.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
