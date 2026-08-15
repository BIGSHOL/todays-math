import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettierConfig from "eslint-config-prettier/flat";

import affordance from "./src/lint/affordance-plugin.mjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  prettierConfig,
  {
    files: ["src/**/*.{tsx,jsx}"],
    plugins: { affordance },
    rules: {
      "affordance/no-false-affordance": "error",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 테스트 산출물 (T0.4 — .gitignore "testing" 섹션과 동일 범위)
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    // 오르카가 만드는 중첩 워크트리 — 저장소 안에 있지만 git 추적 대상이 아니다
    // (.git/info/exclude). 이걸 안 빼면 `npm run lint`가 남의 사본 오류로 항상 빨갛다.
    ".claude/worktrees/**",
  ]),
]);

export default eslintConfig;
