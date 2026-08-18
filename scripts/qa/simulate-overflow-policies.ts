/**
 * ⑷·⑸-c 가 **실제로 얼마나 버는가** — 실제 출제 엔진으로 시험지를 만들어 잰다 (읽기 전용).
 *
 *   npx tsx scripts/qa/simulate-overflow-policies.ts
 *   npx tsx scripts/qa/simulate-overflow-policies.ts --trials 40 --counts 8,25
 *   npx tsx scripts/qa/simulate-overflow-policies.ts --heights .measure/cont-fit.json
 *
 * ## 이 도구가 §11 때와 달라진 것 — **정책을 흉내 내지 않는다**
 *
 * §11(제안 단계)에서는 정책이 제품에 없었으므로 이 스크립트가 «거르기»와 «맞바꿈»을
 * 스스로 구현해 견줬다. 이제 원장님 확정으로 정책이 제품에 들어갔다 —
 * 흉내가 남아 있으면 제품과 갈라져도 아무도 모른다(적대적 리뷰 ④ §E 와 같은 결함).
 * 그래서 **두 팔 모두 제품 `selectProblems` 를 그대로 부른다.**
 *
 *   현행   후보에서 지면 셋(`content`·`figureUrls`·`figureDims`)을 **떼고** 부른다.
 *          엔진이 지면을 못 보던 때와 결과가 같다(회귀 가드
 *          `selectFitsPage.test.ts` 의 「풀 전체가 «모른다»면 …」 가 그걸 잠근다).
 *   지금   후보를 그대로 넘겨 부른다 = 제품이 지금 하는 일.
 *
 * ⑸-a·⑸-b(완전 재배열)의 비교는 §11 표에 남아 있다. 원장님이 **하지 않기로**
 * 확정했으므로 여기서는 재현하지 않는다 — 제품에 없는 정책을 흉내 낸 코드를
 * 남겨 두는 것이 바로 위에서 말한 그 위험이다.
 *
 * ## 무엇이 «참» 인가
 *
 * 넘침의 참은 **실측 높이**(`.measure/*.json` 의 `neededPx`)와 **실측 칸**이다.
 * 제품의 추정치로 채점하면 제품이 틀릴수록 성적이 좋아진다(리뷰 §E). 그래서
 *   · 캐시가 실측한 칸 `availPx` 가 제품 상수와 다르면 **멈춘다**,
 *   · 캐시 지문이 지금 지면·본문·그림 파일과 어긋나도 **멈춘다**(리뷰 §F·§L).
 *
 * ⚠️ **일일테스트는 단원 «하나»에서만 뽑는다**(`resolveRange`) — 가장 얇은 조건이다.
 *    ⑷ 의 위험(풀이 얇은 단원에서 출제가 막힘)이 거기 있으므로 그 조건으로 잰다.
 */
import { readFileSync } from "node:fs";

import { PrismaClient } from "@prisma/client";

import type { TestPrintProblem } from "../../src/components/print/types";
import type { DifficultyRatio } from "../../src/contracts/common.contract";
import {
  risksTightSeat,
  seatCapacitiesFor,
  selectProblems,
} from "../../src/lib/generator/selectProblems";
import { JASEUP_MEASURED_PX } from "../../src/lib/printGeometry";
import { assessOverflowRisk } from "../../src/lib/printOverflow";
import {
  assertHeightCacheFresh,
  measuredRowsHash,
} from "./heightCacheManifest";

const prisma = new PrismaClient();

interface Height {
  pid: string;
  availPx: number;
  neededPx: number;
}

