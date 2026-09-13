import { defineConfig, devices } from "@playwright/test";
import config from "./playwright.config";

// WebKit on Windows is useful coverage, but is not a real iOS device test.
export default defineConfig({
  ...config,
  outputDir: ".local/compatibility-results",
  testMatch: "browser-compatibility.spec.ts",
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["iPhone 13"] } },
  ],
});
