import { defineConfig, devices } from "@playwright/test";

// 참조: docs/planning/02-trd.md §7.2 (E2E: 핵심 여정 — 진도 입력→출제→인쇄 미리보기)
// MVP는 chromium 단독. 실제 E2E 시나리오는 T6.1에서 작성한다 (e2e/ 현재 비어있음).
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