/** 후보 한 건 — 제품이 읽는 것 그대로 + 채점용 실측 높이. */
interface Row {
  id: string;
  unitId: string;
  difficulty: "easy" | "mid" | "hard";
  problemType: string;
  directUseAllowed: boolean;
  content?: string;
  figureUrls?: string[];
  figureDims?: number[];
  /** 채점의 «참» — 지면을 그려 잰 값이다. 제품은 이 값을 못 본다. */
  neededPx: number;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** 엔진이 지면을 못 보던 때 — 지면 셋을 떼고 부른다. */
function blind(row: Row): Row {
  const { content, figureUrls, figureDims, ...rest } = row;
  void content;
  void figureUrls;
  void figureDims;
  return rest;
}

const toPrint = (rows: Row[]): TestPrintProblem[] =>
  rows.map((r, index) => ({
    id: r.id,
    orderIndex: index,
    content: r.content ?? "",
    answer: "1",
    solution: null,
    figureUrls: r.figureUrls ?? [],
    figureDims: r.figureDims ?? [],
  }));

/** 그 배치에서 **실제로** 넘치는 문항 수 — 참은 실측 높이와 실측 칸이다. */
function overflowCount(order: Row[], seats: number[]): number {
  let n = 0;
  for (let i = 0; i < order.length; i += 1)
    if (order[i]!.neededPx > seats[i]!) n += 1;
  return n;
}

/** `arrangeByType` 가 막으려는 것 — 같은 유형이 3개 연속인 자리 수. */
function consecutiveViolations(order: Row[]): number {
  let n = 0;
  for (let i = 2; i < order.length; i += 1)
    if (
      order[i]!.problemType === order[i - 1]!.problemType &&
      order[i]!.problemType === order[i - 2]!.problemType
    )
      n += 1;
  return n;
}

/**
 * 난이도 배분은 **개수**이고 합이 문항 수와 같아야 한다(`test.contract.ts`).
 * 반 기본값 `{easy:3, mid:4, hard:1}`(=8문항)의 비율을 그대로 늘린다.
 */
function ratioFor(count: number): DifficultyRatio {
  const easy = Math.round((count * 3) / 8);
  const hard = Math.round((count * 1) / 8);
  return { easy, hard, mid: count - easy - hard };
}

interface Arm {
  label: string;
  overflow: number;
  warnings: number;
  warnedSheets: number;
  typeBreak: number;
  substitutions: number;
  allFitting: number;
  distinct: Map<string, Set<string>>;
}

const newArm = (label: string): Arm => ({
  label,
  overflow: 0,
  warnings: 0,
  warnedSheets: 0,
  typeBreak: 0,
  substitutions: 0,
  allFitting: 0,
  distinct: new Map(),
});

async function main() {
  const trials = Number(arg("--trials") ?? 30);
  const heightsPath = arg("--heights") ?? ".measure/cont.json";
  const counts = (arg("--counts") ?? "8,25")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);

  const heights = JSON.parse(readFileSync(heightsPath, "utf8")) as Height[];

  /* ── 참이 지금 지면에서 온 것인지 먼저 본다 (리뷰 §E·§F) ─────────────────── */
  const slots = [...new Set(heights.map((h) => h.availPx))];
  if (slots.length !== 1)
    throw new Error(
      `캐시의 문항 칸이 ${slots.length}가지다(${slots.slice(0, 5).join(", ")}) — 캐시가 섞였다.`,
    );
  const slot = slots[0]!;
  if (slot !== JASEUP_MEASURED_PX.continuationSlot)
    throw new Error(
      `실측 문항 칸 ${slot}px 과 제품 상수 ${JASEUP_MEASURED_PX.continuationSlot}px 이 다르다 —\n` +
        `자리 계산이 지면과 어긋난 값에서 나오고 있다. 캐시가 «이어지는 장» 것이 맞는지 먼저 볼 것.`,
    );

