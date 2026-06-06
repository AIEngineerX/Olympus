const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "tests/visual",
  timeout: 30000,
  expect: {
    timeout: 5000
  },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    browserName: "chromium",
    screenshot: "only-on-failure",
    trace: "on-first-retry"
  }
});
