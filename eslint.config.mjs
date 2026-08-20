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
    // 임시 조사용 스크래치 (.gitignore "임시 조사용"). 커밋되지 않는 남의 조사
    // 파일 때문에 `npm run lint` 가 빨개지면 **게이트가 병합을 못 가른다** —
    // 실제로 병합 검수에서 `.probe/peek.ts` 의 any 3건으로 빨갛게 떴다.
    ".probe/**",
    // 같은 이유로 `.measure/**` 도 뺀다 — 재는 데 쓰고 버리는 스크래치라
    // 커밋되지 않는데(.gitignore), 남아 있으면 게이트가 남의 조사 파일 때문에
    // 빨개진다(2026-08-20: `find-poly.ts` 의 any 1건).
    ".measure/**",
  ]),
]);

export default eslintConfig;
