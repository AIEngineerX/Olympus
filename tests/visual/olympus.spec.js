const path = require("path");
const { pathToFileURL } = require("url");
const { expect, test } = require("@playwright/test");

const fixtureBaseUrl = pathToFileURL(path.join(__dirname, "../fixtures/olympus-fixture.html")).href;

const briefSections = [
  { selector: ".olympus-hero", text: "Olympus", minHeight: 120 },
  { selector: ".olympus-score-card", text: "Readiness Score", minHeight: 60 },
  { selector: ".olympus-agent-hq", text: "Agent Monitor", minHeight: 140 }
];
const deepSections = [
  { selector: ".olympus-performance", text: "Performance Tracking", minHeight: 180 },
  { selector: ".olympus-trace-spine", text: "Trace Spine", minHeight: 160 },
  { selector: ".olympus-ops-evals", text: "Operational Evals", minHeight: 180 },
  { selector: ".olympus-diagnostics", text: "Production Diagnostics", minHeight: 180 },
  { selector: ".olympus-policy", text: "Tool Policy & Aux Cost", minHeight: 180 },
  { selector: ".olympus-skill-coverage", text: "Skill Coverage", minHeight: 180 },
  { selector: ".olympus-skill-hygiene", text: "Skill Hygiene", minHeight: 180 },
  { selector: ".olympus-profile-fitness", text: "Profile Fitness", minHeight: 180 },
  { selector: ".olympus-pantheon", text: "Pantheon", minHeight: 240 },
  { selector: ".olympus-kanban", text: "Kanban Intelligence", minHeight: 180 }
];
const stagedModeSections = {
  Agents: [
    { selector: ".olympus-performance", text: "Performance Tracking", minHeight: 180 },
    { selector: ".olympus-profile-fitness", text: "Profile Fitness", minHeight: 180 },
    { selector: ".olympus-pantheon", text: "Pantheon", minHeight: 240 }
  ],
  Skills: [
    { selector: ".olympus-skill-coverage", text: "Skill Coverage", minHeight: 180 },
    { selector: ".olympus-skill-hygiene", text: "Skill Hygiene", minHeight: 180 }
  ],
  Kanban: [
    { selector: ".olympus-trace-spine", text: "Trace Spine", minHeight: 160 },
    { selector: ".olympus-kanban", text: "Kanban Intelligence", minHeight: 180 }
  ],
  Policy: [
    { selector: ".olympus-policy", text: "Tool Policy & Aux Cost", minHeight: 180 }
  ],
  Diagnostics: [
    { selector: ".olympus-ops-evals", text: "Operational Evals", minHeight: 180 },
    { selector: ".olympus-metrics-spine", text: "Metrics Spine", minHeight: 180 },
    { selector: ".olympus-diagnostics", text: "Production Diagnostics", minHeight: 180 }
  ]
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
  "cutting-edge"
];
const privateLabelPhrases = [
  "Visual QA",
  "Backend",
  "Curator",
  "Ops",
  "Browser smoke",
  "Split overloaded visual work"
];
const allowedHermesRoutes = ["/analytics", "/config", "/cron", "/kanban", "/logs", "/profiles", "/sessions", "/skills"];

const scenarios = [
  { name: "noisy", expectedSections: briefSections, minAgentCards: 0 },
  { name: "healthy", expectedSections: briefSections, minAgentCards: 0 },
  {
    name: "empty",
    expectedSections: briefSections,
    absentSections: deepSections.map((section) => section.selector),
    minAgentCards: 0
  },
  { name: "overloaded", expectedSections: briefSections, minAgentCards: 0 },
  { name: "stale", expectedSections: briefSections, minAgentCards: 0 },
  { name: "high-cost", expectedSections: briefSections, minAgentCards: 0 },
  { name: "no-labels", expectedSections: briefSections, minAgentCards: 0, assertPrivateLabelsHidden: true }
];

