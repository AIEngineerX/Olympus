// Renders desktop/plugin.js (the Hermes Desktop page) in a browser harness.
// ES modules do not load from file://, so the spec serves the repo over a
// local HTTP server for the duration of the run.
const fs = require("fs");
const http = require("http");
const path = require("path");
const { expect, test } = require("@playwright/test");

const repoRoot = path.resolve(__dirname, "../..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
let server;
let baseUrl;

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const filePath = path.join(repoRoot, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!filePath.startsWith(repoRoot) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": TYPES[path.extname(filePath)] || "application/octet-stream" });
    fs.createReadStream(filePath).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/tests/fixtures/desktop/harness.html`;
});

test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function openHarness(page, query = "", size = { width: 1100, height: 900 }) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
  await page.setViewportSize(size);
  await page.goto(baseUrl + query);
  return errors;
}

test.describe("Olympus Desktop page", () => {
  test("registers a route and a sidebar entry", async ({ page }) => {
    const errors = await openHarness(page);
    await expect(page.getByRole("heading", { name: "Olympus" })).toBeVisible();

    const contributions = await page.evaluate(() => window.__DESKTOP_CONTRIBUTIONS__);
    expect(contributions).toEqual([
      { id: "page", area: "routes", data: { path: "/olympus" } },
      { id: "nav", area: "sidebar.nav", data: { path: "/olympus", label: "Olympus", codicon: "pulse" } },
    ]);
    expect(errors).toEqual([]);
  });

  test("shows the brief: facts, findings, fixes, spend and backlog", async ({ page }) => {
    const errors = await openHarness(page);

    await expect(page.getByText(/Readiness/)).toHaveCount(0);
    await expect(page.getByText("$2.36 across 9 sessions")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Needs you (2)" })).toBeVisible();
    await expect(page.getByText("Create a repeatable browser QA skill")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Did your fixes work?" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Where spend goes" })).toBeVisible();
    await expect(page.getByText("9 · Waiting on a human answer")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("opens sessions natively, tracks fixes, and hands off to allowed Desktop pages", async ({ page }) => {
    await openHarness(page);

    await page.getByRole("button", { name: "Open cli session" }).click();
    await expect.poll(() => page.evaluate(() => window.__DESKTOP_OPENED__)).toEqual({ id: "fixture-session", options: { profile: "default" } });
    await page.getByRole("button", { name: "Open telegram session" }).click();
    await expect(page.getByRole("button", { name: "Session no longer available" })).toBeDisabled();

    await page.getByRole("button", { name: "I fixed this" }).first().click();
    await expect(page.getByText("Tracking your fix")).toBeVisible();

    await page.getByRole("button", { name: "Open Profiles" }).click();
    const calls = await page.evaluate(() => window.__DESKTOP_CALLS__);
    expect(calls.actions).toEqual(["nav.profiles"]);
    expect(calls.rest.map((call) => call.method + " " + call.path.split("?")[0])).toEqual(
      expect.arrayContaining(["GET /overview", "GET /open/session", "POST /fixes"])
    );
  });

  test("explains how to enable the backend when it is not mounted", async ({ page }) => {
    const errors = await openHarness(page, "?backend=down");

    await expect(page.getByText(/hermes plugins enable olympus/)).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("stays readable in a narrow Desktop pane", async ({ page }) => {
    await openHarness(page, "", { width: 420, height: 900 });

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
