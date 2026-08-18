/**
 * **어느 칸에도 안 들어가는 문항**을 세고, 왜 긴지 가르고, 처리 방안의 값을 잰다 (읽기 전용).
 *
 *   npx tsx scripts/qa/report-oversize-problems.ts --cache .measure/cont2.json
 *   npx tsx scripts/qa/report-oversize-problems.ts --eyeball scripts/qa/reports/oversize-eyeball.txt
 *
 * ## 이 도구가 지키는 것
 *
 * 1. **캐시가 낡으면 멈춘다.** 높이는 `.measure/*.json` 의 실측이고, 그 옆의 지문이
 *    「지금 지면·지금 본문·지금 그림 파일」과 같은지 말해 준다. 지문이 없거나
 *    어긋나면 아무것도 세지 않는다 — 적대적 리뷰 ④ F 에서 낡은 캐시가 조용히
 *    통과해 「재현율 95.2%」를 찍은 적이 있다. 이 조사에서도 실제로 걸렸다:
 *    워크트리에 딸려 온 캐시는 **591행이 낡아** 있었고(그림 파일이 새로 들어와
 *    지면이 최대 1,668px 높아졌다), 그 캐시로 세면 135건이 **131건**으로 보인다.
 * 2. **칸 높이는 실측에서 온다.** 「어느 칸에도 안 들어간다」의 기준은 **가장 큰 칸**
 *    (홀수 시험지 마지막 자리)이다. 그 값은 `measure-paper-units.tsx` 가 지면에서
 *    잰 `JASEUP_MEASURED_PX` 이고, 캐시의 실측 칸과 상수가 어긋나면 역시 멈춘다.
 * 3. **정책 값은 제품 함수와 대조한다.** 「그림 폭 상한을 줄이면」 계산은 규칙을
 *    옮겨 적은 것이라, 상한을 제품 값으로 두고 `estimateFigureBlockPx` 와
 *    **전량 대조**해 한 건이라도 다르면 멈춘다.
 * 4. **`미분류` 를 낸다.** 규칙에 없는 부류는 규칙이 0으로 만든다.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

import { readFigureDimensions } from "../../src/lib/import/figureDimensionsFromPublic";
import { JASEUP_MEASURED_PX } from "../../src/lib/printGeometry";
import { estimateFigureBlockPx } from "../../src/lib/printOverflow";
import {
  heightCacheProblems,
  measuredRowsHash,
  readHeightCacheManifest,
} from "./heightCacheManifest";
import {
  CLASS_REMEDY,
  MM_TO_PX,
  capForColumns,
  classifyOversize,
  figureBlockPxAt,
  type FigureDim,
  type OversizeClass,
} from "./oversizeRules";

const prisma = new PrismaClient();

interface Measured {
  pid: string;
  availPx: number;
  neededPx: number;
  figurePx: number;
  choicePx: number;
  boxPx: number;
}

interface Row {
  id: string;
  content: string;
  figureUrls: string[];
  figureDims: number[] | null;
  questionType: string | null;
  problemType: string;
  difficulty: string;
  source: string;
  reviewStatus: string;
  directUseAllowed: boolean;
  pool: string;
  noAnswer: boolean;
  school: string | null;
  examId: string | null;
  questionNumber: number | null;
  sourceFile: string | null;
  unitId: string;
  grade: string;
  chapter: string;
  section: string;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** 캐시 안의 칸 높이는 하나여야 한다 — 여럿이면 다른 지면을 잰 줄이 섞인 것이다. */
function singleSlot(rows: Measured[]): number {
  const distinct = [...new Set(rows.map((r) => r.availPx))];
  if (distinct.length !== 1)
    throw new Error(
      `캐시 안의 문항 칸이 ${distinct.length}가지다(${distinct.slice(0, 5).join(", ")}) — 다른 지면을 잰 줄이 섞였다.`,
    );
  return distinct[0]!;
}