function fixtureUrl(state) {
  return `${fixtureBaseUrl}?state=${encodeURIComponent(state)}`;
}

async function openFixture(page, testInfo, size, state) {
  const messages = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") messages.push(msg.text());
  });
  page.on("pageerror", (error) => messages.push(error.message));

  await page.setViewportSize(size);
  await page.goto(fixtureUrl(state));
  await page.locator(".olympus-page").waitFor();
  await page.locator(".olympus-mode-tabs").waitFor();
  await page.screenshot({
    path: testInfo.outputPath(`olympus-${state}-${size.width}x${size.height}.png`),
    fullPage: true
  });
  return messages;
}

async function assertExpectedSections(page, sections) {
  for (const section of sections) {
    const locator = page.locator(section.selector);
    await expect(locator).toBeVisible();
    await expect(locator).toContainText(section.text);
    const box = await locator.boundingBox();
    expect(box && box.width).toBeGreaterThan(100);
    expect(box && box.height).toBeGreaterThan(section.minHeight);
  }
}

async function assertAbsentSections(page, sections) {
  for (const selector of sections || []) {
    await expect(page.locator(selector)).toHaveCount(0);
  }
}

async function assertBriefOnly(page) {
  await expect(page.getByRole("tab", { name: "Brief" })).toHaveAttribute("aria-selected", "true");
  await assertExpectedSections(page, briefSections);
  await assertAbsentSections(page, deepSections.map((section) => section.selector));
}

async function selectMode(page, label) {
  const tab = page.getByRole("tab", { name: label });
  await expect(tab).toHaveCount(1);
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
}

