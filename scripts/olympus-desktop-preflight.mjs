#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hermesHome = process.env.HERMES_HOME || path.join(process.env.HOME || "", ".hermes");
const hermesSource = process.env.HERMES_SOURCE || path.join(hermesHome, "hermes-agent");
const dashboardSourceDir = path.join(repoRoot, "dashboard");
const dashboardTargetDir = path.join(hermesHome, "plugins", "olympus", "dashboard");
const desktopAppCandidates = [
  process.env.HERMES_DESKTOP_APP,
  path.join(hermesSource, "apps", "desktop", "release", "mac-arm64", "Hermes.app"),
  "/Applications/Hermes.app",
].filter(Boolean);

const checks = [];

function record(state, name, detail = "") {
  checks.push({ state, name, detail });
}

function ok(name, detail = "") {
  record("ok", name, detail);
}

function warn(name, detail = "") {
  record("warning", name, detail);
}

function fail(name, detail = "") {
  record("fail", name, detail);
}

function exists(filePath) {
  return fs.existsSync(filePath);
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: "utf8", ...options });
}

function readJson(filePath) {
  return JSON.parse(readText(filePath));
}

function checkManifest() {
  const manifestPath = path.join(dashboardSourceDir, "manifest.json");
  if (!exists(manifestPath)) {
    fail("olympus manifest", "dashboard/manifest.json is missing");
    return;
  }
  const manifest = readJson(manifestPath);
  if (manifest.name !== "olympus") {
    fail("olympus manifest", "expected name=olympus");
    return;
  }
  if (!manifest.tab || manifest.tab.path !== "/olympus") {
    fail("olympus manifest", "expected tab.path=/olympus");
    return;
  }
  if (manifest.api !== "plugin_api.py") {
    fail("olympus manifest", "expected api=plugin_api.py");
    return;
  }
  ok("olympus manifest", "name=olympus tab=/olympus api=plugin_api.py");
}

function checkDashboardLink() {
  if (!exists(dashboardTargetDir)) {
    warn("hermes plugin link", `missing ${dashboardTargetDir}; run scripts/install-dashboard-link.sh`);
    return;
  }
  const stat = fs.lstatSync(dashboardTargetDir);
  if (!stat.isSymbolicLink()) {
    warn("hermes plugin link", `${dashboardTargetDir} exists but is not a symlink`);
    return;
  }
  const target = path.resolve(path.dirname(dashboardTargetDir), fs.readlinkSync(dashboardTargetDir));
  if (target !== dashboardSourceDir) {
    warn("hermes plugin link", `points to ${target}`);
    return;
  }
  ok("hermes plugin link", `${dashboardTargetDir} -> ${dashboardSourceDir}`);
}

function checkHermesCli() {
  const result = run("hermes", ["--version"]);
  if (result.status === 0) {
    ok("hermes cli", (result.stdout || result.stderr).trim());
  } else {
    fail("hermes cli", "hermes --version failed");
  }
}

function checkWebPluginSupport() {
  const webFiles = [
    "web/src/plugins/usePlugins.ts",
    "web/src/plugins/PluginPage.tsx",
    "web/src/App.tsx",
  ];
  for (const rel of webFiles) {
    const filePath = path.join(hermesSource, rel);
    if (exists(filePath)) ok(`hermes web ${rel}`);
    else warn(`hermes web ${rel}`, "file missing in local Hermes source");
  }
}

function checkDesktopStatus() {
  const appPath = desktopAppCandidates.find((candidate) => exists(candidate));
  if (appPath) ok("hermes desktop app", appPath);
  else warn("hermes desktop app", "Hermes.app not found in known local locations");

  const routesPath = path.join(hermesSource, "apps", "desktop", "src", "app", "routes.ts");
  if (!exists(routesPath)) {
    warn("desktop route source", "apps/desktop/src/app/routes.ts not found");
    return;
  }
  const routes = readText(routesPath);
  if (routes.includes("/olympus") || routes.includes("dashboard") || routes.includes("plugins")) {
    ok("desktop plugin route signal", "Desktop source includes a dashboard/plugin route signal");
  } else {
    warn("desktop plugin route signal", "Desktop has native routes but no dashboard plugin route signal yet");
  }
}

function checkUsageOwnership() {
  const usagePath = path.join(hermesSource, "apps", "desktop", "src", "app", "command-center", "index.tsx");
  if (!exists(usagePath)) {
    warn("desktop usage ownership", "Command Center source not found");
    return;
  }
  const text = readText(usagePath);
  const hasUsageApi = text.includes("getUsageAnalytics") || text.includes("/api/analytics/usage") || text.includes("analytics/usage");
  const lower = text.toLowerCase();
  const hasRenderedLedgerTerms = ["sessions", "api", "tokens"].every((term) => lower.includes(term));
  const typesPath = path.join(hermesSource, "apps", "desktop", "src", "types", "hermes.ts");
  const hasCostModel = lower.includes("cost") || (exists(typesPath) && readText(typesPath).toLowerCase().includes("cost"));
  if (hasUsageApi && hasRenderedLedgerTerms) {
    ok("desktop usage ownership", hasCostModel
      ? "Command Center Usage owns sessions, API calls, tokens, with cost available in analytics data"
      : "Command Center Usage owns sessions, API calls, and tokens");
  } else {
    warn("desktop usage ownership", "Command Center Usage source did not show usage API plus sessions/API/tokens terms");
  }
}

function checkDesktopPython() {
  const candidates = [
    process.env.HERMES_DESKTOP_PYTHON,
    path.join(hermesSource, "venv", "bin", "python"),
    path.join(hermesSource, ".venv", "bin", "python"),
  ].filter(Boolean);
  let found = false;
  for (const python of candidates) {
    if (!exists(python)) continue;
    found = true;
    const result = run(python, ["-c", "import fastapi, uvicorn; print('dashboard deps ok')"]);
    if (result.status === 0) {
      ok(`desktop python ${python}`, result.stdout.trim());
      return;
    }
    warn(`desktop python ${python}`, (result.stderr || result.stdout || "missing dashboard deps").trim());
  }
  if (!found) warn("desktop python", "no Desktop Python candidate found");
}

checkManifest();
checkDashboardLink();
checkHermesCli();
checkWebPluginSupport();
checkDesktopStatus();
checkUsageOwnership();
checkDesktopPython();

for (const check of checks) {
  console.log(`[${check.state}] ${check.name}${check.detail ? ` - ${check.detail}` : ""}`);
}

const failures = checks.filter((check) => check.state === "fail");
const warnings = checks.filter((check) => check.state === "warning");
console.log(JSON.stringify({
  ok: failures.length === 0,
  checks: checks.length,
  warnings: warnings.length,
  failures: failures.map((check) => check.name),
}, null, 2));

if (failures.length) process.exit(1);
