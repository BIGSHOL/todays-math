import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import react from "@vitejs/plugin-react";

/**
 * 적대적 리뷰 재현물 전용 설정.
 *
 * `qa/adversarial/**` 의 테스트는 **일부러 빨갛다** — 아직 안 고친 결함을 재현해 두는
 * 자리다(`docs/planning/tracks/reports/adv-*.md`). 그래서 기본 `npm run test`(vitest.config.mts)
 * 의 include 밖에 둔다. 안 그러면 품질 게이트가 늘 빨개서 아무도 안 보게 된다.
 *
 * 실행: npm run test:adv
 * 결함을 고치면 그 재현물은 지우고, 회귀 가드는 `src/__tests__/**` 로 옮긴다
 * (누출 전수 조사가 전부 통과로 확인됐을 때 `_adv-leakage-probe`
 *  → `src/__tests__/api/leakageProbe.test.ts` 로 옮긴 것이 그 예다).
 */
export default defineConfig(({ mode }) => ({
  resolve: { tsconfigPaths: true },
  plugins: [react()],
  test: {
    environment: "jsdom",
    env: loadEnv(mode, process.cwd(), ""),
    globals: false,
    testTimeout: 20000,
    setupFiles: ["./vitest.setup.ts"],
    include: ["qa/adversarial/**/*.{test,spec}.{ts,tsx}"],
    css: false,
  },
}));
