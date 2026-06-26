#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  backendCompatibilityStatus,
  findOlympusPlugin,
  manifestDeclaresApi,
  parsePluginRows,
} from "./olympus-compat-helper.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseUrl = process.env.OLYMPUS_SMOKE_URL || "http://127.0.0.1:9119/olympus";
const dashboardUrl = new URL(baseUrl);
const hermesHome = process.env.HERMES_HOME || path.join(process.env.HOME || "", ".hermes");
const dashboardSourceDir = path.join(repoRoot, "dashboard");
const dashboardTargetDir = path.join(hermesHome, "plugins", "olympus", "dashboard");
const manifestPath = path.join(dashboardSourceDir, "manifest.json");
const runs = Math.max(1, Number.parseInt(process.env.OLYMPUS_PERF_RUNS || "5", 10) || 5);
const maxResponseMs = Number(process.env.OLYMPUS_PERF_MAX_RESPONSE_MS || "2000");
const maxAverageResponseMs = Number(process.env.OLYMPUS_PERF_MAX_AVG_RESPONSE_MS || "1000");
const routes = ["overview", "tuning"];

function requestText(url, options = {}, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const parsed = new URL(url);
    const client = parsed.protocol === "https:" ? https : http;
    const started = performance.now();
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
        resolve({
          body,
          statusCode: res.statusCode || 0,
          responseMs: Number((performance.now() - started).toFixed(2)),
        });
      });
    });
    req.on("error", () => resolve({ body: "", statusCode: 0, responseMs: Number((performance.now() - started).toFixed(2)) }));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve({ body: "", statusCode: 0, responseMs: Number((performance.now() - started).toFixed(2)) });
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
  const response = await requestText(url, {}, 3000);
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



async function backendCompatibilityHint(sessionToken, routeStatus) {
  const plugins = await requestText(new URL("/api/dashboard/plugins", baseUrl).toString(), {
    headers: sessionToken ? { "X-Hermes-Session-Token": sessionToken } : {},
  }, 5000);
  const discovered = findOlympusPlugin(parsePluginRows(plugins.body));
  const compatibility = backendCompatibilityStatus({
    backendMounted: false,
    discovered,
    manifestHasApi: manifestDeclaresApi(manifestPath),
    routeStatus: {
      dashboardPlugins: plugins.statusCode,
      ...routeStatus,
    },
  });
  return compatibility.hint;
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
    throw new Error("hermes command is not installed; start Hermes yourself or install Hermes before running performance smoke.");
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

function percentile(values, pct) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1));
  return sorted[idx];
}

async function measureRoute(routeName, sessionToken) {
  const url = new URL(`/api/plugins/olympus/${routeName}`, dashboardUrl).toString();
  const samples = [];
  for (let i = 0; i < runs; i += 1) {
    const response = await requestText(url, {
      headers: sessionToken ? { "X-Hermes-Session-Token": sessionToken } : {},
    });
    let payload = null;
    try {
      payload = JSON.parse(response.body);
    } catch {
      payload = null;
    }
    samples.push({
      statusCode: response.statusCode,
      responseMs: response.responseMs,
      bytes: Buffer.byteLength(response.body),
      generatedMs: payload && payload.diagnostics ? payload.diagnostics.generated_ms : null,
      payloadBytes: payload && payload.diagnostics ? payload.diagnostics.payload_bytes : null,
      budgetStatus: payload && payload.diagnostics ? payload.diagnostics.budget_status : null,
      budgets: payload && payload.diagnostics ? payload.diagnostics.budgets : null,
    });
  }
  const responseTimes = samples.map((sample) => sample.responseMs);
  const byteCounts = samples.map((sample) => sample.bytes);
  const generatedTimes = samples.map((sample) => sample.generatedMs).filter((value) => typeof value === "number");
  const payloadBudgets = samples.map((sample) => sample.budgets && sample.budgets.payload_bytes).filter((value) => typeof value === "number");
  const apiBudgets = samples.map((sample) => sample.budgets && sample.budgets.api_response_ms).filter((value) => typeof value === "number");
  const payloadBudget = Number(process.env.OLYMPUS_PERF_MAX_PAYLOAD_BYTES || payloadBudgets[0] || "250000");
  const apiBudget = Number(process.env.OLYMPUS_PERF_MAX_GENERATED_MS || apiBudgets[0] || "750");
  return {
    route: routeName,
    samples,
    summary: {
      runs,
      avgResponseMs: Number((responseTimes.reduce((sum, value) => sum + value, 0) / responseTimes.length).toFixed(2)),
      p95ResponseMs: percentile(responseTimes, 95),
      maxResponseMs: Math.max(...responseTimes),
      maxGeneratedMs: generatedTimes.length ? Math.max(...generatedTimes) : null,
      maxBytes: Math.max(...byteCounts),
      budgets: {
        maxResponseMs,
        maxAverageResponseMs,
        maxGeneratedMs: apiBudget,
        maxPayloadBytes: payloadBudget,
      },
    },
  };
}

async function routeFailures(result, sessionToken) {
  const failures = [];
  const { summary, samples, route } = result;
  const failedStatuses = samples.filter((sample) => sample.statusCode < 200 || sample.statusCode >= 300);
  if (failedStatuses.length) {
    failures.push(`${route}: non-2xx responses ${failedStatuses.map((sample) => sample.statusCode).join(", ")}`);
    if (failedStatuses.length === samples.length && failedStatuses.every((sample) => sample.statusCode === 404)) {
      const hint = await backendCompatibilityHint(sessionToken, { [route]: 404 });
      if (hint) failures.push(`${route}: ${hint}`);
    }
  }
  if (summary.maxResponseMs > summary.budgets.maxResponseMs) failures.push(`${route}: max response ${summary.maxResponseMs}ms > ${summary.budgets.maxResponseMs}ms`);
  if (summary.avgResponseMs > summary.budgets.maxAverageResponseMs) failures.push(`${route}: avg response ${summary.avgResponseMs}ms > ${summary.budgets.maxAverageResponseMs}ms`);
  if (summary.maxGeneratedMs !== null && summary.maxGeneratedMs > summary.budgets.maxGeneratedMs) failures.push(`${route}: generated ${summary.maxGeneratedMs}ms > ${summary.budgets.maxGeneratedMs}ms`);
  if (summary.maxBytes > summary.budgets.maxPayloadBytes) failures.push(`${route}: payload ${summary.maxBytes} bytes > ${summary.budgets.maxPayloadBytes} bytes`);
  for (const sample of samples) {
    if (sample.budgetStatus && Object.values(sample.budgetStatus).includes("warning")) {
      failures.push(`${route}: diagnostics budget warning ${JSON.stringify(sample.budgetStatus)}`);
      break;
    }
  }
  return failures;
}

async function main() {
  const server = await startHermesIfNeeded();
  try {
    const sessionToken = await fetchSessionToken(baseUrl);
    const results = [];
    for (const route of routes) {
      results.push(await measureRoute(route, sessionToken));
    }
    const failures = [];
    for (const result of results) failures.push(...await routeFailures(result, sessionToken));
    const summary = {
      ok: failures.length === 0,
      url: baseUrl,
      runs,
      sessionTokenDetected: Boolean(sessionToken),
      results,
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
