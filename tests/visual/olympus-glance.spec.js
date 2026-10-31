// The glance popout: the roster in one small always-on-top window.
// Document Picture-in-Picture needs a secure context, so the popout tests
// serve the fixture from a localhost server; the in-tab ?view=glance tests
// use the file fixture like every other spec.
const fs = require("fs");
const http = require("http");
const path = require("path");
const { pathToFileURL } = require("url");
const { expect, test } = require("@playwright/test");

const ROOT = path.join(__dirname, "../..");
const FIXTURE = "/tests/fixtures/olympus-fixture.html";
const fixtureBaseUrl = pathToFileURL(path.join(ROOT, FIXTURE)).href;
const DESKTOP = { width: 1280, height: 720 };
const MOBILE = { width: 390, height: 844 };
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml" };

let server;
let origin;

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const file = path.join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

function watch(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  return errors;
}

async function openFixture(page, base, params, size) {
  await page.setViewportSize(size);
  const errors = watch(page);
  await page.goto(`${base}?${new URLSearchParams(params).toString()}`);
  await page.locator(".olympus-header").waitFor();
  return errors;
}

test.describe("Glance view in the tab", () => {
  for (const size of [DESKTOP, MOBILE]) {
    test(`at ${size.width}px: one line per agent, the ones that need you first, a status word on every row`, async ({ page }) => {
      const errors = await openFixture(page, fixtureBaseUrl, { state: "noisy", view: "glance" }, size);
      const rows = page.locator(".olympus-glance-row");
      const agents = await page.evaluate(() => window.__OLYMPUS_FIXTURE_DATA__.agents.agents.length);
      await expect(rows).toHaveCount(agents);
      // Same order as the roster: waiting, stalled, failed, offline, working, idle.
      const states = await page.locator(".olympus-glance-row").evaluateAll((nodes) => nodes.map((node) => node.dataset.status));
      const order = ["waiting", "stalled", "failed", "offline", "working", "idle", "unknown"];
      expect(states.map((state) => order.indexOf(state))).toEqual(states.map((state) => order.indexOf(state)).slice().sort((a, b) => a - b));
      // Every row carries its status as a word, never colour alone.
      for (const row of await rows.all()) {
        const text = await row.locator(".olympus-glance-state").innerText();
        expect(["Waiting on you", "Stalled", "Failed", "Offline", "Working", "Idle"]).toContain(text);
      }
      // A working agent says what it is on and for how long, with its subagents.
      const working = page.locator('.olympus-glance-row[data-agent="profile:default"]');
      await expect(working.locator(".olympus-glance-state")).toHaveText("Working");
      await expect(working.locator(".olympus-glance-text")).toHaveText("Draft the weekly investor update · 1 subagent");
      await expect(working.locator(".olympus-glance-since")).toHaveText(/for \d+ (s|min|h|d)/);
      // One waiting on an answer says how long; one held back for another reason says the reason, with no time.
      await expect(page.locator('.olympus-glance-row[data-agent="profile:researcher"] .olympus-glance-since')).toHaveText(/for \d+ (s|min|h|d)/);
      const coder = page.locator('.olympus-glance-row[data-agent="profile:coder"]');
      await expect(coder.locator(".olympus-glance-state")).toHaveText("Waiting on you");
      await expect(coder.locator(".olympus-glance-text")).toHaveText(/^Deploy the preview build .* · 1 subagent$/);
      await expect(coder.locator(".olympus-glance-since")).toHaveText("");
      // Idle says only that.
      await expect(page.locator('.olympus-glance-row[data-agent="profile:analyst"] .olympus-glance-text')).toHaveCount(0);
      await expect(page.locator(".olympus-glance-census")).toHaveText(/\d+ needs? you · \d+ working · \d+ agents/);
      // The glance is the whole page here: no view switch, no popout button.
      await expect(page.locator(".olympus-views")).toHaveCount(0);
      await expect(page.locator(".olympus-popout")).toHaveCount(0);
      // Nothing overflows the viewport.
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBe(0);
      // A row opens that agent in the roster.
      await page.locator('.olympus-glance-row[data-agent="profile:coder"]').click();
      await expect(page.locator(".olympus-inspector")).toBeVisible();
      expect(errors).toEqual([]);
    });
  }
});

