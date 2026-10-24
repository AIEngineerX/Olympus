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
import { chromium } from "playwright";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseUrl = process.env.OLYMPUS_SMOKE_URL || "http://127.0.0.1:9119/olympus";
const dashboardUrl = new URL(baseUrl);
const port = Number(dashboardUrl.port || 80);
const host = dashboardUrl.hostname;
const dashboardSourceDir = path.join(repoRoot, "dashboard");
const hermesHome = process.env.HERMES_HOME || path.join(process.env.HOME || "", ".hermes");
const dashboardTargetDir = path.join(hermesHome, "plugins", "olympus", "dashboard");
const manifestPath = path.join(dashboardSourceDir, "manifest.json");
const viewports = [
  { name: "desktop", width: 1280, height: 720 },
  { name: "mobile", width: 390, height: 844 },
];
// Each view and what must be on screen once it is open.
const viewSections = {
  Agents: [
    [".olympus-header", "Olympus"],
    [".olympus-census", ""],
    [".olympus-roster", ""],
  ],
  Performance: [
    [".olympus-performance", ""],
  ],
  Checks: [
    [".olympus-checks", "Findings"],
    [".olympus-checks", "Where spend goes"],
    [".olympus-debug", "Scan built in"],
  ],
};
const bannedCopyPhrases = [
  "no-fluff",
  "opportunity",
  "opportunities",
  "Open owner",
  "Open Hermes",
  "Open Hermes view",
  "Agent HQ",
  "Party View",
  "Selected Agent",
  "AI",
  "slop",
  "cruft",
  "seamless",
  "supercharge",
  "world-class",
  "next-generation",
  "cutting-edge",
];
const allowedHermesRoutes = ["/analytics", "/config", "/cron", "/kanban", "/logs", "/profiles", "/sessions", "/skills"];

function requestText(url, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const client = new URL(url).protocol === "https:" ? https : http;
    const req = client.get(url, (res) => {
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
  });
}

function requestTextWithHeaders(url, headers = {}, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const parsed = new URL(url);
    const client = parsed.protocol === "https:" ? https : http;
    const req = client.request(parsed, { headers }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ body, statusCode: res.statusCode || 0 }));
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



async function backendCompatibilityHint(sessionToken, routeStatus) {
  const plugins = await requestTextWithHeaders(
    new URL("/api/dashboard/plugins", baseUrl).toString(),
    sessionToken ? { "X-Hermes-Session-Token": sessionToken } : {},
    5000,
  );
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
  if (result.status !== 0) {
    throw new Error(`install-dashboard-link.sh failed:\n${result.stderr || result.stdout}`);
  }
}

