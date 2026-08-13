import { defineConfig, devices } from "@playwright/test";

import { E2E_ENV } from "./e2e/env";

// 참조: docs/planning/02-trd.md §7.2 (E2E: 핵심 여정 — 진도 입력→출제→인쇄 미리보기)
// T6.1: 로컬 Docker(5433)/todaysmath_e2e + 실제 Route Handler. Claude 는 E2E_MOCK_AI.
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "html",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: "http://localhost:3001",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npx next dev --port 3001",
    url: "http://localhost:3001",
    reuseExistingServer: false,
    timeout: 180_000,
    env: { ...process.env, ...E2E_ENV },
  },
});