async function collectVisualMetrics(page) {
  return page.evaluate(({ bannedPhrases, privatePhrases, allowedRoutes }) => {
    const rectOf = (el) => {
      const rect = el.getBoundingClientRect();
      return {
        bottom: rect.bottom,
        height: rect.height,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        width: rect.width
      };
    };
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const pageEl = document.querySelector(".olympus-page");
    if (!pageEl) return { missingPage: true };
    const viewport = document.querySelector(".olympus-command-viewport");
    const pantheon = document.querySelector(".olympus-pantheon");
    const agentCards = Array.from(document.querySelectorAll(".olympus-agent-card"));
    const tinyVisibleText = Array.from(pageEl.querySelectorAll("*"))
      .filter((el) => {
        const text = (el.textContent || "").trim();
        if (!text) return false;
        const style = window.getComputedStyle(el);
        return visible(el) && Number.parseFloat(style.fontSize || "0") < 10;
      })
      .map((el) => ({
        className: String(el.className || ""),
        fontSize: window.getComputedStyle(el).fontSize,
        text: (el.textContent || "").trim().slice(0, 80)
      }));
    const renderedText = pageEl.innerText || "";
    const badCopyPhrases = bannedPhrases
      .filter((phrase) => new RegExp("\\b" + phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i").test(renderedText));
    const badLinks = Array.from(pageEl.querySelectorAll("a"))
      .filter(visible)
      .map((el) => ({
        href: el.getAttribute("href") || "",
        text: (el.textContent || "").trim()
      }))
      .filter((item) => {
        const route = item.href.split(/[?#]/)[0];
        return !item.href ||
          item.href === "#" ||
          item.href.startsWith("javascript:") ||
          item.text.length < 4 ||
          (route.startsWith("/") && !allowedRoutes.includes(route));
      });
    const smallControls = Array.from(pageEl.querySelectorAll("button, a, summary"))
      .filter(visible)
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          className: String(el.className || ""),
          height: rect.height,
          text: (el.textContent || "").trim().slice(0, 80),
          width: rect.width
        };
      })
      .filter((item) => item.width < 32 || item.height < 32);
    return {
      agentCards: agentCards.length,
      agentMonitorTiles: Array.from(pageEl.querySelectorAll(".olympus-agent-hq .olympus-hq-tile")).filter(visible).length,
      visibleTuningItems: Array.from(pageEl.querySelectorAll(".olympus-agent-hq .olympus-tuning-item")).filter(visible).length,
      collapsedBacklog: Boolean(pageEl.querySelector(".olympus-agent-hq .olympus-backlog-details")),
      badCopyPhrases,
      badLinks,
      evidenceSourcesVisible: renderedText.includes("Evidence Sources"),
      policyVisible: Boolean(document.querySelector(".olympus-policy") && renderedText.includes("Tool Policy & Aux Cost")),
      traceSpineVisible: Boolean(document.querySelector(".olympus-trace-spine") && renderedText.includes("Trace Spine")),
      opsEvalsVisible: Boolean(document.querySelector(".olympus-ops-evals") && renderedText.includes("Operational Evals")),
      metricsSpineVisible: Boolean(document.querySelector(".olympus-metrics-spine") && renderedText.includes("Metrics Spine")),
      horizontalOverflow: Math.max(
        document.documentElement.scrollWidth - window.innerWidth,
        document.body.scrollWidth - window.innerWidth
      ),
      sectionCount: document.querySelectorAll(".olympus-section").length + document.querySelectorAll(".olympus-hero").length,
      modeTabs: Array.from(pageEl.querySelectorAll(".olympus-mode-tab")).filter(visible).map((el) => ({
        selected: el.getAttribute("aria-selected"),
        text: (el.querySelector("span") && el.querySelector("span").textContent || "").trim()
      })),
      pantheonVisible: Boolean(pantheon && visible(pantheon) && renderedText.includes("Pantheon")),
      pantheonButtons: Array.from(document.querySelectorAll(".olympus-pantheon .olympus-agent-card")).filter(visible).length,
      smallControls,
      svgTextCount: pageEl.querySelectorAll("svg text").length,
      tinyVisibleText,
      privateLabelLeaks: [
        ...Array.from((renderedText.matchAll(/(?:\/Users\/|\\\\Users\\\\|\.hermes|kanban\/boards|state\.db|gateway\.pid)/gi))).map((m) => m[0]),
        ...privatePhrases.filter((phrase) => renderedText.includes(phrase))
      ],
      viewport: viewport ? rectOf(viewport) : null
    };
  }, { bannedPhrases: bannedCopyPhrases, privatePhrases: privateLabelPhrases, allowedRoutes: allowedHermesRoutes });
}

for (const scenario of scenarios) {
  test(`desktop ${scenario.name} viewport is readable and console-clean`, async ({ page }, testInfo) => {
    const messages = await openFixture(page, testInfo, { width: 1280, height: 720 }, scenario.name);
    await assertBriefOnly(page);
    await assertAbsentSections(page, scenario.absentSections);
    const metrics = await collectVisualMetrics(page);

    expect(messages).toEqual([]);
    expect(metrics.agentCards).toBeGreaterThanOrEqual(scenario.minAgentCards);
    expect(metrics.badCopyPhrases).toEqual([]);
    expect(metrics.evidenceSourcesVisible).toBe(false);
    expect(metrics.policyVisible).toBe(false);
    expect(metrics.traceSpineVisible).toBe(false);
    expect(metrics.opsEvalsVisible).toBe(false);
    expect(metrics.metricsSpineVisible).toBe(false);
    expect(metrics.pantheonVisible).toBe(false);
    expect(metrics.badLinks).toEqual([]);
    expect(metrics.modeTabs.map((item) => item.text)).toEqual(["Brief", "Agents", "Skills", "Kanban", "Policy", "Diagnostics"]);
    expect(metrics.agentMonitorTiles).toBeLessThanOrEqual(6);
    expect(metrics.visibleTuningItems).toBeLessThanOrEqual(3);
    expect(metrics.horizontalOverflow).toBeLessThanOrEqual(2);
    expect(metrics.sectionCount).toBeLessThanOrEqual(4);
    expect(metrics.smallControls).toEqual([]);
    expect(metrics.svgTextCount).toBe(0);
    expect(metrics.tinyVisibleText).toEqual([]);
    if (metrics.viewport) expect(metrics.viewport.width).toBeGreaterThan(800);
    if (scenario.assertPrivateLabelsHidden) expect(metrics.privateLabelLeaks).toEqual([]);
  });

  test(`mobile ${scenario.name} viewport stacks without microscopic labels`, async ({ page }, testInfo) => {
    const messages = await openFixture(page, testInfo, { width: 390, height: 844 }, scenario.name);
    await assertBriefOnly(page);
    await assertAbsentSections(page, scenario.absentSections);
    const metrics = await collectVisualMetrics(page);

    expect(messages).toEqual([]);
    expect(metrics.agentCards).toBeGreaterThanOrEqual(scenario.minAgentCards);
    expect(metrics.badCopyPhrases).toEqual([]);
    expect(metrics.evidenceSourcesVisible).toBe(false);
    expect(metrics.policyVisible).toBe(false);
    expect(metrics.traceSpineVisible).toBe(false);
    expect(metrics.opsEvalsVisible).toBe(false);
    expect(metrics.metricsSpineVisible).toBe(false);
    expect(metrics.pantheonVisible).toBe(false);
    expect(metrics.badLinks).toEqual([]);
    expect(metrics.modeTabs.map((item) => item.text)).toEqual(["Brief", "Agents", "Skills", "Kanban", "Policy", "Diagnostics"]);
    expect(metrics.agentMonitorTiles).toBeLessThanOrEqual(6);
    expect(metrics.visibleTuningItems).toBeLessThanOrEqual(3);
    expect(metrics.horizontalOverflow).toBeLessThanOrEqual(2);
    expect(metrics.sectionCount).toBeGreaterThanOrEqual(scenario.expectedSections.length);
    expect(metrics.smallControls).toEqual([]);
    expect(metrics.svgTextCount).toBe(0);
    expect(metrics.tinyVisibleText).toEqual([]);
    if (metrics.viewport) expect(metrics.viewport.width).toBeLessThanOrEqual(340);
    if (scenario.assertPrivateLabelsHidden) expect(metrics.privateLabelLeaks).toEqual([]);
  });
}

test("desktop noisy mode navigation stages deep inspection panels", async ({ page }, testInfo) => {
  const messages = await openFixture(page, testInfo, { width: 1280, height: 720 }, "noisy");
  expect(messages).toEqual([]);
  await assertBriefOnly(page);

  for (const [label, sections] of Object.entries(stagedModeSections)) {
    await selectMode(page, label);
    await assertExpectedSections(page, sections);
    const metrics = await collectVisualMetrics(page);
    expect(metrics.horizontalOverflow).toBeLessThanOrEqual(2);
    expect(metrics.smallControls).toEqual([]);
    expect(metrics.tinyVisibleText).toEqual([]);
  }
});

test("backend-unavailable mode falls back to Hermes dashboard APIs", async ({ page }, testInfo) => {
  const messages = await openFixture(page, testInfo, { width: 1280, height: 720 }, "static-user-plugin");

  expect(messages).toEqual([]);
  await expect(page.locator(".olympus-static-compatibility")).toBeVisible();
  await expect(page.locator(".olympus-static-compatibility")).toContainText("Backend Unavailable");
  await expect(page.locator(".olympus-static-compatibility")).toContainText("/api/dashboard/plugins");
  await expect(page.locator(".olympus-static-compatibility")).toContainText("Readiness scoring and deductions");
  await expect(page.locator(".olympus-agent-hq")).toContainText("Backend unavailable");
  await selectMode(page, "Diagnostics");
  await expect(page.locator(".olympus-diagnostics")).toContainText("Evidence Sources");
  await expect(page.locator(".olympus-diagnostics")).toContainText("/api/status");
});
