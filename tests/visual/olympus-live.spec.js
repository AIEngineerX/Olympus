const path = require("path");
const { pathToFileURL } = require("url");
const { expect, test } = require("@playwright/test");

const fixtureBaseUrl = pathToFileURL(path.join(__dirname, "../fixtures/olympus-fixture.html")).href;
const DESKTOP = { width: 1280, height: 720 };
const MOBILE = { width: 390, height: 844 };

function fixtureUrl(params) {
  return `${fixtureBaseUrl}?${new URLSearchParams(params).toString()}`;
}

async function openLive(page, params, size) {
  await page.setViewportSize(size);
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(fixtureUrl(Object.assign({ view: "live" }, params)));
  await page.locator(".olympus-live").waitFor();
  return errors;
}

test.describe("Live view", () => {
  for (const size of [DESKTOP, MOBILE]) {
    test(`at ${size.width}px: one lane per working agent, subagents under their run, idle agents folded`, async ({ page }, testInfo) => {
      const errors = await openLive(page, { state: "noisy" }, size);
      await expect(page.locator(".olympus-lane")).toHaveCount(2);
      await expect(page.locator(".olympus-live-head .olympus-census")).toHaveText("2 agents running · 2 runs · 2 subagents running");

      const coder = page.locator('.olympus-lane[data-agent="profile:coder"]');
      await expect(coder.locator(".olympus-lane-run")).toHaveCount(1);
      await expect(coder.locator(".olympus-lane-source")).toHaveText("Kanban");
      await expect(coder.locator(".olympus-lane-run-row .olympus-lane-label")).toHaveText("Fix flaky checkout test");
      await expect(coder.locator(".olympus-lane-child")).toHaveCount(3);
      await expect(coder.locator(".olympus-lane-child .olympus-lane-status")).toHaveText(["Done", "Failed", "Running"]);
      await expect(coder.locator(".olympus-lane-child-running .olympus-lane-tool")).toHaveText("terminal(npm test -- checkout)");
      await expect(coder.locator(".olympus-lane-child-running .olympus-lane-time")).toHaveText(/^for \d+ min$/);
      await expect(coder.locator(".olympus-lane-child-failed .olympus-lane-note")).toHaveText("1 failed call");
      await expect(coder.locator(".olympus-lane-batch")).toHaveText("Tasks done 1 of 3, 1 failed");
      // The lane header carries the roster's status, so Waiting on you still shows here.
      await expect(coder.locator(".olympus-lane-head .olympus-status")).toHaveText("Waiting on you");

      await expect(page.locator(".olympus-live-idle")).toHaveText("Idle: Analyst, Ops, Researcher, Reviewer, Writer");

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBe(0);
      if (size.width < 720) await expect(page.locator(".olympus-lane-strip").first()).toBeHidden();
      else await expect(page.locator(".olympus-lane-strip").first()).toBeVisible();
      expect(errors).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath(`live-${size.width}.png`), fullPage: true });
    });
  }

  test("the activity strip shows the last minute's calls, failed ones marked", async ({ page }) => {
    await openLive(page, { state: "noisy" }, DESKTOP);
    const strip = page.locator('.olympus-lane[data-agent="profile:coder"] .olympus-lane-strip');
    await expect(strip).toHaveAttribute("aria-label", "3 tool calls in the last minute, 1 failed");
    await expect(strip.locator(".olympus-lane-tick")).toHaveCount(3);
    await expect(strip.locator(".olympus-lane-tick-error")).toHaveCount(1);
    // Ticks sit inside the strip: older calls further left, none past the right edge.
    const offsets = await strip.locator(".olympus-lane-tick").evaluateAll((ticks) =>
      ticks.map((tick) => Math.abs(Number(tick.style.transform.match(/-?[\d.]+/)[0]))));
    for (const offset of offsets) {
      expect(offset).toBeGreaterThan(0);
      expect(offset).toBeLessThanOrEqual(120);
    }
  });

  test("hidden labels: no titles, goals, tool arguments or raw ids", async ({ page }) => {
    await openLive(page, { state: "no-labels" }, DESKTOP);
    const text = await page.locator(".olympus-live").innerText();
    for (const phrase of ["Fix flaky", "Patch the retry", "Collect revenue", "npm test", "reports/churn", "coder-kanban", "live-main", "deleg_"]) {
      expect(text).not.toContain(phrase);
    }
    await expect(page.locator(".olympus-lane-child-running .olympus-lane-tool").last()).toHaveText("terminal");
    await expect(page.locator(".olympus-lane-batch").last()).toHaveText("Tasks done 1 of 3, 1 failed");
  });

  test("the lane name opens the agent's inspector on the Agents view", async ({ page }) => {
    await openLive(page, { state: "noisy" }, DESKTOP);
    await page.locator('.olympus-lane[data-agent="profile:coder"] .olympus-lane-name').click();
    await expect(page.locator(".olympus-inspector")).toBeVisible();
    await expect(page.locator(".olympus-inspector")).toContainText("Coder");
    await expect(page.locator(".olympus-view-current")).toHaveText("Agents");
  });

  test("a fresh install says nothing is running", async ({ page }) => {
    await openLive(page, { state: "empty" }, DESKTOP);
    await expect(page.locator(".olympus-lane")).toHaveCount(0);
    await expect(page.locator(".olympus-live-empty")).toHaveText("Nothing is running. A run shows here within 5 s of starting.");
  });

  test("reduced motion turns every animation and transition off", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openLive(page, { state: "noisy" }, DESKTOP);
    const motion = await page.evaluate(() => {
      const names = (selector, pseudo) => Array.from(document.querySelectorAll(selector)).map((node) => {
        const style = getComputedStyle(node, pseudo);
        return [style.animationName, style.transitionProperty];
      });
      return names(".olympus-lane-child").concat(names(".olympus-lane-child", "::before"), names(".olympus-lane-tool"), names(".olympus-lane-tick"), names(".olympus-lane-dot-running"));
    });
    for (const [animation, transition] of motion) {
      expect(animation).toBe("none");
      expect(transition === "none" || transition === "all").toBe(true);
    }
  });

  test("polls again every five seconds, one request at a time", async ({ page }) => {
    await page.clock.install();
    await openLive(page, { state: "noisy" }, DESKTOP);
    const count = () => page.evaluate(() => window.__OLYMPUS_FETCH_LOG__.started);
    const first = await count();
    await page.clock.runFor(5_200);
    const second = await count();
    expect(second).toBeGreaterThan(first);
    const peak = await page.evaluate(() => window.__OLYMPUS_FETCH_LOG__.peak);
    expect(peak).toBeLessThanOrEqual(2); // the overview poll and the live poll may overlap, never two live polls
  });
});