async function fetchRows(): Promise<Row[]> {
  return (await prisma.$queryRawUnsafe(
    `SELECT p.id, p.content, p.figure_urls AS "figureUrls", p.figure_dims AS "figureDims",
            p.question_type AS "questionType", p.problem_type AS "problemType",
            p.difficulty::text AS difficulty, p.source::text AS source,
            p.review_status::text AS "reviewStatus", p.direct_use_allowed AS "directUseAllowed",
            p.pool::text AS pool, p.answer = '(정답 없음)' AS "noAnswer",
            p.school, p.exam_id AS "examId", p.question_number AS "questionNumber",
            p.source_file AS "sourceFile",
            p.unit_id AS "unitId", u.grade, u.chapter, u.section
       FROM problem p JOIN unit u ON u.id = p.unit_id
      ORDER BY p.id`,
  )) as Row[];
}

/** 출제 자격 — `findEligibleProblems` 의 where 절 그대로 (D-22·D-26·D-31). */
const isEligible = (r: Row) =>
  r.pool === "shared" &&
  r.reviewStatus === "approved" &&
  r.directUseAllowed &&
  !r.noAnswer;

const dimsOf = (r: Row): (FigureDim | null)[] =>
  r.figureUrls.map((url) => {
    const d = readFigureDimensions(url);
    return d ? { width: d[0], height: d[1] } : null;
  });

const pct = (n: number, of: number) =>
  of > 0 ? `${((n * 100) / of).toFixed(2)}%` : "—";

