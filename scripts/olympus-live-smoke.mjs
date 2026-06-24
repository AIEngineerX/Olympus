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
const modeTabLabels = ["Brief", "Agents", "Skills", "Kanban", "Policy", "Diagnostics"];
const briefSections = [
  [".olympus-hero", "Olympus"],
  [".olympus-score-card", "What the Score Means"],
  [".olympus-agent-hq", "Agent Monitor"],
];
const modeSections = {
  Agents: [
    [".olympus-performance", "Performance Tracking"],
    [".olympus-profile-fitness", "Profile Fitness"],
    [".olympus-pantheon", "Pantheon"],
  ],
  Skills: [
    [".olympus-skill-coverage", "Skill Coverage"],
    [".olympus-skill-hygiene", "Skill Hygiene"],
  ],
  Kanban: [
    [".olympus-trace-spine", "Trace Spine"],
    [".olympus-kanban", "Kanban Intelligence"],
  ],
  Policy: [
    [".olympus-policy", "Tool Policy & Aux Cost"],
  ],
  Diagnostics: [
    [".olympus-ops-evals", "Operational Evals"],
    [".olympus-diagnostics", "Production Diagnostics"],
    [".olympus-evidence-sources", "Evidence Sources"],
  ],
};
const deepSections = Object.values(modeSections).flat()
  .filter(([selector], index, sections) => sections.findIndex((item) => item[0] === selector) === index);
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
  return page.evaluate(({ required, deep, tabs, bannedPhrases, allowedRoutes }) => {
    const pageEl = document.querySelector(".olympus-page");
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const collectSections = (items) => items.map(([selector, text]) => {
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
      sections: collectSections(required),
      deepSections: collectSections(deep),
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
      modeTabs: Array.from(pageEl.querySelectorAll(".olympus-mode-tab")).filter(visible).map((el) => ({
        selected: el.getAttribute("aria-selected") === "true",
        text: (el.querySelector("span") && el.querySelector("span").textContent || "").trim(),
      })),
      expectedTabs: tabs,
      diagnosticsVisible: Boolean(document.querySelector(".olympus-diagnostics") && bodyText.includes("Production Diagnostics")),
      evidenceSourcesVisible: Boolean(document.querySelector(".olympus-evidence-sources") && bodyText.includes("Evidence Sources")),
      traceSpineVisible: Boolean(document.querySelector(".olympus-trace-spine") && bodyText.includes("Trace Spine")),
      opsEvalsVisible: Boolean(document.querySelector(".olympus-ops-evals") && bodyText.includes("Operational Evals")),
      policyVisible: Boolean(document.querySelector(".olympus-policy") && bodyText.includes("Tool Policy & Aux Cost")),
      skillHygieneVisible: Boolean(document.querySelector(".olympus-skill-hygiene") && bodyText.includes("Skill Hygiene")),
      pantheonVisible: Boolean(document.querySelector(".olympus-pantheon") && bodyText.includes("Pantheon")),
      pantheonButtons: Array.from(pageEl.querySelectorAll(".olympus-pantheon .olympus-agent-card")).filter(visible).length,
    };
  }, {
    required: sections,
    deep: deepSections,
    tabs: modeTabLabels,
    bannedPhrases: bannedCopyPhrases,
    allowedRoutes: allowedHermesRoutes,
  });
}

async function selectMode(page, label, sections) {
  const tab = page.locator(`.olympus-mode-tab[aria-label="${label}"]`);
  await tab.click();
  await page.waitForFunction((mode) => {
    const active = document.querySelector(`.olympus-mode-tab[aria-label="${mode}"]`);
    return active && active.getAttribute("aria-selected") === "true";
  }, label, { timeout: 5000 });
  await page.waitForFunction((expected) => {
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    return expected.every(([selector, text]) => {
      const el = document.querySelector(selector);
      return el && visible(el) && (el.innerText || "").includes(text);
    });
  }, sections, { timeout: 15000 });
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
  await page.waitForSelector(".olympus-mode-tabs", { timeout: 15000 });
  const metrics = await collectMetrics(page, briefSections);
  const modeMetrics = {};
  for (const [label, sections] of Object.entries(modeSections)) {
    await selectMode(page, label, sections);
    modeMetrics[label] = await collectMetrics(page, sections);
  }
  await context.close();
  const relevantConsoleErrors = failedResponses.length
    ? consoleErrors
    : consoleErrors.filter((message) => !message.includes("Failed to load resource"));
  return { viewport: viewport.name, consoleErrors: relevantConsoleErrors, failedResponses, ignoredFailedResponses, metrics, modeMetrics };
}

