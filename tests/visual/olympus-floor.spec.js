// The Floor: every agent at a fixed place in one frame, motion only from
// what Hermes recorded. These tests are the anti-slop contract from
// docs/superpowers/plans/2026-10-31-floor-view.md: nothing moves without a
// record behind it, nothing moves when nothing changed, flat styling,
// readable labels, stable places, reduced motion, a cheap frame. The
// popout in floor mode needs Document Picture-in-Picture, so that test
// serves the fixture from localhost as the glance spec does.
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

async function openFloor(page, params, size, base) {
  await page.setViewportSize(size);
  const errors = watch(page);
  await page.goto(`${base || fixtureBaseUrl}?${new URLSearchParams(Object.assign({ state: "noisy", view: "floor" }, params)).toString()}`);
  await page.locator(".olympus-floor-station").first().waitFor();
  return errors;
}

// The fixture answers /live once per poll; the floor's data-render counts
// its paints (the overview paint, then one per live read).
async function waitForRender(page, count) {
  await page.waitForFunction((n) => Number((document.querySelector(".olympus-floor") || {}).dataset?.render || 0) >= n, count, { timeout: 15000 });
}

const floorRules = () => Array.from(document.styleSheets)
  .flatMap((sheet) => Array.from(sheet.cssRules))
  // Every style rule carries an (empty) cssRules list since CSS nesting, so
  // keep the rule itself and add whatever a media or keyframes rule holds.
  .flatMap((rule) => (rule.cssRules && rule.cssRules.length ? [rule, ...Array.from(rule.cssRules)] : [rule]))
  .map((rule) => rule.cssText)
  .filter((text) => text.includes("olympus-floor"));

