const path = require("path");
const { pathToFileURL } = require("url");
const { expect, test } = require("@playwright/test");

const fixtureBaseUrl = pathToFileURL(path.join(__dirname, "../fixtures/olympus-fixture.html")).href;

function fixtureUrl(params) {
  return `${fixtureBaseUrl}?${new URLSearchParams(params).toString()}`;
}

async function openPage(page, params, size = { width: 1440, height: 900 }) {
  await page.setViewportSize(size);
  await page.goto(fixtureUrl(params));
  await page.locator(".olympus-page").waitFor();
}

test.describe("Olympus behaviour", () => {
  test("polling waits for a slow response instead of discarding it", async ({ page }) => {
    await page.clock.install();
    await openPage(page, { state: "noisy", delay: "11000" });

    // The first /overview is still pending; nothing else may start.
    await page.clock.runFor(10_500);
    let log = await page.evaluate(() => window.__OLYMPUS_FETCH_LOG__);
    expect(log.started).toBe(1);

    // It settles at 11s and its data renders even though it outlived the old 10s interval.
    await page.clock.runFor(1_000);
    await expect(page.locator(".olympus-score-card")).toBeVisible();

    // The next poll starts 10s after that, still one at a time.
    await page.clock.runFor(10_500);
    log = await page.evaluate(() => window.__OLYMPUS_FETCH_LOG__);
    expect(log.started).toBe(2);
    expect(log.peak).toBe(1);
  });

  test("links keep the reverse-proxy prefix and the profile scope", async ({ page }) => {
    await openPage(page, { state: "noisy", base: "/hermes/", profile: "coder" });

    const hrefs = await page.locator(".olympus-page a[href]").evaluateAll((links) => links.map((link) => link.getAttribute("href")));
    const routed = hrefs.filter((href) => href !== "#");
    expect(routed.length).toBeGreaterThan(0);
    for (const href of routed) {
      expect(href).toMatch(/^\/hermes\/(analytics|config|cron|kanban|logs|profiles|sessions|skills)\?profile=coder$/);
    }
  });

  test("session links resolve on click and report sessions that are gone", async ({ page }) => {
    await openPage(page, { state: "noisy", base: "/hermes" });
    const gone = page.getByRole("button", { name: "Open telegram session" });
    await gone.click();
    await expect(page.getByRole("button", { name: "Session no longer available" })).toBeDisabled();

    await Promise.all([
      page.waitForRequest((request) => request.url().endsWith("/hermes/chat?resume=fixture-session&profile=default") && request.isNavigationRequest()),
      page.getByRole("button", { name: "Open cli session" }).click(),
    ]);
  });

  test("marking a finding fixed tracks it until the operator stops", async ({ page }) => {
    await openPage(page, { state: "noisy" });
    const tracking = page.locator(".olympus-fix-tracking");
    await expect(tracking.locator(".olympus-fix-row")).toHaveCount(1);
    await expect(page.locator(".olympus-oracle")).toContainText("+9 in 7 days");

    await page.getByRole("button", { name: "I fixed this" }).first().click();
    await expect(page.locator(".olympus-fix-tracked").first()).toHaveText("Tracking your fix");
    const row = tracking.locator(".olympus-fix-row").filter({ hasText: "Create a repeatable browser QA skill" });
    await expect(row).toContainText("2 → 2");
    await expect(row).toContainText("unchanged");

    await row.getByRole("button", { name: "Stop tracking" }).click();
    await expect(tracking.locator(".olympus-fix-row")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "I fixed this" })).toHaveCount(2);
  });

  test("mode tabs follow the WAI-ARIA keyboard pattern", async ({ page }) => {
    await openPage(page, { state: "noisy" });
    const brief = page.getByRole("tab", { name: "Brief" });

    await expect(brief).toHaveAttribute("tabindex", "0");
    await expect(page.getByRole("tab", { name: "Agents" })).toHaveAttribute("tabindex", "-1");

    await brief.focus();
    await page.keyboard.press("ArrowRight");
    const agents = page.getByRole("tab", { name: "Agents" });
    await expect(agents).toBeFocused();
    await expect(agents).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".olympus-pantheon")).toBeVisible();

    await page.keyboard.press("End");
    await expect(page.getByRole("tab", { name: "Diagnostics" })).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowRight");
    await expect(brief).toBeFocused();
    await expect(brief).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByRole("tab", { name: "Diagnostics" })).toBeFocused();
  });

  for (const count of [5, 12]) {
    test(`every one of ${count} Pantheon profiles keeps its own click target`, async ({ page }) => {
      await openPage(page, { state: "noisy", profiles: String(count) });
      await page.getByRole("tab", { name: "Agents" }).click();

      const boxes = await page.locator(".olympus-pantheon-node").evaluateAll((nodes) => nodes.map((node) => {
        const r = node.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      }));
      expect(boxes).toHaveLength(count);
      for (let i = 0; i < boxes.length; i += 1) {
        for (let j = i + 1; j < boxes.length; j += 1) {
          const a = boxes[i];
          const b = boxes[j];
          const overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
            Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
          expect(overlap, `profiles ${i} and ${j} overlap`).toBe(false);
        }
      }
      await page.getByRole("button", { name: `Select profile Profile ${count - 1}` }).click();
      await expect(page.locator(".olympus-party-inspector h3")).toHaveText(`Profile ${count - 1}`);
    });
  }

  for (const size of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
    test(`Pantheon status badges fit their cells at ${size.width}px`, async ({ page }) => {
      await openPage(page, { state: "noisy" }, size);
      await page.getByRole("tab", { name: "Agents" }).click();

      const overflowing = await page.locator(".olympus-viewport-stat, .olympus-fitness-reasons small").evaluateAll((cells) =>
        cells.filter((cell) => cell.scrollWidth > cell.clientWidth + 1).map((cell) => cell.textContent)
      );
      expect(overflowing).toEqual([]);
    });
  }

  test("profile fitness reasons show labelled points, not a bare score delta", async ({ page }) => {
    await openPage(page, { state: "noisy" });
    await page.getByRole("tab", { name: "Agents" }).click();

    const reasons = await page.locator(".olympus-fitness-reasons small").allTextContents();
    expect(reasons.length).toBeGreaterThan(0);
    for (const text of reasons) {
      expect(text).not.toMatch(/\/\s*-\d+\s*$/);
    }
    await expect(page.locator(".olympus-reason-points").first()).toHaveText(/^−\d+ pts$/);
  });
});