async function main() {
  const server = await startHermesIfNeeded();
  const sessionToken = await fetchSessionToken(baseUrl);
  const healthUrl = new URL("/api/plugins/olympus/health", dashboardUrl).toString();
  const health = await requestTextWithHeaders(
    healthUrl,
    sessionToken ? { "X-Hermes-Session-Token": sessionToken } : {},
    5000,
  );
  if (health.statusCode === 404) {
    const hint = await backendCompatibilityHint(sessionToken, { health: health.statusCode });
    if (hint) throw new Error(`${healthUrl} returned 404. ${hint}`);
  }
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
      const visibleDeep = result.metrics.deepSections.filter((section) => section.exists && section.visible);
      if (visibleDeep.length) failures.push(`${result.viewport}: deep sections visible in brief ${visibleDeep.map((s) => s.selector).join(", ")}`);
      const actualTabs = result.metrics.modeTabs.map((item) => item.text);
      if (JSON.stringify(actualTabs) !== JSON.stringify(modeTabLabels)) failures.push(`${result.viewport}: mode tabs ${JSON.stringify(actualTabs)}`);
      const selectedTabs = result.metrics.modeTabs.filter((item) => item.selected).map((item) => item.text);
      if (JSON.stringify(selectedTabs) !== JSON.stringify(["Brief"])) failures.push(`${result.viewport}: brief tab not selected ${JSON.stringify(selectedTabs)}`);
      if (result.metrics.horizontalOverflow > 2) failures.push(`${result.viewport}: horizontal overflow ${result.metrics.horizontalOverflow}`);
      if (result.metrics.tinyText.length) failures.push(`${result.viewport}: tiny text ${JSON.stringify(result.metrics.tinyText)}`);
      if (result.metrics.badCopyPhrases.length) failures.push(`${result.viewport}: banned copy phrases ${result.metrics.badCopyPhrases.join(", ")}`);
      if (result.metrics.badLinks.length) failures.push(`${result.viewport}: bad links ${JSON.stringify(result.metrics.badLinks)}`);
      if (result.metrics.svgTextCount) failures.push(`${result.viewport}: SVG text count ${result.metrics.svgTextCount}`);
      for (const [label, sections] of Object.entries(modeSections)) {
        const mode = result.modeMetrics[label];
        const missingMode = mode.sections.filter((section) => !section.exists || !section.visible || !section.containsText);
        if (missingMode.length) failures.push(`${result.viewport}: ${label} missing sections ${missingMode.map((s) => s.selector).join(", ")}`);
        if (mode.horizontalOverflow > 2) failures.push(`${result.viewport}: ${label} horizontal overflow ${mode.horizontalOverflow}`);
        if (mode.tinyText.length) failures.push(`${result.viewport}: ${label} tiny text ${JSON.stringify(mode.tinyText)}`);
        if (mode.badCopyPhrases.length) failures.push(`${result.viewport}: ${label} banned copy phrases ${mode.badCopyPhrases.join(", ")}`);
        if (mode.badLinks.length) failures.push(`${result.viewport}: ${label} bad links ${JSON.stringify(mode.badLinks)}`);
        if (mode.svgTextCount) failures.push(`${result.viewport}: ${label} SVG text count ${mode.svgTextCount}`);
        if (label === "Agents" && (!mode.pantheonVisible || mode.pantheonButtons < 1)) {
          failures.push(`${result.viewport}: Agents pantheon controls not visible`);
        }
        if (label === "Skills" && !mode.skillHygieneVisible) failures.push(`${result.viewport}: Skills skill hygiene not visible`);
        if (label === "Kanban" && !mode.traceSpineVisible) failures.push(`${result.viewport}: Kanban trace spine not visible`);
        if (label === "Policy" && !mode.policyVisible) failures.push(`${result.viewport}: Policy tool policy not visible`);
        if (label === "Diagnostics" && (!mode.diagnosticsVisible || !mode.evidenceSourcesVisible || !mode.opsEvalsVisible)) {
          failures.push(`${result.viewport}: Diagnostics panels not visible`);
        }
      }
    }
    const compactResults = results.map((result) => ({
      viewport: result.viewport,
      consoleErrors: result.consoleErrors,
      failedResponses: result.failedResponses,
      ignoredAuthResponses: result.ignoredFailedResponses.length,
      brief: {
        sections: result.metrics.sections.map((section) => section.selector),
        modeTabs: result.metrics.modeTabs.map((item) => item.text),
        horizontalOverflow: result.metrics.horizontalOverflow,
      },
      modes: Object.fromEntries(Object.entries(result.modeMetrics).map(([label, metrics]) => [
        label,
        {
          sections: metrics.sections.map((section) => section.selector),
          horizontalOverflow: metrics.horizontalOverflow,
          pantheonButtons: metrics.pantheonButtons,
        },
      ])),
    }));
    const summary = { ok: failures.length === 0, url: baseUrl, host, port, sessionTokenDetected: Boolean(sessionToken), results: compactResults, failures };
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
