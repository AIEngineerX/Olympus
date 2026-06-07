#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseUrl = process.env.OLYMPUS_SMOKE_URL || "http://127.0.0.1:9119/olympus";
const dashboardUrl = new URL(baseUrl);
const port = Number(dashboardUrl.port || 80);
const host = dashboardUrl.hostname;
const dashboardSourceDir = path.join(repoRoot, "dashboard");
const hermesHome = process.env.HERMES_HOME || path.join(process.env.HOME || "", ".hermes");
const dashboardTargetDir = path.join(hermesHome, "plugins", "olympus", "dashboard");
const viewports = [
  { name: "desktop", width: 1280, height: 720 },
  { name: "mobile", width: 390, height: 844 },
];
const requiredSections = [
  [".olympus-hero", "Olympus"],
  [".olympus-score-card", "What the Score Means"],
  [".olympus-agent-hq", "Agent Monitor"],
  [".olympus-performance", "Performance Tracking"],
  [".olympus-trace-spine", "Trace Spine"],
  [".olympus-policy", "Tool Policy & Aux Cost"],
  [".olympus-skill-hygiene", "Skill Hygiene"],
  [".olympus-pantheon", "Pantheon"],
  [".olympus-kanban", "Kanban Intelligence"],
];
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

async function inspectViewport(browser, viewport, sessionToken) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
  });
  const page = await context.newPage();
  const consoleErrors = [];
  const failedResponses = [];
  const ignoredFailedResponses = [];
  if (sessionToken) {
    await page.route((url) => (
      url.origin === dashboardUrl.origin && url.pathname.startsWith("/api/plugins/olympus")
    ), (route) => {
      route.continue({
        headers: {
          ...route.request().headers(),
          "X-Hermes-Session-Token": sessionToken,
        },
      });
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
      const responseRecord = { status, url };
      if (parsed.origin === dashboardUrl.origin && parsed.pathname === "/api/auth/me") {
        ignoredFailedResponses.push(responseRecord);
      } else {
        failedResponses.push(responseRecord);
      }
    }
  });
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".olympus-page", { timeout: 15000 });
  await page.waitForSelector(".olympus-agent-hq", { timeout: 15000 });
  await page.waitForFunction(() => document.body.innerText.includes("Production Diagnostics"), { timeout: 15000 });
  const metrics = await page.evaluate(({ required, bannedPhrases, allowedRoutes }) => {
    const pageEl = document.querySelector(".olympus-page");
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const sections = required.map(([selector, text]) => {
      const el = document.querySelector(selector);
      const rect = el ? el.getBoundingClientRect() : null;
      return {
        selector,
        exists: Boolean(el),
        visible: Boolean(el && visible(el)),
        containsText: Boolean(el && (el.innerText || "").includes(text)),
        width: rect ? Math.round(rect.width) : 0,
        height: rect ? Math.round(rect.height) : 0,
      };
    });
    const tinyText = Array.from(pageEl.querySelectorAll("*"))
      .filter((el) => {
        const text = (el.textContent || "").trim();
        return text && visible(el) && Number.parseFloat(window.getComputedStyle(el).fontSize || "0") < 10;
      })
      .map((el) => ({ className: String(el.className || ""), text: (el.textContent || "").trim().slice(0, 80) }));
    const bodyText = pageEl.innerText || "";
    const badCopyPhrases = bannedPhrases
      .filter((phrase) => new RegExp("\\b" + phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i").test(bodyText));
    return {
      sections,
      horizontalOverflow: Math.max(document.documentElement.scrollWidth - window.innerWidth, document.body.scrollWidth - window.innerWidth),
      tinyText,
      badCopyPhrases,
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
      diagnosticsVisible: bodyText.includes("Production Diagnostics"),
      evidenceSourcesVisible: bodyText.includes("Evidence Sources"),
      traceSpineVisible: bodyText.includes("Trace Spine"),
      policyVisible: bodyText.includes("Tool Policy & Aux Cost"),
      skillHygieneVisible: bodyText.includes("Skill Hygiene"),
      pantheonVisible: bodyText.includes("Pantheon"),
      pantheonButtons: Array.from(pageEl.querySelectorAll(".olympus-pantheon .olympus-agent-card")).filter(visible).length,
    };
  }, { required: requiredSections, bannedPhrases: bannedCopyPhrases, allowedRoutes: allowedHermesRoutes });
  await context.close();
  const relevantConsoleErrors = failedResponses.length
    ? consoleErrors
    : consoleErrors.filter((message) => !message.includes("Failed to load resource"));
  return { viewport: viewport.name, consoleErrors: relevantConsoleErrors, failedResponses, ignoredFailedResponses, metrics };
}

async function main() {
  const server = await startHermesIfNeeded();
  const sessionToken = await fetchSessionToken(baseUrl);
  const browser = await chromium.launch();
  try {
    const results = [];
    for (const viewport of viewports) {
      results.push(await inspectViewport(browser, viewport, sessionToken));
    }
    const failures = [];
    for (const result of results) {
      if (result.consoleErrors.length) failures.push(`${result.viewport}: console errors: ${result.consoleErrors.join(" | ")}`);
      if (result.failedResponses.length) failures.push(`${result.viewport}: failed responses ${JSON.stringify(result.failedResponses)}`);
      const missing = result.metrics.sections.filter((section) => !section.exists || !section.visible || !section.containsText);
      if (missing.length) failures.push(`${result.viewport}: missing sections ${missing.map((s) => s.selector).join(", ")}`);
      if (result.metrics.horizontalOverflow > 2) failures.push(`${result.viewport}: horizontal overflow ${result.metrics.horizontalOverflow}`);
      if (result.metrics.tinyText.length) failures.push(`${result.viewport}: tiny text ${JSON.stringify(result.metrics.tinyText)}`);
      if (result.metrics.badCopyPhrases.length) failures.push(`${result.viewport}: banned copy phrases ${result.metrics.badCopyPhrases.join(", ")}`);
      if (result.metrics.badLinks.length) failures.push(`${result.viewport}: bad links ${JSON.stringify(result.metrics.badLinks)}`);
      if (result.metrics.svgTextCount) failures.push(`${result.viewport}: SVG text count ${result.metrics.svgTextCount}`);
      if (!result.metrics.diagnosticsVisible) failures.push(`${result.viewport}: production diagnostics not visible`);
      if (!result.metrics.evidenceSourcesVisible) failures.push(`${result.viewport}: evidence sources not visible`);
      if (!result.metrics.traceSpineVisible) failures.push(`${result.viewport}: trace spine not visible`);
      if (!result.metrics.policyVisible) failures.push(`${result.viewport}: tool policy not visible`);
      if (!result.metrics.skillHygieneVisible) failures.push(`${result.viewport}: skill hygiene not visible`);
      if (!result.metrics.pantheonVisible) failures.push(`${result.viewport}: pantheon not visible`);
      if (result.metrics.pantheonButtons < 1) failures.push(`${result.viewport}: pantheon agent buttons not visible`);
    }
    const summary = { ok: failures.length === 0, url: baseUrl, host, port, sessionTokenDetected: Boolean(sessionToken), results, failures };
    console.log(JSON.stringify(summary, null, 2));
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
