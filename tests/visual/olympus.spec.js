const path = require("path");
const { pathToFileURL } = require("url");
const { expect, test } = require("@playwright/test");

const fixtureBaseUrl = pathToFileURL(path.join(__dirname, "../fixtures/olympus-fixture.html")).href;

const expectedSections = [
  { selector: ".olympus-hero", text: "Olympus", minHeight: 120 },
  { selector: ".olympus-score-card", text: "What the Score Means", minHeight: 120 },
  { selector: ".olympus-agent-hq", text: "Agent HQ", minHeight: 180 },
  { selector: ".olympus-performance", text: "Performance Tracking", minHeight: 180 },
  { selector: ".olympus-skill-coverage", text: "Skill Coverage", minHeight: 180 },
  { selector: ".olympus-profile-fitness", text: "Profile Fitness", minHeight: 180 },
  { selector: ".olympus-party", text: "Agent View", minHeight: 240 },
  { selector: ".olympus-kanban", text: "Kanban Intelligence", minHeight: 180 }
];
const bannedCopyPhrases = [
  "no-fluff",
  "opportunity",
  "opportunities",
  "Open owner",
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
  { name: "noisy", expectedSections, minAgentCards: 5 },
  { name: "healthy", expectedSections, minAgentCards: 5 },
  {
    name: "empty",
    expectedSections: expectedSections.slice(0, 3),
    absentSections: [".olympus-skill-coverage", ".olympus-profile-fitness", ".olympus-party", ".olympus-kanban"],
    minAgentCards: 0
  },
  { name: "overloaded", expectedSections, minAgentCards: 5 },
  { name: "stale", expectedSections, minAgentCards: 5 },
  { name: "high-cost", expectedSections, minAgentCards: 5 },
  { name: "no-labels", expectedSections, minAgentCards: 5, assertPrivateLabelsHidden: true }
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
  if (state !== "empty") {
    await page.locator(".olympus-kanban").waitFor();
  }
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
    const smallControls = Array.from(pageEl.querySelectorAll("button, a"))
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
      badCopyPhrases,
      badLinks,
      evidenceSourcesVisible: renderedText.includes("Evidence Sources"),
      horizontalOverflow: Math.max(
        document.documentElement.scrollWidth - window.innerWidth,
        document.body.scrollWidth - window.innerWidth
      ),
      sectionCount: document.querySelectorAll(".olympus-section").length + document.querySelectorAll(".olympus-hero").length,
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
    await assertExpectedSections(page, scenario.expectedSections);
    await assertAbsentSections(page, scenario.absentSections);
    const metrics = await collectVisualMetrics(page);

    expect(messages).toEqual([]);
    expect(metrics.agentCards).toBeGreaterThanOrEqual(scenario.minAgentCards);
    expect(metrics.badCopyPhrases).toEqual([]);
    expect(metrics.evidenceSourcesVisible).toBe(true);
    expect(metrics.badLinks).toEqual([]);
    expect(metrics.horizontalOverflow).toBeLessThanOrEqual(2);
    expect(metrics.sectionCount).toBeGreaterThanOrEqual(scenario.expectedSections.length);
    expect(metrics.smallControls).toEqual([]);
    expect(metrics.svgTextCount).toBe(0);
    expect(metrics.tinyVisibleText).toEqual([]);
    if (metrics.viewport) expect(metrics.viewport.width).toBeGreaterThan(800);
    if (scenario.assertPrivateLabelsHidden) expect(metrics.privateLabelLeaks).toEqual([]);
  });

  test(`mobile ${scenario.name} viewport stacks without microscopic labels`, async ({ page }, testInfo) => {
    const messages = await openFixture(page, testInfo, { width: 390, height: 844 }, scenario.name);
    await assertExpectedSections(page, scenario.expectedSections);
    await assertAbsentSections(page, scenario.absentSections);
    const metrics = await collectVisualMetrics(page);

    expect(messages).toEqual([]);
    expect(metrics.agentCards).toBeGreaterThanOrEqual(scenario.minAgentCards);
    expect(metrics.badCopyPhrases).toEqual([]);
    expect(metrics.evidenceSourcesVisible).toBe(true);
    expect(metrics.badLinks).toEqual([]);
    expect(metrics.horizontalOverflow).toBeLessThanOrEqual(2);
    expect(metrics.sectionCount).toBeGreaterThanOrEqual(scenario.expectedSections.length);
    expect(metrics.smallControls).toEqual([]);
    expect(metrics.svgTextCount).toBe(0);
    expect(metrics.tinyVisibleText).toEqual([]);
    if (metrics.viewport) expect(metrics.viewport.width).toBeLessThanOrEqual(340);
    if (scenario.assertPrivateLabelsHidden) expect(metrics.privateLabelLeaks).toEqual([]);
  });
}
