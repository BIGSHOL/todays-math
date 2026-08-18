/**
 * §G 제안 ⑷(고를 때 거르기) vs ⑸(자리만 바꾸기) — **어느 쪽이 얼마나 버는가** (읽기 전용).
 *
 * 둘 다 인쇄물이 달라지므로 원장님 확정 대상이다(D-07). 확정하려면 «얼마나 좋아지는가»와
 * **«무엇을 잃는가»**를 같이 봐야 한다. 이 스크립트는 실제 출제 엔진(`selectProblems`)에
 * 실제 풀을 넣고 시험지를 만들어, 실측 높이(`.measure/cont.json`)로 채점한다.
 *
 *   npx tsx scripts/qa/simulate-overflow-policies.ts
 *   npx tsx scripts/qa/simulate-overflow-policies.ts --trials 40 --counts 8,25
 *
 * ## 자리마다 칸이 다르다 (적대적 리뷰 ④ B)
 *
 * `.problemItem` 은 `flex: 1 1 0%` 라 칸이 «그 장의 문항 수»로 갈린다.
 *   1·2번 405px · 그 뒤 484px · 문항 수가 홀수면 **마지막 하나는 997px**
 * 그래서 «자리만 바꾸는 것»(⑸)만으로도 버는 게 있다 — 큰 문항을 큰 칸에 놓으면 된다.
 *
 * ## 무엇을 견주나
 *
 *   현행   지금 그대로 (`selectProblems` 출력 순서)
 *   ⑸-a   **완전 재배열** — 높이 내림차순 ↔ 칸 내림차순. 재배열의 이론적 상한.
 *   ⑸-b   **제약 유지 재배열** — `arrangeByType` 의 «같은 유형 3연속 금지»를 지키면서
 *          자리만 바꾼다. 실제로 넣을 수 있는 쪽이다.
 *   ⑷     **고를 때 거르기** — 칸에 들어가는 문항으로만 풀을 좁혀 출제하고,
 *          모자라면 나머지에서 채운다(제외가 아니라 후순위).
 *
 * ⚠️ **일일테스트는 단원 «하나»에서만 뽑는다**(`resolveRange`). ⑷ 의 위험은 거기 있다 —
 *    풀이 얇은 단원에서 «들어가는 문항»만 고르면 출제가 막히거나 같은 문항이 돈다.
 *    그래서 「⑷ 를 온전히 적용할 수 있었는가」를 같이 센다.
 */
import { readFileSync } from "node:fs";

import { PrismaClient } from "@prisma/client";

import type { DifficultyRatio } from "@/contracts/common.contract";
import { selectProblems } from "../../src/lib/generator/selectProblems";
import { JASEUP_MEASURED_PX } from "../../src/lib/printGeometry";

const prisma = new PrismaClient();

interface Height {
  pid: string;
  neededPx: number;
}
interface Row {
  id: string;
  unitId: string;
  difficulty: "easy" | "mid" | "hard";
  problemType: string;
  directUseAllowed: boolean;
  neededPx: number;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/**
 * 문항 수 N 짜리 시험지의 **자리별 칸 높이**. 장당 두 문항이고, 문항 수가 홀수면
 * 마지막 장에 하나가 남아 칸을 통째로 쓴다.
 */
function seatCapacities(count: number): number[] {
  const {
    firstPageSlot,
    continuationSlot,
    soloFirstPageSlot,
    soloContinuationSlot,
  } = JASEUP_MEASURED_PX;
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const page = Math.floor(i / 2) + 1;
    const lastOnOddPage = i === count - 1 && count % 2 === 1;
    if (lastOnOddPage)
      out.push(page === 1 ? soloFirstPageSlot : soloContinuationSlot);
    else out.push(page === 1 ? firstPageSlot : continuationSlot);
  }
  return out;
}

/** 그 배치에서 **실제로 넘치는** 문항 수. */
function overflowCount(order: Row[], seats: number[]): number {
  let n = 0;
  for (let i = 0; i < order.length; i += 1)
    if (order[i]!.neededPx > seats[i]!) n += 1;
  return n;
}

