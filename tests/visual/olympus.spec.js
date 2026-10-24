const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { expect, test } = require("@playwright/test");

const fixtureBaseUrl = pathToFileURL(path.join(__dirname, "../fixtures/olympus-fixture.html")).href;

const DESKTOP = { width: 1280, height: 720 };
const MOBILE = { width: 390, height: 844 };
const bannedCopyPhrases = [
  "opportunity",
  "opportunities",
  "Agent HQ",
  "Party View",
  "Trace Spine",
  "Metrics Spine",
  "bare profiles",
  "forced-skill",
  "seamless",
  "supercharge",
  "world-class",
  "next-generation",
  "cutting-edge"
];
// Names, titles and refs the seeded team uses; none may show when labels are hidden.
const privateLabelPhrases = [
  "Researcher",
  "Reviewer",
  "Writer",
  "Analyst",
  "pricing study",
  "Publish changelog",
  "Telegram delivery",
  "investor update",
  "Coordinates the team",
  "job-changelog",
  "t-pricing"
];
const allowedHermesRoutes = ["/analytics", "/config", "/cron", "/kanban", "/logs", "/profiles", "/sessions", "/skills"];

const scenarios = [
  { name: "noisy", agents: 7, queue: 8 },
  { name: "no-labels", agents: 7, queue: 8, privateLabelsHidden: true },
  { name: "empty", agents: 1, queue: 0 }
];

function fixtureUrl(params) {
  return `${fixtureBaseUrl}?${new URLSearchParams(params).toString()}`;
}

async function openFixture(page, testInfo, size, params) {
  const messages = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") messages.push(msg.text());
  });
  page.on("pageerror", (error) => messages.push(error.message));
  await page.setViewportSize(size);
  await page.goto(fixtureUrl(params));
  await page.locator(".olympus-page").waitFor();
  await page.locator(".olympus-census").filter({ hasText: /agent/i }).waitFor();
  await page.screenshot({
    path: testInfo.outputPath(`olympus-${Object.values(params).join("-")}-${size.width}x${size.height}.png`),
    fullPage: true
  });
  return messages;
}