  /**
   * ⚠️ **캐시는 문항 «전부»를 잰 것이고, 출제 풀은 그 부분집합이다.**
   * 지문(`rowsHash`)은 잰 것과 **같은 집합**으로 계산해야 한다 — 출제 자격으로 좁힌
   * 집합으로 계산하면 지문이 늘 어긋나 「캐시가 낡았다」는 거짓 경보가 난다.
   * 그래서 전부를 읽고, 출제 자격(`findEligibleProblems` 의 where 절 그대로,
   * D-22·D-26·D-31)은 열 하나로 같이 받아 **여기서** 가른다.
   */
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT id, unit_id AS "unitId", difficulty, problem_type AS "problemType",
            content, figure_urls AS "figureUrls", figure_dims AS "figureDims",
            question_type AS "questionType",
            (pool = 'shared' AND review_status = 'approved'
             AND direct_use_allowed = TRUE AND answer <> '(정답 없음)') AS eligible
       FROM problem ORDER BY id`,
  )) as Array<
    Omit<Row, "neededPx" | "directUseAllowed"> & {
      content: string;
      figureUrls: string[];
      figureDims: number[];
      questionType: string | null;
      eligible: boolean;
    }
  >;
  const byId = new Map(rows.map((r) => [r.id, r]));

  // 캐시에 있는데 DB 에 없는 문항이 있으면 캐시가 낡은 것이다.
  const missing = heights.filter((h) => !byId.has(h.pid)).length;
  if (missing > 0)
    throw new Error(
      `캐시에 있는 문항 ${missing}건이 지금 DB 에 없다 — 캐시가 낡았다. 다시 재라.`,
    );

  /**
   * 캐시가 **지금 지면·지금 본문·지금 그림 파일**을 보고 잰 것인지 지문으로 대조한다.
   * 지문이 없거나 어긋나면 멈춘다 — 그 숫자는 거짓이다(리뷰 §F, 검수 §L).
   */
  assertHeightCacheFresh(heightsPath, {
    kind: "continuation",
    rows: heights.length,
    rowsHash: measuredRowsHash(
      rows.map((r) => ({
        id: r.id,
        content: r.content,
        figureUrls: r.figureUrls,
        questionType: r.questionType,
      })),
    ),
    slotPx: slot,
  });

  const neededById = new Map(heights.map((h) => [h.pid, h.neededPx]));
  const pool: Row[] = [];
  /**
   * 잰 뒤에 들어온 문항 — 높이를 모르니 이 시뮬레이션에서 빠진다.
   * **조용히 빼지 않고 센다.** 침묵하면 「전부 쟀다」로 읽힌다.
   */
  let unmeasured = 0;
  for (const r of rows) {
    if (!r.eligible) continue;
    const neededPx = neededById.get(r.id);
    if (neededPx === undefined) {
      unmeasured += 1;
      continue;
    }
    pool.push({
      id: r.id,
      unitId: r.unitId,
      difficulty: r.difficulty,
      problemType: r.problemType,
      directUseAllowed: true,
      content: r.content,
      figureUrls: r.figureUrls,
      figureDims: r.figureDims,
      neededPx,
    });
  }
  if (unmeasured > 0)
    console.log(
      `⚠️ 출제 자격은 있는데 **높이를 안 잰** 문항 ${unmeasured.toLocaleString()}건 — 캐시를 뜬 뒤 들어온 것이다. 이 시뮬레이션에서는 빠진다.`,
    );

  /* ── 검산 — 출제의 후순위 판정 ↔ 인쇄 경고가 한 건도 다르지 않은가 ────────── */
  {
    let drift = 0;
    let example = "";
    const filler: TestPrintProblem = {
      id: "filler",
      orderIndex: 0,
      content: "",
      answer: "",
      solution: null,
    };
    for (const p of pool) {
      // 3번 자리 = 이어지는 장의 반 칸(484px). 캐시가 잰 것과 같은 자리다.
      const placed = [filler, filler, ...toPrint([p]), filler];
      const warned = assessOverflowRisk(placed).some((r) => r.number === 3);
      if (risksTightSeat(p, JASEUP_MEASURED_PX.continuationSlot) !== warned) {
        drift += 1;
        if (!example) example = p.id;
      }
    }
    if (drift > 0)
      throw new Error(
        `출제의 후순위 판정이 인쇄 경고와 ${drift}건 다르다 — 규칙이 두 벌이 됐다. 예: ${example}`,
      );
    console.log(
      `검산 · 출제 후순위 판정 ↔ 인쇄 경고 일치 (0건 불일치, ${pool.length.toLocaleString()}건 전수)`,
    );
  }

  const { firstPageSlot, continuationSlot, soloContinuationSlot } =
    JASEUP_MEASURED_PX;
  const fitsAnywhere = pool.filter((p) => p.neededPx <= firstPageSlot).length;
  const fitsContinuation = pool.filter(
    (p) => p.neededPx <= continuationSlot,
  ).length;
  const fitsOnlySolo = pool.filter(
    (p) => p.neededPx > continuationSlot && p.neededPx <= soloContinuationSlot,
  ).length;
  const fitsNowhere = pool.filter(
    (p) => p.neededPx > soloContinuationSlot,
  ).length;
  const pct = (n: number) => `${((n * 100) / pool.length).toFixed(1)}%`;
  console.log(
    `출제 가능 문항 ${pool.length.toLocaleString()}건 (approved · 직접출제 허용 · 정답 있음 · 공용)\n` +
      `  어느 자리에나 들어감(≤${firstPageSlot}px) ${fitsAnywhere.toLocaleString()} (${pct(fitsAnywhere)})\n` +
      `  이어지는 장에는 들어감(≤${continuationSlot}px) ${fitsContinuation.toLocaleString()} (${pct(fitsContinuation)})\n` +
      `  혼자 쓰는 칸에만 들어감 ${fitsOnlySolo.toLocaleString()} (${pct(fitsOnlySolo)})\n` +
      `  **어느 칸에도 안 들어감** ${fitsNowhere.toLocaleString()} (${pct(fitsNowhere)})`,
  );

  /** 「현행」팔은 지면 셋을 뗀 사본으로 뽑으므로, 채점할 때 원래 행으로 되돌린다. */
  const rowById = new Map(pool.map((p) => [p.id, p]));

  const byUnit = new Map<string, Row[]>();
  for (const p of pool) {
    const list = byUnit.get(p.unitId) ?? [];
    list.push(p);
    byUnit.set(p.unitId, list);
  }
  console.log(`\n단원 ${byUnit.size.toLocaleString()}개`);

  for (const count of counts) {
    const seats = seatCapacitiesFor(count);
    const ratio = ratioFor(count);
    const seatDesc = `${seats.filter((s) => s === firstPageSlot).length}×${firstPageSlot} · ${seats.filter((s) => s === continuationSlot).length}×${continuationSlot}${
      count % 2 === 1 ? ` · 1×${seats[seats.length - 1]}` : ""
    }`;
    console.log(
      `\n${"═".repeat(76)}\n일일테스트(단원 하나) ${count}문항 · 자리 ${seatDesc}\n${"═".repeat(76)}`,
    );

    const units = [...byUnit.entries()].filter(
      ([, list]) => list.length >= count,
    );
    console.log(
      `  ${count}문항을 뽑을 수 있는 단원 ${units.length.toLocaleString()} / ${byUnit.size.toLocaleString()}`,
    );

    const arms = [newArm("현행(엔진이 지면을 못 봄)"), newArm("지금(제품)")];
    let sheets = 0;
    // 「들어가는 문항」만으로 정원을 못 채우는 단원 — ⑷ 의 위험이 여기 있다.
    let thinUnits = 0;
    /**
     * 정원을 못 채운 시험지 — **조용히 버리지 않고 센다.**
     * 원인은 ⑷ 가 아니라 난이도 구성이다(hard 의 인접은 mid 뿐이라, 문항이 한
     * 난이도에 몰린 단원은 hard 자리를 못 채운다 — D-20 `INSUFFICIENT_PROBLEMS`).
     * 옛 엔진으로 같은 것을 재면 **건수가 같다**. 그래도 세어 두지 않으면 이 표가
     * 「전부 만들어 봤다」로 읽힌다.
     */
    let shortSheets = 0;

    for (const [unitId, list] of units) {
      if (list.filter((p) => p.neededPx <= continuationSlot).length < count)
        thinUnits += 1;
      for (let t = 0; t < trials; t += 1) {
        const seed = `${unitId}:${t}`;
        const runs = [
          selectProblems<Row>({
            pool: list.map(blind),
            difficultyRatio: ratio,
            count,
            recentProblemIds: [],
            seed,
          }),
          selectProblems<Row>({
            pool: list,
            difficultyRatio: ratio,
            count,
            recentProblemIds: [],
            seed,
          }),
        ];
        if (runs.some((r) => r.problems.length < count)) {
          shortSheets += 1;
          continue;
        }
        sheets += 1;

        runs.forEach((run, index) => {
          const arm = arms[index]!;
          // 「현행」팔은 지면 셋을 떼고 뽑았으므로 채점·경고는 원래 행으로 되돌린다.
          const order = run.problems.map((p) => rowById.get(p.id)!);
          arm.overflow += overflowCount(order, seats);
          const risks = assessOverflowRisk(toPrint(order));
          arm.warnings += risks.length;
          if (risks.length > 0) arm.warnedSheets += 1;
          arm.typeBreak += consecutiveViolations(order);
          arm.substitutions += run.substitutions.length;
          if (order.every((p) => p.neededPx <= continuationSlot))
            arm.allFitting += 1;
          const seen = arm.distinct.get(unitId) ?? new Set<string>();
          for (const p of order) seen.add(p.id);
          arm.distinct.set(unitId, seen);
        });
      }
    }

    const per = (n: number) => (n / Math.max(1, sheets)).toFixed(3);
    const share = (n: number) =>
      `${((n * 100) / Math.max(1, sheets)).toFixed(1)}%`;
    const base = arms[0]!;
    const cut = (n: number) =>
      base.overflow === 0
        ? "   —  "
        : `${(((base.overflow - n) * 100) / base.overflow).toFixed(1)}%`;

    console.log(
      `  시험지 ${sheets.toLocaleString()}장 (단원마다 ${trials}회)` +
        (shortSheets > 0
          ? ` · 정원을 못 채워 뺀 시험지 ${shortSheets.toLocaleString()}장 (난이도 구성 탓 — 두 팔 모두 같다)`
          : ""),
    );
    console.log(
      `  ┌ 정책 ───────────────── 실제로 넘치는 문항 ── 줄어든 몫 ── 경고 ── 경고가 뜨는 시험지`,
    );
    for (const arm of arms) {
      console.log(
        `  │ ${arm.label.padEnd(22)} ${per(arm.overflow).padStart(6)}건   ` +
          `${cut(arm.overflow).padStart(7)}   ${per(arm.warnings).padStart(6)}건   ${share(arm.warnedSheets).padStart(6)}`,
      );
    }
    console.log(`  └ 무엇을 잃는가`);
    console.log(
      `      「들어가는 문항」만으로 정원을 못 채우는 단원 ${thinUnits}/${units.length}` +
        ` · 고른 문항이 전부 들어가던 시험지 ${share(base.allFitting)} → ${share(arms[1]!.allFitting)}`,
    );
    console.log(
      `      난이도 대체 ${per(base.substitutions)} → ${per(arms[1]!.substitutions)}건/장` +
        ` · 같은 유형 3연속 ${per(base.typeBreak)} → ${per(arms[1]!.typeBreak)}회/장`,
    );
    const distinctOf = (arm: Arm) => {
      let total = 0;
      for (const [, set] of arm.distinct) total += set.size;
      return total / Math.max(1, units.length);
    };
    console.log(
      `      단원마다 실제로 쓰인 서로 다른 문항 ${distinctOf(base).toFixed(1)} → ${distinctOf(arms[1]!).toFixed(1)}개`,
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