/** ⑸-a — 높이 내림차순을 칸 내림차순에 붙인다. 재배열로 얻을 수 있는 최선. */
function reorderGreedy(items: Row[], seats: number[]): Row[] {
  const seatOrder = seats
    .map((px, index) => ({ px, index }))
    .sort((a, b) => b.px - a.px || a.index - b.index);
  const byHeight = [...items].sort((a, b) => b.neededPx - a.neededPx);
  const out: Row[] = new Array(items.length);
  seatOrder.forEach((seat, k) => {
    out[seat.index] = byHeight[k]!;
  });
  return out;
}

/**
 * ⑸-b — 같은 결과를 **`arrangeByType` 의 제약을 지키면서** 노린다.
 * 큰 칸부터 돌면서 «그 자리에 놓아도 같은 유형이 3연속이 되지 않는» 가장 큰 문항을 놓는다.
 */
function reorderTypeSafe(items: Row[], seats: number[]): Row[] {
  const seatOrder = seats
    .map((px, index) => ({ px, index }))
    .sort((a, b) => b.px - a.px || a.index - b.index);
  const remaining = [...items].sort((a, b) => b.neededPx - a.neededPx);
  const out: (Row | undefined)[] = new Array(items.length);

  const breaksRule = (index: number, type: string) => {
    // 자리 index 에 type 을 놓으면 3연속이 생기는가 (아직 안 채운 자리는 제약 없음).
    const at = (i: number) =>
      i >= 0 && i < out.length ? out[i]?.problemType : undefined;
    return (
      (at(index - 1) === type && at(index - 2) === type) ||
      (at(index - 1) === type && at(index + 1) === type) ||
      (at(index + 1) === type && at(index + 2) === type)
    );
  };

  for (const seat of seatOrder) {
    let pick = remaining.findIndex(
      (r) => !breaksRule(seat.index, r.problemType),
    );
    if (pick < 0) pick = 0; // 어쩔 수 없으면 제약을 포기한다(현행도 그렇게 한다).
    out[seat.index] = remaining.splice(pick, 1)[0]!;
  }
  return out as Row[];
}

/**
 * ⑸-c — **최소 개입.** 좁은 첫 장 자리(1·2번)에 그 칸을 넘는 문항이 오면, 뒤쪽에서
 * «서로 바꿔도 둘 다 들어가는» 짝을 찾아 한 번만 맞바꾼다. 최대 두 번 바뀐다.
 * 순서를 거의 안 흔들므로 `arrangeByType` 의 유형 배치가 살아남는다.
 */
