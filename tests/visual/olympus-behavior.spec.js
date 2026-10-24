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

function writes(page) {
  return page.evaluate(() => window.__OLYMPUS_FETCH_LOG__.writes);
}

function bannerItem(page, text) {
  return page.locator(".olympus-banner .olympus-queue-item").filter({ hasText: text });
}

test.describe("Olympus behaviour", () => {
  test("polling waits for a slow response instead of discarding it", async ({ page }) => {
    await page.clock.install();
    await openPage(page, { state: "noisy", delay: "11000" });

    // The first /overview is still pending; nothing else may start.
    await page.clock.runFor(10_500);
    let log = await page.evaluate(() => window.__OLYMPUS_FETCH_LOG__);
    expect(log.started).toBe(1);
    await expect(page.locator(".olympus-skeleton")).toBeVisible();

    // It settles at 11s and its data renders even though it outlived the 10s interval.
    await page.clock.runFor(1_000);
    await expect(page.locator(".olympus-roster tbody tr")).toHaveCount(7);

    // The next poll starts 10s after that, still one at a time.
    await page.clock.runFor(10_500);
    log = await page.evaluate(() => window.__OLYMPUS_FETCH_LOG__);
    expect(log.started).toBe(2);
    expect(log.peak).toBe(1);
  });

  test("links keep the reverse-proxy prefix and the profile scope", async ({ page }) => {
    await openPage(page, { state: "noisy", base: "/hermes/", profile: "coder", agent: "profile:ops" });
    for (const view of ["agents", "checks"]) {
      if (view === "checks") await page.getByRole("button", { name: "Checks" }).click();
      const links = await page.locator(".olympus-page a[href]").evaluateAll((items) => items.map((link) => ({ href: link.getAttribute("href"), text: link.textContent })));
      expect(links.length).toBeGreaterThan(0);
      for (const link of links) {
        expect(link.href).toMatch(/^\/hermes\/(analytics|config|cron|kanban|logs|profiles|sessions|skills)\?profile=coder$/);
        expect(link.text).not.toBe("Open Route");
      }
    }
  });

  test("the roster is keyboard operable and the open agent survives a reload", async ({ page }) => {
    await openPage(page, { state: "noisy" });
    const rows = page.locator(".olympus-roster tbody tr");
    await rows.first().focus();
    await page.keyboard.press("ArrowDown");
    await expect(rows.nth(1)).toBeFocused();
    const second = await rows.nth(1).getAttribute("data-agent");

    await page.keyboard.press("Enter");
    await expect(page.locator(".olympus-inspector")).toBeVisible();
    await expect(rows.nth(1)).toHaveAttribute("aria-selected", "true");
    expect(new URL(page.url()).searchParams.get("agent")).toBe(second);

    await page.reload();
    await expect(page.locator(".olympus-inspector h2")).toBeVisible();
    await expect(page.locator(`tr[data-agent="${second}"]`)).toHaveAttribute("aria-selected", "true");

    await page.keyboard.press("Escape");
    await expect(page.locator(".olympus-inspector")).toHaveCount(0);
    expect(new URL(page.url()).searchParams.get("agent")).toBeNull();
  });

  test("Escape closes the inspector and returns focus to its row", async ({ page }) => {
    await openPage(page, { state: "noisy" });
    const row = page.locator('tr[data-agent="profile:writer"]');
    await row.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".olympus-inspector")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(row).toBeFocused();
  });

  test("the roster sorts by status, name and last activity", async ({ page }) => {
    await openPage(page, { state: "noisy" });
    const names = () => page.locator(".olympus-agent-name strong").allTextContents();
    expect((await names()).slice(0, 2)).toEqual(["Coder", "Researcher"]);

    await page.getByRole("button", { name: "Agent", exact: true }).click();
    expect(await names()).toEqual(["Analyst", "Coder", "Default", "Ops", "Researcher", "Reviewer", "Writer"]);
    await expect(page.getByRole("columnheader", { name: "Agent" })).toHaveAttribute("aria-sort", "ascending");

    await page.getByRole("button", { name: "Last active" }).click();
    expect((await names())[0]).toBe("Default");
  });

  test("answering a waiting agent posts the answer, unblocks the task and logs it", async ({ page }) => {
    await openPage(page, { state: "noisy" });
    const item = bannerItem(page, "waiting on your answer");
    await item.getByRole("button", { name: "Answer" }).click();

    const popover = page.getByRole("dialog", { name: /^Answer:/ });
    await expect(popover).toContainText("Post your answer on Which market should the pricing study cover? as a comment and move it back to ready for Researcher.");
    const confirm = popover.getByRole("button", { name: "Confirm" });
    await expect(confirm).toBeDisabled();
    await popover.getByRole("textbox", { name: "Your answer" }).fill("Cover the EU market first.");
    await confirm.click();

    await expect(page.locator(".olympus-notice")).toHaveText("Answer posted; back to ready: Which market should the pricing study cover?");
    await expect(page.locator(".olympus-banner .olympus-count")).toHaveText("7");
    const sent = await writes(page);
    expect(sent.slice(0, 2)).toEqual([
      { method: "POST", path: "/api/plugins/kanban/tasks/t-pricing/comments", query: "board=default", body: { body: "Cover the EU market first." } },
      { method: "PATCH", path: "/api/plugins/kanban/tasks/t-pricing", query: "board=default", body: { status: "ready" } }
    ]);
    const logged = new URLSearchParams(sent[2].query);
    expect([sent[2].path, logged.get("action"), logged.get("ok"), logged.get("label"), logged.get("agent")])
      .toEqual(["/api/plugins/olympus/actions", "answer", "true", "Which market should the pricing study cover?", "profile:researcher"]);
  });

  test("reassigning a stalled worker picks an agent and reclaims it first", async ({ page }) => {
    await openPage(page, { state: "noisy", agent: "profile:reviewer" });
    const inspector = page.locator(".olympus-inspector");
    await inspector.locator(".olympus-queue-item").getByRole("button", { name: "Reassign" }).click();

    const popover = page.getByRole("dialog", { name: /^Reassign:/ });
    const options = await popover.locator("option").allTextContents();
    expect(options).not.toContain("Reviewer");
    await popover.getByRole("combobox").selectOption({ label: "Coder" });
    await popover.getByRole("button", { name: "Confirm" }).click();

    await expect(page.locator(".olympus-notice")).toContainText("Reassigned: Review PR 412: payment retries");
    const sent = await writes(page);
    expect(sent[0]).toEqual({
      method: "POST",
      path: "/api/plugins/kanban/tasks/t-pr412/reassign",
      query: "board=default",
      body: { profile: "coder", reclaim_first: true, reason: "Reassigned from Olympus" }
    });
  });

  test("assigning unowned work logs it on the agent that received it", async ({ page }) => {
    await openPage(page, { state: "noisy" });
    await page.getByRole("button", { name: "+5 more" }).click();
    await bannerItem(page, "has no agent").getByRole("button", { name: "Assign" }).click();
    const popover = page.getByRole("dialog", { name: /^Assign:/ });
    await popover.getByRole("combobox").selectOption({ label: "Analyst" });
    await popover.getByRole("button", { name: "Confirm" }).click();

    await expect(page.locator(".olympus-notice")).toContainText("Assigned: Summarise this week's support tickets");
    const sent = await writes(page);
    expect(sent[0].body).toEqual({ profile: "analyst", reclaim_first: false, reason: "Reassigned from Olympus" });
    expect(new URLSearchParams(sent[1].query).get("agent")).toBe("profile:analyst");
  });

  test("when Hermes refuses, the popover shows why and offers a retry", async ({ page }) => {
    await openPage(page, { state: "noisy", fail: "reclaim" });
    await bannerItem(page, "Worker stalled").getByRole("button", { name: "Reclaim" }).click();
    const popover = page.getByRole("dialog", { name: /^Reclaim:/ });
    await popover.getByRole("button", { name: "Confirm" }).click();

    await expect(popover.getByRole("alert")).toHaveText("Hermes said: 409: cannot reclaim (fixture refusal)");
    await expect(popover.getByRole("button", { name: "Try again" })).toBeEnabled();
    await expect(page.locator(".olympus-banner .olympus-count")).toHaveText("8");
    const logged = new URLSearchParams((await writes(page))[1].query);
    expect([logged.get("action"), logged.get("ok"), logged.get("detail")]).toEqual(["reclaim", "false", "409: cannot reclaim (fixture refusal)"]);

    await popover.getByRole("button", { name: "Cancel" }).click();
    await expect(popover).toHaveCount(0);
  });

  test("the inspector shows how the agent works, not a copy of the board", async ({ page }) => {
    await openPage(page, { state: "noisy", agent: "profile:coder" });
    const inspector = page.locator(".olympus-inspector");
    await expect(inspector.locator(".olympus-setup")).toHaveText("model claude-sonnet-5-5 · 0 skills · shares the default gateway · loop hard stop unattended only");

    const working = inspector.locator(".olympus-inspector-section").filter({ has: page.getByRole("heading", { name: "How it's working" }) });
    await expect(working.locator(".olympus-signals li")).toHaveCount(3);
    await expect(working.locator(".olympus-signals li").first()).toContainText("Looping or tool-thrashing in 1 session");
    await expect(working.getByRole("button", { name: "Open Retry the flaky test until green session" }).first()).toBeVisible();
    await expect(working).toContainText("Tools per run");

    // Kanban keeps the board: only the running task and counts appear here.
    const kanban = inspector.locator(".olympus-inspector-section").filter({ has: page.getByRole("heading", { name: "Kanban", exact: true }) });
    await expect(kanban.locator(".olympus-work-row")).toHaveCount(1);
    await expect(kanban.locator(".olympus-work-row")).toContainText("Fix flaky checkout test");
    await expect(kanban.locator(".olympus-kanban-summary")).toContainText("2 open · 1 blocked · 1 done this week");
    await expect(kanban).not.toContainText("Deploy the preview build");

    // The behaviour warnings sit on Coder in the queue, with its sessions.
    await expect(inspector.locator(".olympus-queue-item")).toHaveCount(3);
  });

  test("performance ranks agents by success and drills into one run", async ({ page }) => {
    await openPage(page, { state: "noisy" });
    await expect(page.locator('tr[data-agent="profile:coder"] .olympus-rate')).toHaveText("96%");
    await expect(page.locator(".olympus-census")).toContainText("97% of runs succeeded this week");
    await page.getByRole("button", { name: "Performance" }).click();
    expect(new URL(page.url()).searchParams.get("view")).toBe("performance");

    const perf = page.locator(".olympus-performance");
    await expect(perf.locator(".olympus-census")).toContainText("77 runs · 97% succeeded");
    const names = await perf.locator(".olympus-perf-table .olympus-agent-name strong").allTextContents();
    expect(names.slice(0, 2)).toEqual(["Researcher", "Coder"]); // worst success first

    await perf.locator('tr[data-agent="profile:coder"]').click();
    const panel = page.getByRole("complementary", { name: "Performance of Coder" });
    await expect(panel.locator(".olympus-facts")).toContainText("96% of 25");
    const terminal = panel.locator(".olympus-table tbody tr").filter({ hasText: "terminal" });
    await expect(terminal.locator("td")).toHaveText(["terminal", "12", "8", "67%"]);

    await panel.locator(".olympus-work-row").filter({ hasText: "Retry the flaky test until green" }).first().getByRole("button", { name: "Inspect run" }).click();
    const run = page.getByRole("complementary", { name: "Run detail" });
    await expect(run.locator("h2")).toHaveText("Retry the flaky test until green");
    await expect(run.locator(".olympus-run-outcome")).toContainText("Failed");
    await expect(run.locator(".olympus-step-error")).toHaveCount(9); // 8 failed terminal calls and the agent error
    expect(new URL(page.url()).searchParams.get("run")).toBe("c-loop");

    await run.getByRole("button", { name: /Back to Coder/ }).click();
    await expect(panel).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);

    await perf.getByRole("button", { name: "30 days" }).click();
    await expect(perf.getByRole("button", { name: "30 days" })).toHaveAttribute("aria-pressed", "true");
    expect(new URL(page.url()).searchParams.get("days")).toBe("30");
    await expect(perf.locator(".olympus-token-day")).toHaveCount(30);
  });

  test("the roster says which tool a working agent is using", async ({ page }) => {
    await openPage(page, { state: "noisy" });
    await expect(page.locator('tr[data-agent="profile:default"] .olympus-now small')).toContainText(/^using web_extract \d+ (s|min) ago · for \d+ min$/);
  });

  test("Escape closes an open popover before the inspector", async ({ page }) => {
    await openPage(page, { state: "noisy", agent: "profile:writer" });
    await page.locator(".olympus-inspector .olympus-work-row").getByRole("button", { name: "Run now" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(".olympus-inspector")).toBeVisible();
  });

  test("pausing an agent's schedule pauses each of its enabled jobs", async ({ page }) => {
    await openPage(page, { state: "noisy", agent: "profile:researcher" });
    await page.getByRole("button", { name: "Pause all scheduled" }).click();
    const popover = page.getByRole("dialog");
    await expect(popover).toContainText("Pause 1 scheduled job for Researcher until you resume it.");
    await popover.getByRole("button", { name: "Confirm" }).click();
    await expect(page.locator(".olympus-notice")).toContainText("Paused");
    const sent = await writes(page);
    expect(sent.filter((call) => call.path.startsWith("/api/cron/")).map((call) => call.path)).toEqual(["/api/cron/jobs/job-digest/pause"]);
  });

  test("with controls off, nothing can act and items link to their Hermes page", async ({ page }) => {
    await openPage(page, { state: "noisy", controls: "off" });
    await expect(page.locator(".olympus-banner .olympus-button")).toHaveCount(0);
    await expect(page.locator(".olympus-roster .olympus-button")).toHaveCount(0);
    await expect(bannerItem(page, "waiting on your answer").getByRole("link", { name: "Open Kanban" })).toBeVisible();
    await expect(page.locator(".olympus-controls-off")).toContainText("dashboard.olympus.controls: false");
    expect(await writes(page)).toEqual([]);
  });

  test("session links resolve on click and report sessions that are gone", async ({ page }) => {
    await openPage(page, { state: "noisy", base: "/hermes", view: "checks" });
    const gone = page.getByRole("button", { name: "Open telegram session" });
    await gone.click();
    await expect(page.getByRole("button", { name: "Session no longer available" })).toBeDisabled();

    await Promise.all([
      page.waitForRequest((request) => request.url().endsWith("/hermes/chat?resume=fixture-session&profile=default") && request.isNavigationRequest()),
      page.getByRole("button", { name: "Open cli session" }).click()
    ]);
  });

  test("marking a finding fixed tracks it until the operator stops", async ({ page }) => {
    await openPage(page, { state: "noisy", view: "checks" });
    const fixes = page.locator(".olympus-fix-list li");
    await expect(fixes).toHaveCount(1);
    await expect(page.locator(".olympus-readiness")).toContainText("+9 in 7 days");

    await page.locator(".olympus-finding").filter({ hasText: "Create a repeatable browser QA skill" }).getByRole("button", { name: "I fixed this" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
    await expect(fixes).toHaveCount(2);
    const row = fixes.filter({ hasText: "Create a repeatable browser QA skill" });
    await expect(row).toContainText("2 → 2");
    await expect(row).toContainText("Unchanged");

    await row.getByRole("button", { name: "Stop tracking" }).click();
    await expect(fixes).toHaveCount(1);
  });

  for (const count of [12, 30]) {
    test(`a roster of ${count + 7} agents keeps every row readable`, async ({ page }) => {
      await openPage(page, { state: "noisy", agents: String(count) });
      await expect(page.locator(".olympus-roster tbody tr")).toHaveCount(count + 7);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(2);
      await page.locator(`tr[data-agent="profile:extra_${count - 1}"]`).click();
      await expect(page.locator(".olympus-inspector h2")).toHaveText(`Profile ${count + 9}`);
    });
  }
});
