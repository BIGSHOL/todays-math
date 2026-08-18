/**
 * **탐침 자를 실측으로 채점한다** (읽기 전용 · 파일만 읽는다).
 *
 *   npx tsx scripts/qa/measure-figref-layout.tsx --json scripts/qa/reports/figref-layout-stem70.json
 *   npx tsx scripts/qa/score-figref-ruler.ts scripts/qa/reports/figref-layout-stem70.json
 *
 * ## 「참」이 어디서 오는가
 *
 * **정답은 Chromium 이 잰 `neededPx` 다.** 자가 스스로 만든 값이 아니다.
 * 이 저장소가 2026-08-18 에 낸 결함이 정확히 그 반대였다 — 채점기가 제품 상수로
 * 정답을 정해서, 상수를 망가뜨려도 성적이 **올랐다**. 여기서는 자를 아무리 고쳐도
 * 정답이 안 움직인다.
 *
 * ## 왜 「현행」 팔부터 채점하나
 *
 * 새 자의 성적만 보면 그것이 좋은 건지 알 수 없다. 같은 문항에서 **제품 자**가
 * 지금 몇 점인지가 분모다. 둘을 같이 찍는다.
 *
 * 과소평가(자 < 실측)는 **놓침**이다 — 겹쳐 찍힌 시험지가 학생 손에 간다.
 * 그래서 정확도보다 그쪽을 먼저 본다(`printOverflow.ts` TALL_MATH 주석과 같은 원칙).
 */
import { readFileSync } from "node:fs";

import { JASEUP_MEASURED_PX } from "../../src/lib/printGeometry";
import {
  estimateProblemPx,
  parseFigureDimensions,
} from "../../src/lib/printOverflow";
import { estimateFigrefProblemPx, type ChoiceGridOptions } from "./figrefRuler";

interface MeasuredRow {
  id: string;
  school: string | null;
  questionNumber: number | null;
  figures: number;
  dims: number[];
  content: string;
  byVariant: Record<
    string,
    { neededPx: number; figurePx: number; choicePx: number }
  >;
}

const VARIANT_OPTIONS: Record<string, ChoiceGridOptions> = {
  "ㄱ-옆2": { cols: 2, beside: true },
  "ㄴ-옆3": { cols: 3, beside: true },
  "ㄷ-아래2": { cols: 2, beside: false },
  "ㄹ-아래3": { cols: 3, beside: false },
};

/** 측정과 **같은 가정**으로 그림을 나눈다 (`measure-figref-layout.tsx` 의 `measurementPlan`). */
function splitDims(figures: number, dims: number[]) {
  const all = parseFigureDimensions(figures, dims);
  const choiceCount = figures >= 5 ? 5 : figures;
  return {
    stem: all.slice(0, figures - choiceCount),
    choices: all.slice(figures - choiceCount),
  };
}

function stats(errors: number[]) {
  const abs = errors.map(Math.abs).sort((a, b) => a - b);
  const within = (n: number) =>
    ((abs.filter((v) => v <= n).length / abs.length) * 100).toFixed(1);
  const under = errors.filter((e) => e < -20).length;
  return {
    median: abs[Math.floor(abs.length / 2)]!.toFixed(0),
    p90: abs[Math.floor(abs.length * 0.9)]!.toFixed(0),
    max: abs[abs.length - 1]!.toFixed(0),
    within20: within(20),
    under20: ((under / errors.length) * 100).toFixed(1),
    underCount: under,
  };
}

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error(
      "사용법: npx tsx scripts/qa/score-figref-ruler.ts <measure-figref-layout 의 --json 산출물>",
    );
    process.exitCode = 1;
    return;
  }
  const data = JSON.parse(readFileSync(file, "utf8")) as {
    rows: MeasuredRow[];
  };
  const rows = data.rows;

  console.log(
    `자 채점 — 정답은 Chromium 실측 \`neededPx\` · ${rows.length}건\n` +
      `| 자 / 시안 | |오차| 중앙 | 90분위 | 최대 | ≤20px | **20px 넘게 과소(놓침)** |`,
  );
  console.log("| --- | ---: | ---: | ---: | ---: | ---: |");

  for (const [variant, options] of Object.entries(VARIANT_OPTIONS)) {
    const errors: number[] = [];
    for (const r of rows) {
      const measured = r.byVariant[variant];
      if (!measured) continue;
      const plan = splitDims(r.figures, r.dims);
      errors.push(
        estimateFigrefProblemPx(r.content, plan, options) - measured.neededPx,
      );
    }
    const s = stats(errors);
    console.log(
      `| ${variant} | ${s.median} | ${s.p90} | ${s.max} | ${s.within20}% | ${s.under20}% (${s.underCount}건) |`,
    );
  }

  // 제품 자 ↔ 현행 지면 — 같은 문항에서의 분모.
  const productErrors: number[] = [];
  for (const r of rows) {
    const figures = parseFigureDimensions(r.figures, r.dims);
    productErrors.push(
      estimateProblemPx(r.content, figures) - r.byVariant["현행"]!.neededPx,
    );
  }
  const p = stats(productErrors);
  console.log(
    `| **제품 자 / 현행 (분모)** | ${p.median} | ${p.p90} | ${p.max} | ${p.within20}% | ${p.under20}% (${p.underCount}건) |`,
  );

  console.log(
    `\n칸 높이: 첫 장 ${JASEUP_MEASURED_PX.firstPageSlot}px · 이어지는 장 ${JASEUP_MEASURED_PX.continuationSlot}px` +
      ` · 혼자 쓰는 칸 ${JASEUP_MEASURED_PX.soloContinuationSlot}px`,
  );

  /**
   * 자가 바뀌면 **출제(⑷)와 인쇄 경고가 같이** 바뀐다 — 둘이 같은 `assessSeat` 를 쓰기
   * 때문이다(D-52). 그래서 「이 문항들이 칸에 안 들어간다고 판정되는 수」가 곧 ⑷ 가
   * 후순위로 미는 수이자 인쇄가 경고하는 수다. 전후를 **같은 자**로 센다.
   */
  const seats = [
    ["첫 장 405px", JASEUP_MEASURED_PX.firstPageSlot],
    ["이어지는 장 484px", JASEUP_MEASURED_PX.continuationSlot],
    ["혼자 쓰는 칸 997px", JASEUP_MEASURED_PX.soloContinuationSlot],
  ] as const;
  const countOver = (px: (r: MeasuredRow) => number) =>
    seats
      .map(([, slot]) => rows.filter((r) => px(r) > slot).length)
      .join(" | ");

  console.log(
    `\n자가 «안 들어간다»고 보는 수 — 출제 ⑷ 의 후순위 대상이자 인쇄 경고 대상 (${rows.length}건)`,
  );
  console.log(`| 자 / 시안 | ${seats.map(([n]) => n).join(" | ")} |`);
  console.log(`| --- | ---: | ---: | ---: |`);
  console.log(
    `| **제품 자 / 현행 (분모)** | ${countOver((r) =>
      estimateProblemPx(r.content, parseFigureDimensions(r.figures, r.dims)),
    )} |`,
  );
  for (const [variant, options] of Object.entries(VARIANT_OPTIONS))
    console.log(
      `| ${variant} | ${countOver((r) =>
        estimateFigrefProblemPx(
          r.content,
          splitDims(r.figures, r.dims),
          options,
        ),
      )} |`,
    );
}

main();