async function collectVisualMetrics(page, minTarget) {
  return page.evaluate(({ bannedPhrases, privatePhrases, allowedRoutes, minTarget }) => {
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const pageEl = document.querySelector(".olympus-page");
    const renderedText = pageEl.innerText || "";
    return {
      badCopyPhrases: bannedPhrases.filter((phrase) => new RegExp("\\b" + phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i").test(renderedText)),
      emDashes: (renderedText.match(/—/g) || []).length,
      badLinks: Array.from(pageEl.querySelectorAll("a"))
        .filter(visible)
        .map((el) => ({ href: el.getAttribute("href") || "", text: (el.textContent || "").trim() }))
        .filter((item) => {
          const route = item.href.split(/[?#]/)[0];
          return !item.href || item.href === "#" || item.href.startsWith("javascript:") || item.text.length < 4 ||
            (route.startsWith("/") && !allowedRoutes.includes(route));
        }),
      smallControls: Array.from(pageEl.querySelectorAll("button, a, summary"))
        .filter(visible)
        .map((el) => {
          const rect = el.getBoundingClientRect();
          return { text: (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 60), width: Math.round(rect.width), height: Math.round(rect.height) };
        })
        .filter((item) => item.height < minTarget || item.width < 24),
      tinyVisibleText: Array.from(pageEl.querySelectorAll("*"))
        .filter((el) => (el.textContent || "").trim() && visible(el) && Number.parseFloat(window.getComputedStyle(el).fontSize || "0") < 11)
        .map((el) => (el.textContent || "").trim().slice(0, 60)),
      horizontalOverflow: Math.max(document.documentElement.scrollWidth - window.innerWidth, document.body.scrollWidth - window.innerWidth),
      clippedCells: Array.from(pageEl.querySelectorAll(".olympus-roster td, .olympus-queue-title, .olympus-step-text"))
        .filter(visible)
        .filter((el) => el.scrollWidth > el.clientWidth + 1 && !el.querySelector(".olympus-now-label, small"))
        .map((el) => (el.textContent || "").trim().slice(0, 60)),
      svgTextCount: pageEl.querySelectorAll("svg text").length,
      gradients: Array.from(pageEl.querySelectorAll("*")).filter((el) => /gradient/.test(window.getComputedStyle(el).backgroundImage)).length,
      shadows: Array.from(pageEl.querySelectorAll("*")).filter((el) => window.getComputedStyle(el).boxShadow !== "none").length,
      privateLabelLeaks: [
        ...Array.from(renderedText.matchAll(/(?:\/Users\/|\\Users\\|\.hermes|kanban\/boards|state\.db|gateway\.pid)/gi)).map((m) => m[0]),
        ...privatePhrases.filter((phrase) => renderedText.includes(phrase))
      ]
    };
  }, { bannedPhrases: bannedCopyPhrases, privatePhrases: privateLabelPhrases, allowedRoutes: allowedHermesRoutes, minTarget });
}

function expectClean(metrics, messages, scenario) {
  expect(messages).toEqual([]);
  expect(metrics.badCopyPhrases).toEqual([]);
  expect(metrics.emDashes).toBe(0);
  expect(metrics.badLinks).toEqual([]);
  expect(metrics.smallControls).toEqual([]);
  expect(metrics.tinyVisibleText).toEqual([]);
  expect(metrics.horizontalOverflow).toBeLessThanOrEqual(2);
  expect(metrics.svgTextCount).toBe(0);
  expect(metrics.gradients).toBe(0);
  expect(metrics.shadows).toBe(0);
  if (scenario.privateLabelsHidden) expect(metrics.privateLabelLeaks).toEqual([]);
}

for (const scenario of scenarios) {
  test(`desktop ${scenario.name}: roster, queue and inspector are readable and console-clean`, async ({ page }, testInfo) => {
    const messages = await openFixture(page, testInfo, DESKTOP, { state: scenario.name });

    await expect(page.locator(".olympus-roster tbody tr")).toHaveCount(scenario.agents);
    await expect(page.locator(".olympus-banner .olympus-queue-item")).toHaveCount(Math.min(3, scenario.queue));
    if (!scenario.queue) await expect(page.locator(".olympus-banner")).toHaveCount(0);
    expectClean(await collectVisualMetrics(page, 24), messages, scenario);
    expect((await collectVisualMetrics(page, 24)).clippedCells).toEqual([]);

    await page.locator(".olympus-roster tbody tr").first().click();
    await expect(page.locator(".olympus-inspector h2")).toBeVisible();
    await expect(page.locator(".olympus-inspector-section").first()).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`olympus-${scenario.name}-inspector.png`), fullPage: true });
    expectClean(await collectVisualMetrics(page, 24), messages, scenario);
  });

  test(`mobile ${scenario.name}: agents stack as cards and the inspector fills the screen`, async ({ page }, testInfo) => {
    const messages = await openFixture(page, testInfo, MOBILE, { state: scenario.name });

    const firstRow = page.locator(".olympus-roster tbody tr").first();
    await expect(firstRow).toHaveCSS("display", "grid");
    expectClean(await collectVisualMetrics(page, 32), messages, scenario);

    await firstRow.click();
    const inspector = page.locator(".olympus-inspector");
    await expect(inspector).toHaveCSS("position", "fixed");
    const box = await inspector.boundingBox();
    expect(Math.round(box.width)).toBeGreaterThanOrEqual(MOBILE.width - 20);
    await page.screenshot({ path: testInfo.outputPath(`olympus-${scenario.name}-mobile-inspector.png`) });
    await page.getByRole("button", { name: "Back to agents" }).click();
    await expect(inspector).toHaveCount(0);
    expectClean(await collectVisualMetrics(page, 32), messages, scenario);
  });
}

for (const size of [DESKTOP, MOBILE]) {
  test(`checks view at ${size.width}px reads as lists, not tiles`, async ({ page }, testInfo) => {
    const messages = await openFixture(page, testInfo, size, { state: "noisy", view: "checks" });

    for (const title of ["Findings", "Backlog", "Skills", "Policy", "Where spend goes"]) {
      await expect(page.getByRole("heading", { level: 2, name: title, exact: true })).toBeVisible();
    }
    await expect(page.getByRole("heading", { level: 2, name: /^Readiness \d+/ })).toBeVisible();
    await page.locator(".olympus-debug > summary").click();
    await expect(page.locator(".olympus-debug")).toContainText("Scan built in");
    expectClean(await collectVisualMetrics(page, size === MOBILE ? 32 : 24), messages, { name: "checks" });
  });
}

test("every custom property the stylesheet uses resolves under Hermes' token set", async ({ page }, testInfo) => {
  const messages = await openFixture(page, testInfo, DESKTOP, { state: "noisy", agent: "profile:default" });
  await expect(page.locator(".olympus-token-chart")).toBeVisible();
  // var(--x) without a fallback; the fixture defines exactly the tokens the
  // live dashboard does, so anything unresolved here is unresolved in Hermes.
  const css = fs.readFileSync(path.join(__dirname, "../../dashboard/dist/style.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const used = Array.from(new Set(Array.from(css.matchAll(/var\((--[\w-]+)\)/g), (match) => match[1])));
  const report = await page.evaluate((names) => {
    const pageStyle = window.getComputedStyle(document.querySelector(".olympus-page"));
    const avatar = window.getComputedStyle(document.querySelector(".olympus-avatar"));
    const missing = names.filter((name) => !pageStyle.getPropertyValue(name).trim() && !avatar.getPropertyValue(name).trim());
    const paint = (selector) => window.getComputedStyle(document.querySelector(selector)).backgroundColor;
    return {
      used: names.length,
      missing,
      today: paint(".olympus-activity-today"),
      output: paint(".olympus-token-stack .olympus-series-output"),
      input: paint(".olympus-token-stack .olympus-series-input")
    };
  }, used);
  expect(report.used).toBeGreaterThan(10);
  expect(report.missing).toEqual([]);
  for (const color of [report.today, report.output, report.input]) expect(color).not.toBe("rgba(0, 0, 0, 0)");
  expect(messages).toEqual([]);
});

test("the page follows a light Hermes theme", async ({ page }, testInfo) => {
  const messages = await openFixture(page, testInfo, DESKTOP, { state: "noisy", theme: "light" });
  const colors = await page.evaluate(() => {
    const css = (selector, prop) => window.getComputedStyle(document.querySelector(selector))[prop];
    return { text: css(".olympus-page", "color"), body: css("body", "backgroundColor") };
  });
  expect(colors.text).toBe("rgb(23, 13, 2)");
  expect(colors.body).toBe("rgb(232, 242, 253)");
  expect(messages).toEqual([]);
});

test("with the backend off, Olympus lists the agents and says how to enable it", async ({ page }, testInfo) => {
  const messages = await openFixture(page, testInfo, DESKTOP, { state: "static-user-plugin" });

  const notice = page.locator(".olympus-backend-off");
  await expect(notice).toContainText("The Olympus backend is not running");
  await expect(notice).toContainText("hermes plugins enable olympus");
  await expect(page.locator(".olympus-static-roster li")).toHaveCount(3);
  await expect(page.locator(".olympus-static-roster")).not.toContainText("vulcan");
  await expect(page.locator(".olympus-banner")).toHaveCount(0);
  expect(messages).toEqual([]);
});
