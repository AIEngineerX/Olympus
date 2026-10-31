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
      // Coder has a failed subagent, so its lane comes before Default's.
      await expect(page.locator(".olympus-lane-name")).toHaveText(["Coder", "Default"]);
      await expect(page.locator(".olympus-live-head")).toHaveText("2 runs open on 2 agents · 2 subagents running");
      // The Hermes header already carries "Updated … ago"; the view does not repeat it.
      await expect(page.locator(".olympus-live")).not.toContainText("Updated");

      const coder = page.locator('.olympus-lane[data-agent="profile:coder"]');
      await expect(coder.locator(".olympus-lane-run")).toHaveCount(1);
      await expect(coder.locator(".olympus-lane-source")).toHaveText("Kanban");
      await expect(coder.locator(".olympus-lane-run-row .olympus-lane-label")).toHaveText("Fix flaky checkout test");
      // The running subagent is a row; the two finished ones fold under the batch line until opened.
      await expect(coder.locator(".olympus-lane-child")).toHaveCount(3);
      await expect(coder.locator(".olympus-lane-child .olympus-lane-status")).toHaveText(["Running", "Done", "Failed"]);
      await expect(coder.locator(".olympus-lane-child-running")).toBeVisible();
      await expect(coder.locator(".olympus-lane-child-done")).toBeHidden();
      await expect(coder.locator(".olympus-lane-child-failed")).toBeHidden();
      await expect(coder.locator(".olympus-lane-child-running .olympus-lane-tool")).toHaveText("terminal(npm test -- checkout)");
      await expect(coder.locator(".olympus-lane-child-running .olympus-lane-time")).toHaveText(/^for \d+ min$/);
      await expect(coder.locator("summary.olympus-lane-batch")).toHaveText("Tasks done 1 of 3, 1 failed");
      await expect(coder.locator(".olympus-lane-fold-failed")).toHaveText("1 failed");
      await coder.locator("summary.olympus-lane-batch").click();
      await expect(coder.locator(".olympus-lane-child-done")).toBeVisible();
      await expect(coder.locator(".olympus-lane-child-failed .olympus-lane-note")).toHaveText("1 failed call");
      // A run with every subagent still running keeps a plain batch line.
      await expect(page.locator('.olympus-lane[data-agent="profile:default"] .olympus-lane-batch')).toHaveText("Tasks done 1 of 2");
      // The lane header carries the roster's status, so Waiting on you still shows here.
      await expect(coder.locator(".olympus-lane-head .olympus-status")).toHaveText("Waiting on you");

      // Agents without a run keep their roster status, so none reads as calm when it is not.
      await expect(page.locator(".olympus-live-idle")).toHaveText("No open runs: Analyst, Ops (Offline), Researcher (Waiting on you), Reviewer (Stalled), Writer (Failed)");

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBe(0);
      if (size.width < 720) await expect(page.locator(".olympus-lane-strip-cell").first()).toBeHidden();
      else await expect(page.locator(".olympus-lane-strip-cell").first()).toBeVisible();
      expect(errors).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath(`live-${size.width}.png`), fullPage: true });
    });
  }

  test("the activity strip shows the last minute's calls, failed ones marked, with a caption, and moves only per read", async ({ page }) => {
    await page.clock.install();
    await openLive(page, { state: "noisy" }, DESKTOP);
    const strip = page.locator('.olympus-lane[data-agent="profile:coder"] .olympus-lane-strip');
    await expect(strip).toHaveAttribute("aria-label", "3 tool calls in the last minute, 1 failed");
    await expect(page.locator('.olympus-lane[data-agent="profile:coder"] .olympus-lane-strip-caption')).toHaveText("3 calls, 1 failed · last minute");
    // Ticks are placed from the time of the read, not the clock: seconds passing move nothing
    // (the fixture answers every read with the same minute, so the next read moves nothing either).
    const before = await strip.locator(".olympus-lane-tick").evaluateAll((ticks) => ticks.map((tick) => tick.style.transform));
    await page.clock.runFor(2_000);
    const later = await strip.locator(".olympus-lane-tick").evaluateAll((ticks) => ticks.map((tick) => tick.style.transform));
    expect(later).toEqual(before);
    const transition = await strip.locator(".olympus-lane-tick").first().evaluate((tick) => getComputedStyle(tick).transitionDuration);
    expect(transition).toBe("0s");
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
    // Agent ids are hashed here too, so the Coder lane is found by its place: first, for its failed subagent.
    const coder = page.locator(".olympus-lane").first();
    await expect(coder.locator(".olympus-lane-child-running .olympus-lane-tool")).toHaveText("terminal");
    await expect(coder.locator(".olympus-lane-batch")).toHaveText("Tasks done 1 of 3, 1 failed");
    // A hidden run label never repeats the source word beside it.
    const labels = await page.locator(".olympus-lane-run-row .olympus-lane-label").allTextContents();
    expect(labels).toEqual([expect.stringMatching(/^Run [0-9a-f]{6}$/), expect.stringMatching(/^Run [0-9a-f]{6}$/)]);
  });

  test("the lane name opens the agent's inspector on the Agents view", async ({ page }) => {
    await openLive(page, { state: "noisy" }, DESKTOP);
    await page.locator('.olympus-lane[data-agent="profile:coder"] .olympus-lane-name').click();
    await expect(page.locator(".olympus-inspector")).toBeVisible();
    await expect(page.locator(".olympus-inspector")).toContainText("Coder");
    await expect(page.locator(".olympus-view-current")).toHaveText("Agents");
  });

  test("a run label and a subagent label open that session's steps in the run view", async ({ page }) => {
    await openLive(page, { state: "noisy" }, DESKTOP);
    await page.locator('.olympus-lane[data-agent="profile:coder"] .olympus-lane-run-row .olympus-lane-label').click();
    await expect(page.locator(".olympus-views .olympus-view-current")).toHaveText("Performance");
    const runView = page.locator('aside[aria-label="Run detail"]');
    await expect(runView.locator("h2")).toHaveText("Fix flaky checkout test");
    await runView.getByRole("button", { name: /Back to/ }).click();
    await page.locator(".olympus-view-switch", { hasText: "Live" }).click();
    await page.locator('.olympus-lane[data-agent="profile:coder"] .olympus-lane-child-running .olympus-lane-label').click();
    // The run view shows Hermes' own session title, prefix and all.
    await expect(runView.locator("h2")).toHaveText("Subagent: Patch the retry loop");
  });

  for (const size of [DESKTOP, MOBILE]) {
    test(`at ${size.width}px: fourteen lanes with forty-one subagents stay readable, one read at a time`, async ({ page }) => {
      await page.clock.install();
      const errors = await openLive(page, { state: "noisy", agents: "12", lanes: "14" }, size);
      await expect(page.locator(".olympus-lane")).toHaveCount(14);
      await expect(page.locator(".olympus-lane-child")).toHaveCount(41);
      await expect(page.locator(".olympus-lane-child-running")).toHaveCount(14);
      await page.clock.runFor(10_500);
      const log = await page.evaluate(() => window.__OLYMPUS_FETCH_LOG__);
      expect(log.peak).toBeLessThanOrEqual(2);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBe(0);
      const lastLane = page.locator(".olympus-lane").last();
      await lastLane.scrollIntoViewIfNeeded();
      await expect(lastLane.locator(".olympus-lane-child-running").last()).toBeVisible();
      expect(errors).toEqual([]);
    });
  }

  test("a fresh install says nothing is running", async ({ page }) => {
    await openLive(page, { state: "empty" }, DESKTOP);
    await expect(page.locator(".olympus-lane")).toHaveCount(0);
    // One sentence, nothing else: no census, no idle line, no poll chrome.
    await expect(page.locator(".olympus-live-empty")).toHaveText("Nothing is running. Start a chat, a cron job or a Kanban task and it shows here within 5 s.");
    await expect(page.locator(".olympus-live > *")).toHaveCount(1);
  });

  test("only a subagent that appears after the first read animates in", async ({ page }) => {
    await page.clock.install();
    await openLive(page, { state: "noisy", grow: "1" }, DESKTOP);
    // First paint: every row is still; nothing is marked new and no chip fades.
    await expect(page.locator(".olympus-lane-child")).toHaveCount(5);
    await expect(page.locator(".olympus-lane-child-new")).toHaveCount(0);
    const stillAnimations = await page.evaluate(() => document.getAnimations().map((a) => a.animationName).filter((n) => n && n.startsWith("olympus-lane")));
    expect(stillAnimations).toEqual([]);
    // Second read: one more subagent fanned out; it alone slides in.
    await page.clock.runFor(5_200);
    await expect(page.locator(".olympus-lane-child")).toHaveCount(6);
    await expect(page.locator(".olympus-lane-child-new")).toHaveCount(1);
    await expect(page.locator(".olympus-lane-child-new .olympus-lane-label")).toHaveText("Draft the cover note");
    // The connector stub is static: no draw animation exists any more.
    const stub = await page.locator(".olympus-lane-child-new").evaluate((node) => getComputedStyle(node, "::before").animationName);
    expect(stub).toBe("none");
  });

  test("a chip that replaces another fades in; chips already on screen stay still", async ({ page }) => {
    await page.clock.install();
    await openLive(page, { state: "noisy", tool: "1" }, DESKTOP);
    await expect(page.locator(".olympus-lane-tool-change")).toHaveCount(0);
    await page.clock.runFor(5_200);
    const changed = page.locator(".olympus-lane-tool-change");
    await expect(changed).toHaveCount(1);
    await expect(changed).toHaveText("terminal(npm run build)");
    expect(await changed.evaluate((node) => getComputedStyle(node).animationName)).toBe("olympus-lane-fade");
  });

  test("running is lifted over done without a new colour", async ({ page }) => {
    await openLive(page, { state: "noisy" }, DESKTOP);
    const coder = page.locator('.olympus-lane[data-agent="profile:coder"]');
    const weights = await coder.locator(".olympus-lane-child .olympus-lane-status").evaluateAll((nodes) => nodes.map((n) => getComputedStyle(n).fontWeight));
    expect(weights).toEqual(["600", "400", "400"]);
    // The run label is the header of its tree.
    const runWeight = await coder.locator(".olympus-lane-run-row .olympus-lane-label").evaluate((n) => getComputedStyle(n).fontWeight);
    expect(runWeight).toBe("600");
    const doneDot = await coder.locator(".olympus-lane-child-done .olympus-lane-dot").evaluate((n) => getComputedStyle(n).backgroundColor);
    expect(doneDot).toBe("rgba(0, 0, 0, 0)");
    const chipWeight = await coder.locator(".olympus-lane-tool").first().evaluate((n) => getComputedStyle(n).fontWeight);
    expect(chipWeight).toBe("400");
    // The batch line is the last leaf of the tree, level with the subagent rows.
    const [batchLeft, childLeft] = await Promise.all([
      coder.locator(".olympus-lane-batch").evaluate((n) => n.getBoundingClientRect().left),
      coder.locator(".olympus-lane-child").first().evaluate((n) => n.getBoundingClientRect().left)
    ]);
    expect(batchLeft).toBeGreaterThan(childLeft - 4);
  });

  test("reduced motion turns every animation and transition off", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.clock.install();
    await openLive(page, { state: "noisy", grow: "1" }, DESKTOP);
    await page.clock.runFor(5_200);
    await expect(page.locator(".olympus-lane-child-new")).toHaveCount(1);
    const motion = await page.evaluate(() => {
      const names = (selector, pseudo) => Array.from(document.querySelectorAll(selector)).map((node) => {
        const style = getComputedStyle(node, pseudo);
        return [style.animationName, style.transitionProperty];
      });
      return names(".olympus-lane-child-new").concat(names(".olympus-lane-child", "::before"), names(".olympus-lane-tool"), names(".olympus-lane-tick"), names(".olympus-lane-dot-running"));
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