test.describe("Floor", () => {
  for (const size of [DESKTOP, MOBILE]) {
    test(`at ${size.width}px: one station per agent in name order, a status word on each, subagents joined to their node`, async ({ page }) => {
      const errors = await openFloor(page, {}, size);
      await waitForRender(page, 2);
      const stations = page.locator(".olympus-floor-station");
      const agents = await page.evaluate(() => window.__OLYMPUS_FIXTURE_DATA__.agents.agents.length);
      await expect(stations).toHaveCount(agents);
      await expect(page.locator(".olympus-floor-name")).toHaveText(["Analyst", "Coder", "Default", "Ops", "Researcher", "Reviewer", "Writer"]);
      await expect(page.locator(".olympus-floor-census")).toHaveText(/^\d+ need you · \d+ working · \d+ agents · \d+ subagents running$/);
      for (const station of await stations.all()) {
        expect(["Waiting on you", "Stalled", "Failed", "Offline", "Working", "Idle"]).toContain(await station.locator(".olympus-floor-state").innerText());
      }
      // Coder: waiting, with three subagents (one running, one done, one failed), each joined by a spoke.
      const coder = page.locator('.olympus-floor-station[data-agent="profile:coder"]');
      await expect(coder).toHaveAttribute("data-status", "waiting");
      await expect(coder.locator(".olympus-floor-text")).toHaveText(/^Deploy the preview build/);
      await expect(coder.locator(".olympus-floor-calls")).toHaveText("3 calls in the last minute, 1 failed");
      await expect(coder.locator(".olympus-floor-sat")).toHaveCount(3);
      await expect(coder.locator(".olympus-floor-sat-state")).toHaveText(["Done", "Failed", ""]);
      await expect(coder.locator(".olympus-floor-sat-running .olympus-floor-sat-tool")).toHaveText("terminal(npm test -- checkout)");
      await expect(coder.locator(".olympus-floor-sat-running .olympus-floor-sat-time")).toHaveText(/^for \d+ min$/);
      await expect(coder.locator("line.olympus-floor-spoke")).toHaveCount(3);
      await expect(coder.locator("line.olympus-floor-spoke-failed")).toHaveCount(1);
      // Default: working, with what it is on and for how long.
      const main = page.locator('.olympus-floor-station[data-agent="profile:default"]');
      await expect(main.locator(".olympus-floor-text")).toHaveText("Draft the weekly investor update");
      await expect(main.locator(".olympus-floor-since")).toHaveText(/^for \d+ min$/);
      // Idle says only that: no text, no calls line, no subagents.
      const analyst = page.locator('.olympus-floor-station[data-agent="profile:analyst"]');
      await expect(analyst.locator(".olympus-floor-now")).toBeHidden();
      await expect(analyst.locator(".olympus-floor-calls")).toBeHidden();
      await expect(analyst.locator(".olympus-floor-sat")).toHaveCount(0);
      // Readable: nothing on the floor is set under 12 px.
      const smallest = await page.locator(".olympus-floor *").evaluateAll((nodes) => Math.min(...nodes
        .filter((node) => node.textContent.trim() && getComputedStyle(node).display !== "none")
        .map((node) => parseFloat(getComputedStyle(node).fontSize))));
      expect(smallest).toBeGreaterThanOrEqual(12);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBe(0);
      if (size.width < 720) {
        const columns = await page.locator(".olympus-floor-stations").evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(" ").length);
        expect(columns).toBe(1);
      }
      // A node opens the inspector; a subagent opens that session's steps.
      await coder.locator(".olympus-floor-node").click();
      await expect(page.locator(".olympus-inspector")).toBeVisible();
      // At phone width the inspector covers the page, so Escape closes it first.
      await page.keyboard.press("Escape");
      await expect(page.locator(".olympus-inspector")).toHaveCount(0);
      await page.locator(".olympus-views .olympus-view-switch", { hasText: "Floor" }).click();
      await page.locator('.olympus-floor-station[data-agent="profile:coder"] .olympus-floor-sat-label').first().click();
      await expect(page.locator(".olympus-run-head")).toBeVisible();
      expect(errors).toEqual([]);
    });
  }

  test("nothing moves on first paint or when a read brings no change", async ({ page }) => {
    const errors = await openFloor(page, {}, DESKTOP);
    await waitForRender(page, 2);
    await expect(page.locator(".olympus-floor-pulse")).toHaveCount(0);
    await expect(page.locator(".olympus-floor-sat-new")).toHaveCount(0);
    await expect(page.locator(".olympus-floor-spoke-new")).toHaveCount(0);
    // The second live read carries the same runs, subagents and ticks.
    await waitForRender(page, 3);
    await expect(page.locator(".olympus-floor-pulse")).toHaveCount(0);
    await expect(page.locator(".olympus-floor-sat-new")).toHaveCount(0);
    // Stations and subagents kept their DOM nodes: no rebuild between reads.
    const same = await page.evaluate(() => {
      const first = document.querySelector(".olympus-floor-station");
      first.dataset.probe = "kept";
      return first.dataset.probe;
    });
    expect(same).toBe("kept");
    await waitForRender(page, 4);
    await expect(page.locator('.olympus-floor-station[data-probe="kept"]')).toHaveCount(1);
    // Idle, done and offline never animate; only the working pill dot, the running subagent dot and the waiting ring loop.
    const looping = await page.locator(".olympus-floor *").evaluateAll((nodes) => nodes
      .filter((node) => getComputedStyle(node).animationName !== "none" && getComputedStyle(node).animationIterationCount === "infinite")
      .map((node) => node.className.baseVal === undefined ? node.className : node.className.baseVal));
    expect(looping.every((cls) => /olympus-status-dot|olympus-floor-ring|olympus-floor-sat-dot/.test(cls))).toBe(true);
    expect(looping.length).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });

  test("a tool call pulses once from its agent's node, a failed one in the failure colour; a new subagent enters from the node as its spoke draws", async ({ page }) => {
    const errors = await openFloor(page, { calls: "1", grow: "1" }, DESKTOP);
    await waitForRender(page, 2);
    await expect(page.locator(".olympus-floor-pulse")).toHaveCount(0);
    // The second read adds two ticks (one failed) and one subagent to Coder's run.
    await waitForRender(page, 3);
    const coder = page.locator('.olympus-floor-station[data-agent="profile:coder"]');
    const pulses = coder.locator(".olympus-floor-pulse");
    await expect(pulses).toHaveCount(2);
    await expect(coder.locator(".olympus-floor-pulse-error")).toHaveCount(1);
    // Every pulse is one recorded call, stamped with Hermes' time for it.
    const stamps = await pulses.evaluateAll((nodes) => nodes.map((node) => node.dataset.at));
    expect(stamps.every((at) => /^\d{4}-\d{2}-\d{2}T/.test(at))).toBe(true);
    expect(await pulses.first().evaluate((node) => getComputedStyle(node).animationName)).toBe("olympus-floor-pulse");
    await expect(coder.locator(".olympus-floor-calls")).toHaveText("5 calls in the last minute, 2 failed");
    const fresh = coder.locator(".olympus-floor-sat-new");
    await expect(fresh).toHaveCount(1);
    await expect(fresh.locator(".olympus-floor-sat-label")).toHaveText("Draft the cover note");
    expect(await fresh.evaluate((node) => getComputedStyle(node).animationName)).toBe("olympus-floor-enter");
    await expect(coder.locator("line.olympus-floor-spoke-new")).toHaveCount(1);
    await expect(page.locator(".olympus-floor-pulse")).toHaveCount(2);
    // Pulses leave the DOM when they end; the others never pulsed.
    await expect(page.locator(".olympus-floor-pulse")).toHaveCount(0, { timeout: 5000 });
    expect(errors).toEqual([]);
  });

  test("a subagent that finishes keeps its slot and turns Done; its row never re-enters", async ({ page }) => {
    const errors = await openFloor(page, { finish: "1" }, DESKTOP);
    await waitForRender(page, 2);
    const coder = page.locator('.olympus-floor-station[data-agent="profile:coder"]');
    const order = await coder.locator(".olympus-floor-sat").evaluateAll((nodes) => nodes.map((node) => node.dataset.ref));
    await expect(coder.locator(".olympus-floor-sat-running")).toHaveCount(1);
    await waitForRender(page, 4);
    await expect(coder.locator(".olympus-floor-sat-running")).toHaveCount(0);
    await expect(coder.locator(".olympus-floor-sat-done")).toHaveCount(2);
    expect(await coder.locator(".olympus-floor-sat").evaluateAll((nodes) => nodes.map((node) => node.dataset.ref))).toEqual(order);
    await expect(coder.locator(".olympus-floor-sat-new")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("flat: no shadow, filter, gradient or blur anywhere on the floor, and colour only for attention", async ({ page }) => {
    // Stylesheet rules are readable only same-origin, so this one runs over localhost.
    await openFloor(page, {}, DESKTOP, origin + FIXTURE);
    await page.waitForLoadState("load");
    const rules = await page.evaluate(floorRules);
    expect(rules.length).toBeGreaterThan(20);
    for (const rule of rules) {
      expect(rule).not.toMatch(/box-shadow|filter|gradient|blur/);
    }
    // A working station carries no colour on its ring; waiting and failed do.
    const ring = (id) => page.locator(`.olympus-floor-station[data-agent="${id}"] .olympus-floor-ring`).evaluate((node) => getComputedStyle(node).borderTopColor);
    expect(await ring("profile:default")).toBe("rgba(0, 0, 0, 0)");
    expect(await ring("profile:coder")).not.toBe("rgba(0, 0, 0, 0)");
    expect(await ring("profile:writer")).not.toBe("rgba(0, 0, 0, 0)");
    expect(await ring("profile:writer")).not.toBe(await ring("profile:coder"));
  });

  test("reduced motion: no pulse, no entrance, no breathing ring; state still changes", async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce", viewport: DESKTOP });
    const page = await context.newPage();
    const errors = await openFloor(page, { calls: "1", grow: "1" }, DESKTOP);
    await waitForRender(page, 3);
    const coder = page.locator('.olympus-floor-station[data-agent="profile:coder"]');
    await expect(coder.locator(".olympus-floor-sat")).toHaveCount(4);
    expect(await coder.locator(".olympus-floor-ring").evaluate((node) => getComputedStyle(node).animationName)).toBe("none");
    expect(await coder.locator(".olympus-floor-sat-new").first().evaluate((node) => getComputedStyle(node).animationName)).toBe("none");
    expect(await coder.locator(".olympus-floor-pulse").evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).display))).not.toContain("block");
    await expect(coder.locator(".olympus-floor-calls")).toHaveText("5 calls in the last minute, 2 failed");
    expect(errors).toEqual([]);
    await context.close();
  });

  test("at scale: fourteen working agents and forty-one subagents render in one cheap frame at both widths", async ({ page }) => {
    for (const size of [DESKTOP, MOBILE]) {
      // Twelve extra agents, fourteen of the nineteen with a run of three subagents.
      await openFloor(page, { agents: "12", lanes: "14" }, size);
      await waitForRender(page, 2);
      await expect(page.locator(".olympus-floor-station")).toHaveCount(19);
      expect(await page.locator(".olympus-floor-sat").count()).toBeGreaterThanOrEqual(41);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBe(0);
      // A read with no change costs nothing visible: measure a full re-render of the same model.
      const ms = await page.evaluate(() => {
        const host = document.querySelector(".olympus-floor-host");
        const t0 = performance.now();
        host.dispatchEvent(new Event("resize"));
        window.dispatchEvent(new Event("resize"));
        return performance.now() - t0;
      });
      expect(ms).toBeLessThan(50);
    }
  });
});