async function main() {
  const cachePath = arg("--cache") ?? ".measure/cont2.json";
  const outPath =
    arg("--out") ?? "docs/planning/tracks/reports/oversize-problems-tables.md";
  const jsonPath = arg("--json") ?? "scripts/qa/reports/oversize-problems.json";
  const eyeballPath = arg("--eyeball");

  if (!existsSync(cachePath)) throw new Error(`캐시가 없다: ${cachePath}`);
  const cache = JSON.parse(readFileSync(cachePath, "utf8")) as Measured[];
  const rows = await fetchRows();

  /* -- (1) 캐시가 지금 지면·지금 본문과 맞는가 ------------------------- */
  const cacheSlot = singleSlot(cache);
  const stale = heightCacheProblems(readHeightCacheManifest(cachePath), {
    kind: "continuation",
    rows: cache.length,
    rowsHash: measuredRowsHash(rows),
    slotPx: cacheSlot,
  });
  if (stale.length > 0) {
    console.error(`캐시가 낡았다 - 아무것도 세지 않는다 (${cachePath})`);
    for (const p of stale)
      console.error(`  - ${p.what}: 캐시 ${p.cached} / 지금 ${p.now}`);
    console.error(
      "\n  npx tsx scripts/qa/measure-print-overflow.tsx --json .measure/cont2.json           (전수)\n" +
        "  npx tsx scripts/qa/measure-print-overflow.tsx --verify .measure/cont2.json --repair (표본+바뀐 문항)",
    );
    process.exitCode = 1;
    return;
  }
  if (cacheSlot !== JASEUP_MEASURED_PX.continuationSlot)
    throw new Error(
      `캐시의 실측 칸 ${cacheSlot}px 과 상수 ${JASEUP_MEASURED_PX.continuationSlot}px 이 다르다 - 자가 바뀌었다.`,
    );

  /* -- (2) 「가장 큰 칸」 ---------------------------------------------- */
  const {
    firstPageSlot,
    continuationSlot,
    soloFirstPageSlot,
    soloContinuationSlot,
    figureMaxWidth,
    problemColumn,
    figureGap,
  } = JASEUP_MEASURED_PX;
  const biggestSlot = Math.max(
    firstPageSlot,
    continuationSlot,
    soloFirstPageSlot,
    soloContinuationSlot,
  );
  if (biggestSlot !== soloContinuationSlot)
    throw new Error(
      "가장 큰 칸이 «혼자 쓰는 이어지는 장»이 아니다 - 자리 모형을 다시 볼 것.",
    );

  const heightById = new Map(cache.map((m) => [m.pid, m]));

  /* -- (3) 정책 계산기가 제품 함수와 같은지 전량 대조 ------------------ */
  let mismatch = 0;
  for (const r of rows) {
    if (r.figureUrls.length === 0) continue;
    const d = dimsOf(r);
    if (
      Math.abs(estimateFigureBlockPx(d) - figureBlockPxAt(d, figureMaxWidth)) >
      1e-9
    )
      mismatch += 1;
  }
  if (mismatch > 0)
    throw new Error(
      `그림 높이 계산이 제품 함수와 ${mismatch}행에서 다르다 - 정책 값을 낼 수 없다.`,
    );

  /* -- (4) 세기 -------------------------------------------------------- */
  const pool = rows.filter(isEligible);
  const heightOf = (r: Row) => heightById.get(r.id)?.neededPx ?? 0;
  const oversizeAll = rows.filter((r) => heightOf(r) > biggestSlot);
  const oversizePool = oversizeAll.filter(isEligible);
  const band = (list: Row[], lo: number, hi: number) =>
    list.filter((r) => heightOf(r) > lo && heightOf(r) <= hi).length;

  /* -- (5) 부류 -------------------------------------------------------- */
  const CAP_2COL = capForColumns(2);
  const CAP_3COL = capForColumns(3);
  /** 권고안 - 그림이 2장 이상이면 2열, 5장 이상이면 3열이 되도록 상한을 좁힌다. */
  const proposedCap = (n: number) =>
    n >= 5 ? CAP_3COL : n >= 2 ? CAP_2COL : figureMaxWidth;

  interface Judged {
    row: Row;
    m: Measured;
    klass: OversizeClass;
    problemCount: number;
    afterCapPx: number;
    eligible: boolean;
  }
  const heightAtCap = (row: Row, cap: (n: number) => number): number => {
    const m = heightById.get(row.id)!;
    const d = dimsOf(row);
    if (d.length === 0) return m.neededPx;
    // 실측 figurePx 는 `mt-3`(figureBlockTop) 을 빼고 잰 값이라 추정과 그만큼 다르다.
    return (
      m.neededPx -
      m.figurePx +
      figureBlockPxAt(d, cap(d.length)) -
      JASEUP_MEASURED_PX.figureBlockTop
    );
  };

  const judged: Judged[] = oversizeAll.map((row) => {
    const m = heightById.get(row.id)!;
    const { klass, problemCount } = classifyOversize({
      content: row.content ?? "",
      figureCount: row.figureUrls.length,
      figurePx: m.figurePx,
      neededPx: m.neededPx,
    });
    return {
      row,
      m,
      klass,
      problemCount,
      afterCapPx: heightAtCap(row, proposedCap),
      eligible: isEligible(row),
    };
  });
  const classes = [...new Set(judged.map((j) => j.klass))].sort(
    (a, b) =>
      judged.filter((j) => j.klass === b).length -
      judged.filter((j) => j.klass === a).length,
  );

  /* -- (6) 단원별 손실 - 폐기하면 어느 단원이 얇아지나 (D-20) ---------- */
  const poolByUnit = new Map<string, Row[]>();
  for (const r of pool) {
    const list = poolByUnit.get(r.unitId) ?? [];
    list.push(r);
    poolByUnit.set(r.unitId, list);
  }
  const lossByUnit = new Map<
    string,
    { unit: Row; pool: number; lost: number }
  >();
  for (const j of judged) {
    if (!j.eligible) continue;
    const cur = lossByUnit.get(j.row.unitId) ?? {
      unit: j.row,
      pool: poolByUnit.get(j.row.unitId)?.length ?? 0,
      lost: 0,
    };
    cur.lost += 1;
    lossByUnit.set(j.row.unitId, cur);
  }

  /* -- (7) 출력 -------------------------------------------------------- */
  const out: string[] = [];
  const push = (s = "") => out.push(s);
  push(
    `<!-- npx tsx scripts/qa/report-oversize-problems.ts 가 표(§0~§5)를 만든다. 서술은 사람이 쓴다. -->`,
  );
  push(`# 어느 칸에도 안 들어가는 문항 - 표 (도구 산출물)`);
  push();
  push(
    `> 읽는 문서는 옆의 \`oversize-problems.md\` 다. 이 파일은 그 문서의 숫자가 나온 자리다.`,
  );
  push();
  push(
    `> 잰 캐시 \`${cachePath}\` (지문 확인함) · 문항 칸은 **지면 실측**이다.`,
  );
  push();
  push(`## 0. 분모와 조건`);
  push();
  push(`| 무엇 | 값 |`);
  push(`| --- | --- |`);
  push(`| DB 전량 | ${rows.length.toLocaleString()}건 |`);
  push(
    `| 출제 가능 풀 (\`findEligibleProblems\` where 그대로) | ${pool.length.toLocaleString()}건 |`,
  );
  push(`| 문항 칸 - 1·2번 자리(첫 장, 그 장에 둘) | ${firstPageSlot}px |`);
  push(`| 문항 칸 - 이어지는 장, 그 장에 둘 | ${continuationSlot}px |`);
  push(`| 문항 칸 - 첫 장에 혼자 | ${soloFirstPageSlot}px |`);
  push(
    `| **가장 큰 칸** - 이어지는 장에 혼자 | **${soloContinuationSlot}px** |`,
  );
  push(
    `| 문항 열 폭 / 그림 폭 상한 / 그림 간격 | ${problemColumn}px / ${figureMaxWidth.toFixed(1)}px(70mm) / ${figureGap}px |`,
  );
  push();
  push(
    `「어느 칸에도 안 들어간다」 = 실측 높이 > **${soloContinuationSlot}px**. 홀수 문항 시험지의`,
  );
  push(`마지막 자리가 그 칸이고, 그보다 큰 자리는 없다.`);
  push();
  push(`## 1. 다시 센 결과`);
  push();
  push(`| 구간 | 출제 가능 풀 | DB 전량 |`);
  push(`| --- | ---: | ---: |`);
  const le405 = pool.filter((r) => heightOf(r) <= firstPageSlot).length;
  push(
    `| <= ${firstPageSlot}px (어느 자리에나 들어감) | ${le405.toLocaleString()} (${pct(le405, pool.length)}) | ${rows.filter((r) => heightOf(r) <= firstPageSlot).length.toLocaleString()} |`,
  );
  push(
    `| ${firstPageSlot}~${continuationSlot}px (이어지는 장에만) | ${band(pool, firstPageSlot, continuationSlot).toLocaleString()} | ${band(rows, firstPageSlot, continuationSlot).toLocaleString()} |`,
  );
  push(
    `| ${continuationSlot}~${soloContinuationSlot}px (혼자 쓰는 칸에만) | ${band(pool, continuationSlot, soloContinuationSlot).toLocaleString()} | ${band(rows, continuationSlot, soloContinuationSlot).toLocaleString()} |`,
  );
  push(
    `| **> ${soloContinuationSlot}px (어느 칸에도 안 들어감)** | **${oversizePool.length.toLocaleString()} (${pct(oversizePool.length, pool.length)})** | **${oversizeAll.length.toLocaleString()}** |`,
  );
  push();
  push(`## 2. 왜 긴가 - 부류`);
  push();
  push(`| 부류 | 출제 가능 | DB 전량 | 중앙 높이 | 어디서 다루나 |`);
  push(`| --- | ---: | ---: | ---: | --- |`);
  for (const klass of classes) {
    const list = judged.filter((j) => j.klass === klass);
    const med = [...list].sort((a, b) => a.m.neededPx - b.m.neededPx)[
      Math.floor(list.length / 2)
    ]!;
    push(
      `| ${klass} | ${list.filter((j) => j.eligible).length} | ${list.length} | ${med.m.neededPx.toFixed(0)}px | ${CLASS_REMEDY[klass]} |`,
    );
  }
  push(
    `| **합계** | **${oversizePool.length}** | **${oversizeAll.length}** | | |`,
  );
  push();
  push(`## 3. 그림 폭 상한을 줄이면 - 지면 정책의 값`);
  push();
  push(
    `한 줄에 2장을 놓으려면 상한이 **${CAP_2COL.toFixed(1)}px(${(CAP_2COL / MM_TO_PX).toFixed(1)}mm)** 이하,`,
  );
  push(
    `3장이면 **${CAP_3COL.toFixed(1)}px(${(CAP_3COL / MM_TO_PX).toFixed(1)}mm)** 이하여야 한다 (문항 열 ${problemColumn}px · 간격 ${figureGap}px).`,
  );
  push();
  push(
    `| 상한 | > ${soloContinuationSlot}px | > ${continuationSlot}px | > ${firstPageSlot}px | 중앙 높이 |`,
  );
  push(`| --- | ---: | ---: | ---: | ---: |`);
  const capScenarios: [string, (n: number) => number][] = [
    [`현행 (늘 70mm)`, () => figureMaxWidth],
    [`늘 ${(CAP_2COL / MM_TO_PX).toFixed(0)}mm`, () => CAP_2COL],
    ["2장+ -> 2열", (n) => (n >= 2 ? CAP_2COL : figureMaxWidth)],
    ["2장+ -> 2열 · 5장+ -> 3열 (권고)", proposedCap],
  ];
  for (const [label, cap] of capScenarios) {
    const alt = oversizeAll.map((row) => heightAtCap(row, cap));
    const s = [...alt].sort((a, b) => a - b);
    push(
      `| ${label} | ${alt.filter((n) => n > soloContinuationSlot).length} | ${alt.filter((n) => n > continuationSlot).length} | ${alt.filter((n) => n > firstPageSlot).length} | ${s[Math.floor(s.length / 2)]!.toFixed(0)}px |`,
    );
  }
  push();
  push(`부류마다 권고안(2열/3열)을 걸었을 때 남는 수:`);
  push();
  push(
    `| 부류 | 건수 | 권고안 뒤 > ${soloContinuationSlot}px | 권고안 뒤 중앙 높이 |`,
  );
  push(`| --- | ---: | ---: | ---: |`);
  for (const klass of classes) {
    const list = judged.filter((j) => j.klass === klass);
    const s = list.map((j) => j.afterCapPx).sort((a, b) => a - b);
    push(
      `| ${klass} | ${list.length} | ${list.filter((j) => j.afterCapPx > soloContinuationSlot).length} | ${s[Math.floor(s.length / 2)]!.toFixed(0)}px |`,
    );
  }
  push();
  push(`그림 장수별 — 「그림이 지면을 먹는다」 부류가 실제로 어떤 모양인가:`);
  push();
  push(
    `| 그림 장수 | 건수 | 중앙 높이 | 권고안 뒤 중앙 | 권고안 뒤 > ${soloContinuationSlot}px |`,
  );
  push(`| ---: | ---: | ---: | ---: | ---: |`);
  const figClass = judged.filter(
    (j) => j.klass === "그림이 지면을 먹는다 — 본문은 짧다",
  );
  for (const n of [
    ...new Set(figClass.map((j) => j.row.figureUrls.length)),
  ].sort((a, b) => a - b)) {
    const list = figClass.filter((j) => j.row.figureUrls.length === n);
    const before = list.map((j) => j.m.neededPx).sort((a, b) => a - b);
    const after = list.map((j) => j.afterCapPx).sort((a, b) => a - b);
    push(
      `| ${n}장 | ${list.length} | ${before[Math.floor(before.length / 2)]!.toFixed(0)}px | ${after[Math.floor(after.length / 2)]!.toFixed(0)}px | ${list.filter((j) => j.afterCapPx > soloContinuationSlot).length} |`,
    );
  }
  push();
  push(`## 4. 폐기하면 어느 단원이 얇아지나 (D-20)`);
  push();
  push(`| 단원 | 출제 가능 풀 | 잃는 수 | 남는 수 |`);
  push(`| --- | ---: | ---: | ---: |`);
  const losses = [...lossByUnit.values()].sort(
    (a, b) => b.lost - a.lost || a.pool - b.pool,
  );
  for (const l of losses)
    push(
      `| ${l.unit.grade} ${l.unit.chapter} > ${l.unit.section} | ${l.pool} | ${l.lost} | ${l.pool - l.lost} |`,
    );
  push();
  push(
    `단원 ${lossByUnit.size}개가 영향을 받는다. 전량 폐기해도 8문항(일일테스트 기본 정원) 아래로`,
  );
  push(
    `내려가는 단원은 **${losses.filter((l) => l.pool - l.lost < 8).length}개**, 25문항 아래는 **${losses.filter((l) => l.pool - l.lost < 25).length}개**다.`,
  );
  push();
  push(`## 5. 전량 목록`);
  push();
  push(`| # | 높이 | 권고안 뒤 | 그림 | 부류 | 출제 | 학교/번호 | 단원 |`);
  push(`| ---: | ---: | ---: | ---: | --- | :-: | --- | --- |`);
  [...judged]
    .sort((a, b) => b.m.neededPx - a.m.neededPx)
    .forEach((j, i) => {
      push(
        `| ${i + 1} | ${j.m.neededPx.toFixed(0)} | ${j.afterCapPx.toFixed(0)} | ${j.row.figureUrls.length} | ${j.klass} | ${j.eligible ? "O" : "-"} | ${j.row.school ?? "?"} ${j.row.questionNumber ?? "?"}번 | ${j.row.grade} ${j.row.section} |`,
      );
    });
  push();

  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, out.join("\n"), "utf8");
  mkdirSync(path.dirname(jsonPath), { recursive: true });
  writeFileSync(
    jsonPath,
    JSON.stringify(
      [...judged]
        .sort((a, b) => b.m.neededPx - a.m.neededPx)
        .map((j) => ({
          id: j.row.id,
          neededPx: j.m.neededPx,
          figurePx: j.m.figurePx,
          choicePx: j.m.choicePx,
          boxPx: j.m.boxPx,
          figures: j.row.figureUrls.length,
          klass: j.klass,
          problemCount: j.problemCount,
          afterCapPx: j.afterCapPx,
          eligible: j.eligible,
          school: j.row.school,
          examId: j.row.examId,
          questionNumber: j.row.questionNumber,
          grade: j.row.grade,
          chapter: j.row.chapter,
          section: j.row.section,
          sourceFile: j.row.sourceFile,
        })),
      null,
      1,
    ),
    "utf8",
  );

  if (eyeballPath) {
    const dump: string[] = [
      `# 넘침 ${judged.length}건 - 전량 눈으로 볼 것 (캐시 ${cachePath})\n`,
    ];
    [...judged]
      .sort((a, b) => b.m.neededPx - a.m.neededPx)
      .forEach((j, i) => {
        const figs = j.row.figureUrls.map((u) => {
          const d = readFigureDimensions(u);
          if (!d) return `${u} (치수 모름/파일 없음)`;
          const scale = Math.min(1, figureMaxWidth / d[0]);
          return `${u} ${d[0]}x${d[1]} -> 인쇄 ${Math.round(d[0] * scale)}x${Math.round(d[1] * scale)}`;
        });
        dump.push(
          `${"=".repeat(96)}\n[${i + 1}/${judged.length}] ${j.row.id} **${j.m.neededPx.toFixed(0)}px** -> 권고안 ${j.afterCapPx.toFixed(0)}px\n` +
            `  부류: ${j.klass} · 문항 ${j.problemCount}개로 봄 · 출제가능 ${j.eligible}\n` +
            `  실측 그림 ${j.m.figurePx.toFixed(0)} 보기 ${j.m.choicePx.toFixed(0)} 상자 ${j.m.boxPx.toFixed(0)}\n` +
            `  ${j.row.school ?? "?"} exam ${j.row.examId ?? "?"} ${j.row.questionNumber ?? "?"}번 · ${j.row.grade} ${j.row.chapter} > ${j.row.section}\n` +
            `  ${j.row.source} ${j.row.questionType} review=${j.row.reviewStatus} 정답없음=${j.row.noAnswer}\n` +
            `  ${j.row.sourceFile ?? "-"}\n` +
            (figs.length
              ? `  그림:\n${figs.map((f) => `    - ${f}`).join("\n")}\n`
              : "") +
            `  -- 본문 (${j.row.content.length}자) --\n${j.row.content
              .slice(0, 1400)
              .split("\n")
              .map((l) => "  | " + l)
              .join("\n")}\n`,
        );
      });
    mkdirSync(path.dirname(eyeballPath), { recursive: true });
    writeFileSync(eyeballPath, dump.join("\n"), "utf8");
    console.log(`-> ${eyeballPath}`);
  }

  console.log(
    `출제 가능 ${pool.length.toLocaleString()}건 중 넘침 ${oversizePool.length}건 (${pct(oversizePool.length, pool.length)}) · DB 전량 ${oversizeAll.length}건`,
  );
  for (const klass of classes)
    console.log(
      `  ${klass}: ${judged.filter((j) => j.klass === klass && j.eligible).length} (전량 ${judged.filter((j) => j.klass === klass).length})`,
    );
  console.log(`-> ${outPath}\n-> ${jsonPath}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
