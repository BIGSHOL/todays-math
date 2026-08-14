import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// 참조: docs/planning/02-trd.md §7 (테스트 전략), §7.2 (테스트 피라미드)
export default defineConfig(({ mode }) => ({
  resolve: {
    // tsconfig.json의 "@/*" 별칭을 그대로 해석 (Vite 8 네이티브 지원)
    tsconfigPaths: true,
  },
  plugins: [react()],
  test: {
    environment: "jsdom",
    // mode는 vitest 실행 시 기본값 "test" → .env, .env.test, .env.test.local을
    // 로드해 process.env로 주입한다 (테스트 전용 DATABASE_URL 오버라이드 등).
    env: loadEnv(mode, process.cwd(), ""),
    globals: false,
    // mathgen 렌더 스택(react-markdown + remark-math + rehype-katex) 이식 후 문제 목록
    // 렌더가 무거워져 기본 5초로는 전체 실행에서만 타임아웃이 났다(격리 실행은 통과).
    // 렌더 자체는 정상이므로 상한만 현실화한다.
    testTimeout: 20000,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/__tests__/**/*.{test,spec}.{ts,tsx}"],
    css: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/__tests__/**",
        "src/mocks/**",
        "src/app/**/layout.tsx",
        "src/**/*.d.ts",
      ],
      // 목표 80% (02-trd.md §7.2) — thresholds는 T0.4에서 미적용, 리포트만 생성.
      // 실제 기능 코드가 쌓이는 Phase 이후 thresholds 설정 예정.
    },
  },
}));