async function startHermesIfNeeded() {
  if (await isHermesDashboard(baseUrl)) return null;
  if (!commandExists("hermes")) {
    throw new Error("hermes command is not installed; start Hermes yourself or install Hermes before running live smoke.");
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


async function collectMetrics(page, sections) {
  return page.evaluate(({ required, bannedPhrases, allowedRoutes }) => {
    const pageEl = document.querySelector(".olympus-page");
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const bodyText = pageEl.innerText || "";
    return {
      sections: required.map(([selector, text]) => {
        const el = document.querySelector(selector);
        return { selector, ok: Boolean(el && visible(el) && (el.innerText || "").includes(text)) };
      }),
      horizontalOverflow: Math.max(document.documentElement.scrollWidth - window.innerWidth, document.body.scrollWidth - window.innerWidth),
      tinyText: Array.from(pageEl.querySelectorAll("*"))
        .filter((el) => {
          const text = (el.textContent || "").trim();
          return text && visible(el) && Number.parseFloat(window.getComputedStyle(el).fontSize || "0") < 10;
        })
        .map((el) => ({ className: String(el.className || ""), text: (el.textContent || "").trim().slice(0, 80) })),
      badCopyPhrases: bannedPhrases
        .filter((phrase) => new RegExp("\\b" + phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i").test(bodyText)),
      badLinks: Array.from(pageEl.querySelectorAll("a"))
        .filter(visible)
        .map((el) => ({ href: el.getAttribute("href") || "", text: (el.textContent || "").trim() }))
        .filter((item) => {
          const route = item.href.split(/[?#]/)[0];
          return !item.href ||
            item.href === "#" ||
            item.href.startsWith("javascript:") ||
            item.text.length < 4 ||
            (route.startsWith("/") && !allowedRoutes.includes(route));
        }),
      svgTextCount: pageEl.querySelectorAll("svg text").length,
      views: Array.from(pageEl.querySelectorAll(".olympus-view-switch")).filter(visible).map((el) => ({
        label: (el.textContent || "").trim(),
        current: el.getAttribute("aria-current") === "page",
      })),
    };
  }, { required: sections, bannedPhrases: bannedCopyPhrases, allowedRoutes: allowedHermesRoutes });
}

async function showView(page, label, sections) {
  await page.locator(".olympus-view-switch", { hasText: label }).click();
  await page.waitForFunction((name) => Array.from(document.querySelectorAll(".olympus-view-switch"))
    .some((el) => el.textContent.trim() === name && el.getAttribute("aria-current") === "page"), label, { timeout: 5000 });
  // Checks keeps scan and payload numbers behind one disclosure.
  if (label === "Checks") await page.locator(".olympus-debug > summary").click();
  await page.waitForFunction((expected) => expected.every(([selector, text]) => {
    const el = document.querySelector(selector);
    return el && el.getBoundingClientRect().height > 0 && (el.innerText || "").includes(text);
  }), sections, { timeout: 15000 });
}

async function inspectViewport(browser, viewport, sessionToken) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
  const page = await context.newPage();
  const consoleErrors = [];
  const failedResponses = [];
  const ignoredFailedResponses = [];
  if (sessionToken) {
    await page.route((url) => (
      url.origin === dashboardUrl.origin && url.pathname.startsWith("/api/plugins/olympus")
    ), (route) => {
      route.continue({ headers: { ...route.request().headers(), "X-Hermes-Session-Token": sessionToken } });
    });
  }
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("response", (response) => {
    const status = response.status();
    const url = response.url();
    if (status >= 400 && !url.endsWith("/favicon.ico")) {
      const parsed = new URL(url);
      const record = { status, url };
      if (parsed.origin === dashboardUrl.origin && parsed.pathname === "/api/auth/me") ignoredFailedResponses.push(record);
      else failedResponses.push(record);
    }
  });
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".olympus-page", { timeout: 15000 });
  await page.waitForSelector(".olympus-views", { timeout: 15000 });
  const initial = await collectMetrics(page, viewSections.Agents);
  const views = {};
  for (const [label, sections] of Object.entries(viewSections)) {
    await showView(page, label, sections);
    views[label] = await collectMetrics(page, sections);
  }
  await context.close();
  const relevantConsoleErrors = failedResponses.length
    ? consoleErrors
    : consoleErrors.filter((message) => !message.includes("Failed to load resource"));
  return { viewport: viewport.name, consoleErrors: relevantConsoleErrors, failedResponses, ignoredFailedResponses, initial, views };
}

async function main() {
  const server = await startHermesIfNeeded();
  const sessionToken = await fetchSessionToken(baseUrl);
  const healthUrl = new URL("/api/plugins/olympus/health", dashboardUrl).toString();
  const health = await requestTextWithHeaders(healthUrl, sessionToken ? { "X-Hermes-Session-Token": sessionToken } : {}, 5000);
  if (health.statusCode === 404) {
    const hint = await backendCompatibilityHint(sessionToken, { health: health.statusCode });
    if (hint) throw new Error(`${healthUrl} returned 404. ${hint}`);
  }
  const browser = await chromium.launch();
  try {
    const results = [];
    for (const viewport of viewports) results.push(await inspectViewport(browser, viewport, sessionToken));
    const failures = [];
    for (const result of results) {
      const at = result.viewport;
      if (result.consoleErrors.length) failures.push(`${at}: console errors: ${result.consoleErrors.join(" | ")}`);
      if (result.failedResponses.length) failures.push(`${at}: failed responses ${JSON.stringify(result.failedResponses)}`);
      const labels = result.initial.views.map((item) => item.label);
      if (JSON.stringify(labels) !== JSON.stringify(Object.keys(viewSections))) failures.push(`${at}: views ${JSON.stringify(labels)}`);
      const current = result.initial.views.filter((item) => item.current).map((item) => item.label);
      if (JSON.stringify(current) !== JSON.stringify(["Agents"])) failures.push(`${at}: Agents is not the first view ${JSON.stringify(current)}`);
      for (const [label, metrics] of Object.entries(result.views)) {
        const missing = metrics.sections.filter((section) => !section.ok);
        if (missing.length) failures.push(`${at}: ${label} missing ${missing.map((s) => s.selector).join(", ")}`);
        if (metrics.horizontalOverflow > 2) failures.push(`${at}: ${label} horizontal overflow ${metrics.horizontalOverflow}`);
        if (metrics.tinyText.length) failures.push(`${at}: ${label} tiny text ${JSON.stringify(metrics.tinyText)}`);
        if (metrics.badCopyPhrases.length) failures.push(`${at}: ${label} banned copy phrases ${metrics.badCopyPhrases.join(", ")}`);
        if (metrics.badLinks.length) failures.push(`${at}: ${label} bad links ${JSON.stringify(metrics.badLinks)}`);
        if (metrics.svgTextCount) failures.push(`${at}: ${label} SVG text count ${metrics.svgTextCount}`);
      }
    }
    const compact = results.map((result) => ({
      viewport: result.viewport,
      consoleErrors: result.consoleErrors,
      failedResponses: result.failedResponses,
      ignoredAuthResponses: result.ignoredFailedResponses.length,
      views: Object.fromEntries(Object.entries(result.views).map(([label, metrics]) => [label, { horizontalOverflow: metrics.horizontalOverflow }])),
    }));
    console.log(JSON.stringify({ ok: failures.length === 0, url: baseUrl, host, port, sessionTokenDetected: Boolean(sessionToken), results: compact, failures }, null, 2));
    if (failures.length) process.exitCode = 1;
  } finally {
    await browser.close();
    if (server) server.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
