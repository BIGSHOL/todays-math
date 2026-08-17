/**
 * 라우트별 초기 JS 를 표로 찍는다 — 번들 회귀 감시용 (성능 수리 C-4).
 *
 * 왜 필요한가: /problems 가 초기 JS 1,251KB 였는데 **아무도 몰랐다.** Next 16 은
 * 빌드 로그에 라우트 크기를 더 이상 찍지 않아서, 번들이 커져도 빌드는 계속 초록이다.
 * 실패가 침묵하는 경로에는 지표를 따로 세워야 한다.
 *
 * 근거 자료: `.next/diagnostics/route-bundle-stats.json`
 *   — `next build --experimental-analyze` (Turbopack 네이티브) 가 만든다.
 *   — 정적·동적 라우트를 모두 담고, 프레임워크 공용 청크까지 포함한 실제 first-load 다.
 *
 * 사용:
 *   npm run analyze                 빌드 + 표
 *   npm run analyze -- --json       기계 판독용 JSON
 *   node scripts/perf/report-bundle.mjs --baseline docs/planning/tracks/reports/bundle-baseline.json
 *                                   기준선과 대조해 증가분을 표시
 */
import fs from "node:fs";
import path from "node:path";

const STATS = path.join(".next", "diagnostics", "route-bundle-stats.json");

if (!fs.existsSync(STATS)) {
  console.error(
    `번들 통계가 없다: ${STATS}\n` +
      `먼저 분석 빌드를 돌려라 —  npx next build --experimental-analyze`,
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const baselineIdx = args.indexOf("--baseline");
const baselinePath = baselineIdx >= 0 ? args[baselineIdx + 1] : null;

/** @type {{route: string, firstLoadUncompressedJsBytes: number}[]} */
const stats = JSON.parse(fs.readFileSync(STATS, "utf8"));
const rows = stats
  .map((s) => ({ route: s.route, kb: +(s.firstLoadUncompressedJsBytes / 1024).toFixed(1) }))
  .sort((a, b) => b.kb - a.kb);

let baseline = null;
if (baselinePath && fs.existsSync(baselinePath)) {
  baseline = new Map(
    JSON.parse(fs.readFileSync(baselinePath, "utf8")).map((r) => [r.route, r.kb]),
  );
}

if (asJson) {
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
}

const width = Math.max(...rows.map((r) => r.route.length), 10);
console.log("라우트별 초기 JS (uncompressed, 프레임워크 공용 청크 포함)\n");
console.log(
  "route".padEnd(width),
  "firstLoad(KB)".padStart(14),
  baseline ? "  vs 기준선" : "",
);
console.log("-".repeat(width + 16 + (baseline ? 12 : 0)));

let regressions = 0;
for (const r of rows) {
  let delta = "";
  if (baseline) {
    const was = baseline.get(r.route);
    if (was === undefined) {
      delta = "  (신규)";
    } else {
      const d = +(r.kb - was).toFixed(1);
      // 반올림 잡음(±0.5KB)은 회귀로 세지 않는다.
      if (d > 0.5) {
        delta = `  +${d} ▲`;
        regressions += 1;
      } else if (d < -0.5) {
        delta = `  ${d}`;
      } else {
        delta = "  =";
      }
    }
  }
  console.log(r.route.padEnd(width), String(r.kb).padStart(14), delta);
}

if (baseline) {
  console.log(
    regressions > 0
      ? `\n▲ ${regressions}개 라우트가 기준선보다 커졌다. 의도한 것이면 기준선을 갱신하라.`
      : "\n기준선 대비 커진 라우트 없음.",
  );
}