test.describe("Pop out", () => {
  test("opens an always-on-top window with the same rows and theme, and the button closes it", async ({ page, context }) => {
    const errors = await openFixture(page, origin + FIXTURE, { state: "noisy", view: "live" }, DESKTOP);
    expect(await page.evaluate(() => "documentPictureInPicture" in window)).toBe(true);
    const button = page.locator(".olympus-popout");
    await expect(button).toHaveText("Pop out");
    const opened = context.waitForEvent("page");
    await button.click();
    const popout = await opened;
    await popout.setViewportSize({ width: 340, height: 480 });
    const popErrors = watch(popout);
    const rows = popout.locator(".olympus-glance-row");
    const agents = await page.evaluate(() => window.__OLYMPUS_FIXTURE_DATA__.agents.agents.length);
    await expect(rows).toHaveCount(agents);
    await expect(button).toHaveText("Close popout");
    await expect(button).toHaveAttribute("aria-pressed", "true");

    // Native in the Hermes theme: the popout resolves the same tokens as the tab.
    const theme = (p) => p.evaluate(() => {
      const css = getComputedStyle(document.documentElement);
      const row = document.querySelector(".olympus-glance-row, .olympus-lane");
      return { card: css.getPropertyValue("--color-card").trim(), fg: getComputedStyle(row).color, font: getComputedStyle(row).fontFamily };
    });
    expect(await theme(popout)).toEqual(await theme(page));
    const waitingDot = popout.locator('.olympus-glance-row[data-status="waiting"] .olympus-glance-dot').first();
    const warning = await page.evaluate(() => getComputedStyle(document.querySelector(".olympus-status-waiting .olympus-status-dot")).backgroundColor);
    expect(await waitingDot.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe(warning);
    await expect(popout.locator(".olympus-glance-census")).toHaveText(/\d+ needs? you · \d+ working · \d+ agents/);
    await popout.screenshot({ path: "test-results/glance-popout.png" });

    // A row in the popout opens that agent in the tab.
    await rows.filter({ hasText: "Coder" }).first().click();
    await expect(page.locator(".olympus-inspector")).toBeVisible();
    await expect(page.locator(".olympus-inspector")).toContainText("Coder");

    // The next overview read (10 s) redraws the popout without losing it.
    await expect(popout.locator(".olympus-glance")).toHaveAttribute("data-render", /^[2-9]/, { timeout: 15000 });
    await expect(rows).toHaveCount(agents);

    await button.click();
    await expect(button).toHaveText("Pop out");
    await expect.poll(() => popout.isClosed()).toBe(true);
    expect(errors).toEqual([]);
    expect(popErrors).toEqual([]);
  });

  test("without Document Picture-in-Picture the button opens a popup of the glance view", async ({ page, context }) => {
    await page.addInitScript(() => { Object.defineProperty(window, "documentPictureInPicture", { value: undefined, configurable: true }); });
    const errors = await openFixture(page, origin + FIXTURE, { state: "noisy" }, DESKTOP);
    const opened = context.waitForEvent("page");
    await page.locator(".olympus-popout").click();
    const popup = await opened;
    await popup.waitForLoadState();
    expect(new URL(popup.url()).searchParams.get("view")).toBe("glance");
    const agents = await page.evaluate(() => window.__OLYMPUS_FIXTURE_DATA__.agents.agents.length);
    await expect(popup.locator(".olympus-glance-row")).toHaveCount(agents);
    await expect(popup.locator(".olympus-popout")).toHaveCount(0);
    // A row in the popup opens that agent in the tab that opened it.
    await popup.locator('.olympus-glance-row[data-agent="profile:coder"]').click();
    await expect(page.locator(".olympus-inspector")).toBeVisible();
    await expect(page.locator(".olympus-inspector")).toContainText("Coder");
    await expect(popup.locator(".olympus-glance-row")).toHaveCount(agents);
    expect(errors).toEqual([]);
  });
});