test.describe("Floor in the popout", () => {
  test("the popout switches to the floor, keeps it between reads, and a subagent there opens its run in the tab", async ({ page, context }) => {
    await page.setViewportSize(DESKTOP);
    const errors = watch(page);
    await page.goto(`${origin}${FIXTURE}?${new URLSearchParams({ state: "noisy", view: "live", grow: "1" }).toString()}`);
    await page.locator(".olympus-popout").waitFor();
    const opened = context.waitForEvent("page");
    await page.locator(".olympus-popout").click();
    const popout = await opened;
    await popout.setViewportSize({ width: 340, height: 480 });
    const popErrors = watch(popout);
    await expect(popout.locator(".olympus-glance-row").first()).toBeVisible();
    await popout.locator(".olympus-glance-mode[data-mode='floor']").click();
    const stations = popout.locator(".olympus-floor-station");
    await expect(stations).toHaveCount(7);
    await expect(popout.locator(".olympus-glance-mode[data-mode='floor']")).toHaveAttribute("aria-pressed", "true");
    // Compact: three subagents per station and a count for the rest.
    const coder = popout.locator('.olympus-floor-station[data-agent="profile:coder"]');
    await expect(coder.locator(".olympus-floor-sat")).toHaveCount(3);
    await popout.waitForFunction(() => Number(document.querySelector(".olympus-floor").dataset.render) >= 3, null, { timeout: 15000 });
    await expect(coder.locator(".olympus-floor-more")).toHaveText("+1 more subagent");
    // The floor's own census line stays hidden behind the glance's.
    await expect(popout.locator(".olympus-floor-census")).toBeHidden();
    await expect(popout.locator(".olympus-glance-census")).toHaveText(/\d+ need you · \d+ working · \d+ agents/);
    const overflow = await popout.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBe(0);
    await popout.screenshot({ path: path.join(ROOT, "test-results", "floor-popout.png") });
    // Back to the list, then the floor again, and still no errors.
    await popout.locator(".olympus-glance-mode[data-mode='list']").click();
    await expect(popout.locator(".olympus-glance-row")).toHaveCount(7);
    await popout.locator(".olympus-glance-mode[data-mode='floor']").click();
    await expect(stations).toHaveCount(7);
    // A subagent in the popout opens that session's steps in the tab.
    await coder.locator(".olympus-floor-sat-label").first().click();
    await expect(page.locator(".olympus-run-head")).toBeVisible();
    await page.locator(".olympus-popout").click();
    expect(errors).toEqual([]);
    expect(popErrors).toEqual([]);
  });
});