function reorderMinimalSwap(items: Row[], seats: number[]): Row[] {
  const out = [...items];
  for (const i of [0, 1]) {
    if (i >= out.length || out[i]!.neededPx <= seats[i]!) continue;
    for (let j = out.length - 1; j >= 2; j -= 1) {
      if (out[j]!.neededPx <= seats[i]! && out[i]!.neededPx <= seats[j]!) {
        const tmp = out[i]!;
        out[i] = out[j]!;
        out[j] = tmp;
        break;
      }
    }
  }
  return out;
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

async function main() {
  const trials = Number(arg("--trials") ?? 30);
  const counts = (arg("--counts") ?? "8,25")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);

  const heights = JSON.parse(
    readFileSync(".measure/cont.json", "utf8"),
  ) as Height[];
  const neededById = new Map(heights.map((h) => [h.pid, h.neededPx]));

  /** 출제 자격 — `findEligibleProblems` 의 where 절 그대로 (D-22·D-26·D-31). */
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT id, unit_id AS "unitId", difficulty, problem_type AS "problemType"
       FROM problem
      WHERE pool = 'shared' AND review_status = 'approved'
        AND direct_use_allowed = TRUE AND answer <> '(정답 없음)'`,
  )) as Array<Omit<Row, "neededPx" | "directUseAllowed">>;

  const pool: Row[] = [];
  for (const r of rows) {
    const neededPx = neededById.get(r.id);
    if (neededPx !== undefined)
      pool.push({ ...r, neededPx, directUseAllowed: true });
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

  /* ── 단원별 풀 깊이 — ⑷ 의 위험은 여기 있다 ───────────────────────────── */
  const byUnit = new Map<string, Row[]>();
  for (const p of pool) {
    const list = byUnit.get(p.unitId) ?? [];
    list.push(p);
    byUnit.set(p.unitId, list);
  }
  console.log(`\n단원 ${byUnit.size.toLocaleString()}개`);

  for (const count of counts) {
    const seats = seatCapacities(count);
    const ratio = ratioFor(count);
    const seatDesc = `${seats.filter((s) => s === firstPageSlot).length}×${firstPageSlot} · ${seats.filter((s) => s === continuationSlot).length}×${continuationSlot}${
      count % 2 === 1 ? ` · 1×${seats[seats.length - 1]}` : ""
    }`;
    console.log(
      `\n${"═".repeat(72)}\n일일테스트(단원 하나) ${count}문항 · 자리 ${seatDesc}\n${"═".repeat(72)}`,
    );

    // 그 문항 수를 뽑을 수 있는 단원만 대상으로 한다.
    const units = [...byUnit.entries()].filter(
      ([, list]) => list.length >= count,
    );
    console.log(
      `  ${count}문항을 뽑을 수 있는 단원 ${units.length.toLocaleString()} / ${byUnit.size.toLocaleString()}`,
    );

    const stat = {
      now: 0,
      reorderA: 0,
      reorderB: 0,
      reorderC: 0,
      filter: 0,
      both: 0,
      bothMin: 0,
      typeBreakC: 0,
      typeBreakBoth: 0,
      sheets: 0,
      cleanFilter: 0,
      typeBreakNow: 0,
      typeBreakB: 0,
      subNow: 0,
      subFilter: 0,
      distinctNow: 0,
      distinctFilter: 0,
    };
    // 단원마다 «몇 개의 서로 다른 문항이 실제로 쓰이는가» — 풀을 좁히면 반복이 는다.
    const usedNow = new Map<string, Set<string>>();
    const usedFilter = new Map<string, Set<string>>();
    // 「들어가는 문항만으로는 정원을 못 채우는」 단원 수
    let thinUnits = 0;
    for (const [unitId, list] of units) {
      const fitting = list.filter((p) => p.neededPx <= continuationSlot);
      if (fitting.length < count) thinUnits += 1;
      for (let t = 0; t < trials; t += 1) {
        const seed = `${unitId}:${t}`;
        const nowRun = selectProblems<Row>({
          pool: list,
          difficultyRatio: ratio,
          count,
          recentProblemIds: [],
          seed,
        });
        const now = nowRun.problems;
        if (now.length < count) continue;
        stat.subNow += nowRun.substitutions.length;
        const seenNow = usedNow.get(unitId) ?? new Set<string>();
        for (const p of now) seenNow.add(p.id);
        usedNow.set(unitId, seenNow);
        stat.sheets += 1;
        stat.now += overflowCount(now, seats);
        stat.reorderA += overflowCount(reorderGreedy(now, seats), seats);
        const safe = reorderTypeSafe(now, seats);
        stat.reorderB += overflowCount(safe, seats);
        const minimal = reorderMinimalSwap(now, seats);
        stat.reorderC += overflowCount(minimal, seats);
        stat.typeBreakC += consecutiveViolations(minimal);
        stat.typeBreakNow += consecutiveViolations(now);
        stat.typeBreakB += consecutiveViolations(safe);

        // ⑷ — 들어가는 문항으로만 뽑고, 모자라면 나머지로 채운다.
        const pickedRun = selectProblems<Row>({
          pool: fitting,
          difficultyRatio: ratio,
          count,
          recentProblemIds: [],
          seed,
        });
        const picked = pickedRun.problems;
        stat.subFilter += pickedRun.substitutions.length;
        if (picked.length === count) stat.cleanFilter += 1;
        const topped =
          picked.length === count
            ? picked
            : [
                ...picked,
                ...selectProblems<Row>({
                  pool: list.filter((p) => !picked.includes(p)),
                  difficultyRatio: ratio,
                  count: count - picked.length,
                  recentProblemIds: [],
                  seed: `${seed}:top`,
                }).problems,
              ];
        stat.filter += overflowCount(topped, seats);
        // ⑷ 로 고르고 ⑸ 로 자리까지 바꾸면 — 둘을 같이 쓰는 경우.
        stat.both += overflowCount(reorderTypeSafe(topped, seats), seats);
        const bothMinimal = reorderMinimalSwap(topped, seats);
        stat.bothMin += overflowCount(bothMinimal, seats);
        stat.typeBreakBoth += consecutiveViolations(bothMinimal);
        const seenFilter = usedFilter.get(unitId) ?? new Set<string>();
        for (const p of topped) seenFilter.add(p.id);
        usedFilter.set(unitId, seenFilter);
      }
    }

    for (const [, set] of usedNow) stat.distinctNow += set.size;
    for (const [, set] of usedFilter) stat.distinctFilter += set.size;
    const per = (n: number) => (n / Math.max(1, stat.sheets)).toFixed(3);
    const cut = (n: number) =>
      `${(((stat.now - n) * 100) / Math.max(1, stat.now)).toFixed(1)}%`;
    console.log(
      `  시험지 ${stat.sheets.toLocaleString()}장 (단원마다 ${trials}회)\n` +
        `  ┌ 정책 ─────────────── 한 장에 실제로 넘치는 문항 ── 줄어든 몫\n` +
        `  │ 현행                 ${per(stat.now).padStart(6)}건\n` +
        `  │ ⑸-a 완전 재배열      ${per(stat.reorderA).padStart(6)}건        ${cut(stat.reorderA).padStart(6)}\n` +
        `  │ ⑸-b 제약 유지 재배열 ${per(stat.reorderB).padStart(6)}건        ${cut(stat.reorderB).padStart(6)}\n` +
        `  │ ⑸-c 최소 개입 맞바꿈 ${per(stat.reorderC).padStart(6)}건        ${cut(stat.reorderC).padStart(6)}\n` +
        `  │ ⑷  고를 때 거르기    ${per(stat.filter).padStart(6)}건        ${cut(stat.filter).padStart(6)}\n` +
        `  │ ⑷+⑸-b 둘 다         ${per(stat.both).padStart(6)}건        ${cut(stat.both).padStart(6)}\n` +
        `  │ ⑷+⑸-c 둘 다         ${per(stat.bothMin).padStart(6)}건        ${cut(stat.bothMin).padStart(6)}\n` +
        `  └ 무엇을 잃는가\n` +
        `      ⑷ 를 **온전히** 적용할 수 있었던 시험지 ${((stat.cleanFilter * 100) / Math.max(1, stat.sheets)).toFixed(1)}%` +
        ` · 「들어가는 문항」만으로 정원을 못 채우는 단원 ${thinUnits}/${units.length}\n` +
        `      난이도 대체 — 현행 ${per(stat.subNow)}건/장 · ⑷ ${per(stat.subFilter)}건/장\n` +
        `      단원마다 실제로 쓰인 서로 다른 문항 — 현행 ${(stat.distinctNow / Math.max(1, units.length)).toFixed(1)}개 · ⑷ ${(stat.distinctFilter / Math.max(1, units.length)).toFixed(1)}개\n` +
        `      같은 유형 3연속 — 현행 ${per(stat.typeBreakNow)}회/장 · ⑸-b ${per(stat.typeBreakB)}회/장` +
        ` · ⑸-c ${per(stat.typeBreakC)}회/장 · ⑷+⑸-c ${per(stat.typeBreakBoth)}회/장`,
    );
  }
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

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
