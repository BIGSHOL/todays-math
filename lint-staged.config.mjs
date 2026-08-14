const affordanceTest =
  "npx vitest run src/__tests__/unit/affordanceGuard.test.ts --reporter=dot";

export default {
  "*.{ts,tsx}": ["eslint --fix", "prettier --write"],
  "src/**/*.{tsx,jsx,css}": "node src/lint/check-affordance.mjs",
  "src/lint/**": () => affordanceTest,
  "src/__tests__/unit/affordanceGuard.test.ts": () => affordanceTest,
};
