/**
 * 그림 적용 트랙 단계 0 ②③④ — **읽기만**. DB 에 한 줄도 안 쓴다.
 *
 *   npx tsx scripts/qa/measure-figure-apply-stage0.ts
 *   npx tsx scripts/qa/measure-figure-apply-stage0.ts --skip-select
 *
 * ④ 는 제품 `assessSeat` · `estimateProblemPx` · `selectProblems` 를 **그대로** 부른다.
 * 높이 규칙을 여기 다시 적지 않는다.
 */
import { readFileSync, writeFileSync } from "node:fs";

import { PrismaClient } from "@prisma/client";

import { parseFigureRectLedger } from "../../src/app/dev/figure-print-size/ledger";
import type { DifficultyRatio } from "../../src/contracts/common.contract";
import {
  checkFigureSourceMm,
  parseFigureDimensions,
} from "../../src/lib/figurePrintSize";
import {
  selectProblems,
  type SelectableProblem,
} from "../../src/lib/generator/selectProblems";
import { JASEUP_MEASURED_PX } from "../../src/lib/printGeometry";
import { assessSeat, estimateProblemPx } from "../../src/lib/printOverflow";

const LEDGER = "scripts/qa/reports/figure-rect-ledger.json";
const OUT = "scripts/qa/reports/figure-apply-stage0.json";
const SLOT = JASEUP_MEASURED_PX.continuationSlot;
const FIRST = JASEUP_MEASURED_PX.firstPageSlot;

const prisma = new PrismaClient();

interface DbRow {
  id: string;
  unitId: string;
  grade: string;
  section: string;
  orderIndex: number;
  difficulty: "easy" | "mid" | "hard";
  problemType: string;
  content: string;
  figureUrls: string[];
  figureDims: number[];
  eligible: boolean;
}

type LedgerKind = "usable" | "partial" | "none" | "url-odd";

function ratioFor(count: number): DifficultyRatio {
  const easy = Math.round((count * 3) / 8);
  const hard = Math.round((count * 1) / 8);
  return { easy, hard, mid: count - easy - hard };
}

function ledgerLookup(
  urls: string[],
  byUrl: Map<string, { sourceMm: number | null }>,
): {
  kind: LedgerKind;
  mm: number[] | null;
  known: number;
  missing: number;
  noMm: number;
  odd: number;
} {
  if (urls.length === 0)
    return {
      kind: "none",
      mm: null,
      known: 0,
      missing: 0,
      noMm: 0,
      odd: 0,
    };
  let known = 0;
  let missing = 0;
  let noMm = 0;
  let odd = 0;
  const mm: number[] = [];
  for (const url of urls) {
    if (!url.startsWith("/figures/")) {
      odd += 1;
      mm.push(Number.NaN);
      continue;
    }
    const entry = byUrl.get(url);
    if (!entry) {
      missing += 1;
      mm.push(Number.NaN);
      continue;
    }
    if (entry.sourceMm == null) {
      noMm += 1;
      mm.push(Number.NaN);
      continue;
    }
    known += 1;
    mm.push(entry.sourceMm);
  }
  if (odd > 0) return { kind: "url-odd", mm: null, known, missing, noMm, odd };
  if (known === urls.length) {
    const check = checkFigureSourceMm(urls.length, mm);
    if (!check.ok)
      return { kind: "partial", mm: null, known, missing, noMm, odd };
    return { kind: "usable", mm, known, missing, noMm, odd };
  }
  if (known === 0 && missing + noMm === urls.length)
    return { kind: "none", mm: null, known, missing, noMm, odd };
  return { kind: "partial", mm: null, known, missing, noMm, odd };
}

function dimsOk(urls: string[], dims: number[]): boolean {
  return dims.length === urls.length * 2 && urls.length > 0;
}

async function main() {
  const skipSelect = process.argv.includes("--skip-select");
  const raw = readFileSync(LEDGER, "utf8");
  const parsed = parseFigureRectLedger(raw);
  if (!parsed.ok) {
    console.error(`원장을 못 읽는다: ${parsed.reason}`);
    process.exit(1);
  }
  const byUrl = parsed.entries;
  console.log(
    `원장 행 ${parsed.total.toLocaleString()} · mm 통과 ${parsed.withMm.toLocaleString()} · 버린 행 ${parsed.dropped}`,
  );

  const rows = (await prisma.$queryRawUnsafe(
    `SELECT p.id::text AS id,
            p.unit_id::text AS "unitId",
            u.grade, u.section, u.order_index AS "orderIndex",
            p.difficulty, p.problem_type AS "problemType",
            p.content,
            p.figure_urls AS "figureUrls",
            p.figure_dims AS "figureDims",
            (p.pool = 'shared' AND p.review_status = 'approved'
             AND p.direct_use_allowed = TRUE
             AND p.answer <> '(정답 없음)') AS eligible
       FROM problem p
       JOIN unit u ON u.id = p.unit_id
      ORDER BY u.order_index, p.id`,
  )) as DbRow[];

  const all = rows.length;
  const eligible = rows.filter((r) => r.eligible);
  const eligibleFig = eligible.filter((r) => r.figureUrls.length > 0);
  const allFig = rows.filter((r) => r.figureUrls.length > 0);
  console.log(
    `DB 문항 ${all.toLocaleString()} · 출제가능 ${eligible.length.toLocaleString()} · 그중 그림 ${eligibleFig.length.toLocaleString()} · 그림있는 전체(자격무관) ${allFig.length.toLocaleString()}`,
  );

  const bucket = {
    usable: { problems: 0, figures: 0 },
    partial: { problems: 0, figures: 0 },
    none: { problems: 0, figures: 0 },
    "url-odd": { problems: 0, figures: 0 },
  };
  const dims = {
    empty: 0,
    mismatch: 0,
    ok: 0,
    emptyButMmUsable: 0,
    mismatchButMmUsable: 0,
  };
  const partialDetail = { someMissing: 0, someNoMm: 0, both: 0 };
  let figuresEligible = 0;
  let figuresUsable = 0;
  let figuresPartialKnown = 0;

  const withMmForSeat: Array<{
    row: DbRow;
    mm: number[];
  }> = [];
  const partialRows: Array<{
    id: string;
    urls: string[];
    known: number;
    missing: number;
    noMm: number;
  }> = [];
  const nonePrefix = new Map<string, number>();

  for (const row of eligibleFig) {
    const look = ledgerLookup(row.figureUrls, byUrl);
    bucket[look.kind].problems += 1;
    bucket[look.kind].figures += row.figureUrls.length;
    figuresEligible += row.figureUrls.length;
    if (look.kind === "usable") {
      figuresUsable += row.figureUrls.length;
      withMmForSeat.push({ row, mm: look.mm! });
    } else if (look.kind === "partial") {
      figuresPartialKnown += look.known;
      if (look.missing > 0 && look.noMm > 0) partialDetail.both += 1;
      else if (look.missing > 0) partialDetail.someMissing += 1;
      else partialDetail.someNoMm += 1;
      partialRows.push({
        id: row.id,
        urls: row.figureUrls,
        known: look.known,
        missing: look.missing,
        noMm: look.noMm,
      });
    } else if (look.kind === "none") {
      for (const url of row.figureUrls) {
        const name = url.split("/").pop() ?? url;
        const pref = name.startsWith("hwp-")
          ? "hwp-"
          : name.startsWith("hwppdf-")
            ? "hwppdf-"
            : name.startsWith("pdf-")
              ? "pdf-"
              : name.startsWith("tbl-")
                ? "tbl-"
                : url.includes("/rpm/")
                  ? "rpm"
                  : "qNN";
        nonePrefix.set(pref, (nonePrefix.get(pref) ?? 0) + 1);
      }
    }

    const n = row.figureUrls.length;
    if (row.figureDims.length === 0) {
      dims.empty += 1;
      if (look.kind === "usable") dims.emptyButMmUsable += 1;
    } else if (row.figureDims.length !== n * 2) {
      dims.mismatch += 1;
      if (look.kind === "usable") dims.mismatchButMmUsable += 1;
    } else {
      dims.ok += 1;
    }
  }

  console.log("\n── ② 출제가능 · 그림 있는 문항 vs 원장 ──");
  console.log(
    `  분모 문항 ${eligibleFig.length.toLocaleString()} · 그림 ${figuresEligible.toLocaleString()}장`,
  );
  console.log(
    `  전부 mm 쓸 수 있음   문항 ${bucket.usable.problems.toLocaleString()} · 그림 ${bucket.usable.figures.toLocaleString()}`,
  );
  console.log(
    `  일부만 원장에        문항 ${bucket.partial.problems.toLocaleString()} · 그림 ${bucket.partial.figures.toLocaleString()} (아는 장 ${figuresPartialKnown.toLocaleString()} — §1 ⑶ 통째로 못 씀)`,
  );
  console.log(
    `     일부 파일 원장 없음 ${partialDetail.someMissing} · 원장은 있는데 mm 없음 ${partialDetail.someNoMm} · 둘 다 ${partialDetail.both}`,
  );
  console.log(
    `  하나도 없음          문항 ${bucket.none.problems.toLocaleString()} · 그림 ${bucket.none.figures.toLocaleString()}`,
  );
  console.log(
    `  URL 규약 밖          문항 ${bucket["url-odd"].problems.toLocaleString()} · 그림 ${bucket["url-odd"].figures.toLocaleString()}`,
  );
  if (partialRows.length > 0) {
    console.log("  🔴 일부만 원장에 있는 문항 (숨기지 않는다)");
    for (const p of partialRows)
      console.log(
        `    ${p.id}  그림 ${p.urls.length} · 아는 장 ${p.known} · 원장없음 ${p.missing} · mm없음 ${p.noMm}\n      ${p.urls.join(" · ")}`,
      );
  }
  if (nonePrefix.size > 0) {
    console.log("  「하나도 없음」 그림 파일 접두");
    for (const [k, n] of [...nonePrefix.entries()].sort((a, b) => b[1] - a[1]))
      console.log(`    ${k}  ${n.toLocaleString()}장`);
  }

  console.log("\n── ③ figure_dims 교집합 (출제가능 · 그림 있는 문항) ──");
  console.log(`  dims 짝 맞음     ${dims.ok.toLocaleString()}`);
  console.log(`  dims 비어 있음   ${dims.empty.toLocaleString()}`);
  console.log(`  dims 짝 어긋남   ${dims.mismatch.toLocaleString()}`);
  console.log(
    `  mm 를 알아도 dims 가 비어 버려지는 문항 ${dims.emptyButMmUsable.toLocaleString()}`,
  );
  console.log(
    `  mm 를 알아도 dims 짝이 어긋나 버려지는 문항 ${dims.mismatchButMmUsable.toLocaleString()}`,
  );

  // ④ 제품 함수. mm 를 실제로 실을 수 있는 문항만 after 가 갈린다.
  //    dims 가 없으면 parseFigureDimensions 가 mm 도 버린다 — 그것도 제품 동작.
  type Flip = {
    id: string;
    unitId: string;
    grade: string;
    section: string;
    dir: "overflow-to-fit" | "fit-to-overflow";
    slot: "continuation" | "first";
    pxBefore: number;
    pxAfter: number;
  };
  const flipsCont: Flip[] = [];
  const flipsFirst: Flip[] = [];
  let pxDiffAbs = 0;
  let pxChanged = 0;
  let pxSame = 0;
  let afterFitsCont = 0;
  let beforeFitsCont = 0;
  let afterRiskCont = 0;
  let beforeRiskCont = 0;
  const pxDeltas: number[] = [];

  const loadable = withMmForSeat.filter((x) =>
    dimsOk(x.row.figureUrls, x.row.figureDims),
  );
  console.log(`\n── ④ 출제 판정 (제품 assessSeat · 이어지는 장 ${SLOT}px) ──`);
  console.log(
    `  mm 를 실을 수 있는 문항(원장 전부 + dims 짝) ${loadable.length.toLocaleString()}  ← 이 집합만 after 가 갈릴 수 있다`,
  );

  for (const { row, mm } of loadable) {
    const beforeSeat = assessSeat(
      {
        content: row.content,
        figureUrls: row.figureUrls,
        figureDims: row.figureDims,
      },
      SLOT,
    );
    const afterSeat = assessSeat(
      {
        content: row.content,
        figureUrls: row.figureUrls,
        figureDims: row.figureDims,
        figureSourceMm: mm,
      },
      SLOT,
    );
    const beforeFirst = assessSeat(
      {
        content: row.content,
        figureUrls: row.figureUrls,
        figureDims: row.figureDims,
      },
      FIRST,
    );
    const afterFirst = assessSeat(
      {
        content: row.content,
        figureUrls: row.figureUrls,
        figureDims: row.figureDims,
        figureSourceMm: mm,
      },
      FIRST,
    );

    const figsBefore = parseFigureDimensions(
      row.figureUrls.length,
      row.figureDims,
    );
    const figsAfter = parseFigureDimensions(
      row.figureUrls.length,
      row.figureDims,
      mm,
    );
    const pxB = estimateProblemPx(row.content, figsBefore);
    const pxA = estimateProblemPx(row.content, figsAfter);
    const d = pxA - pxB;
    if (Math.abs(d) >= 0.5) {
      pxChanged += 1;
      pxDiffAbs += Math.abs(d);
      pxDeltas.push(d);
    } else {
      pxSame += 1;
    }

    if (beforeSeat.risky) beforeRiskCont += 1;
    else beforeFitsCont += 1;
    if (afterSeat.risky) afterRiskCont += 1;
    else afterFitsCont += 1;

    if (beforeSeat.risky && !afterSeat.risky) {
      flipsCont.push({
        id: row.id,
        unitId: row.unitId,
        grade: row.grade,
        section: row.section,
        dir: "overflow-to-fit",
        slot: "continuation",
        pxBefore: pxB,
        pxAfter: pxA,
      });
    } else if (!beforeSeat.risky && afterSeat.risky) {
      flipsCont.push({
        id: row.id,
        unitId: row.unitId,
        grade: row.grade,
        section: row.section,
        dir: "fit-to-overflow",
        slot: "continuation",
        pxBefore: pxB,
        pxAfter: pxA,
      });
    }
    if (beforeFirst.risky && !afterFirst.risky) {
      flipsFirst.push({
        id: row.id,
        unitId: row.unitId,
        grade: row.grade,
        section: row.section,
        dir: "overflow-to-fit",
        slot: "first",
        pxBefore: pxB,
        pxAfter: pxA,
      });
    } else if (!beforeFirst.risky && afterFirst.risky) {
      flipsFirst.push({
        id: row.id,
        unitId: row.unitId,
        grade: row.grade,
        section: row.section,
        dir: "fit-to-overflow",
        slot: "first",
        pxBefore: pxB,
        pxAfter: pxA,
      });
    }
  }

  const o2f = flipsCont.filter((f) => f.dir === "overflow-to-fit").length;
  const f2o = flipsCont.filter((f) => f.dir === "fit-to-overflow").length;
  const o2f1 = flipsFirst.filter((f) => f.dir === "overflow-to-fit").length;
  const f2o1 = flipsFirst.filter((f) => f.dir === "fit-to-overflow").length;
  pxDeltas.sort((a, b) => a - b);
  const q = (p: number) =>
    pxDeltas.length === 0
      ? 0
      : pxDeltas[
          Math.min(pxDeltas.length - 1, Math.floor(p * pxDeltas.length))
        ]!;

  console.log(
    `  이어지는 장  넘침→안넘침 ${o2f.toLocaleString()} · 안넘침→넘침 ${f2o.toLocaleString()} · 안 바뀜 ${(loadable.length - o2f - f2o).toLocaleString()}`,
  );
  console.log(
    `    전  risky ${beforeRiskCont.toLocaleString()} / fit ${beforeFitsCont.toLocaleString()}`,
  );
  console.log(
    `    후  risky ${afterRiskCont.toLocaleString()} / fit ${afterFitsCont.toLocaleString()}`,
  );
  console.log(
    `  첫 장        넘침→안넘침 ${o2f1.toLocaleString()} · 안넘침→넘침 ${f2o1.toLocaleString()}`,
  );
  const reverseCont = flipsCont.filter((f) => f.dir === "fit-to-overflow");
  if (reverseCont.length > 0) {
    console.log("  🔴 이어지는 장 안넘침→넘침 (숨기지 않는다)");
    for (const f of reverseCont)
      console.log(
        `    ${f.grade} ${f.section}  ${f.id}  ${f.pxBefore.toFixed(1)}→${f.pxAfter.toFixed(1)}px`,
      );
  }
  const reverseFirst = flipsFirst.filter((f) => f.dir === "fit-to-overflow");
  if (reverseFirst.length > 0) {
    console.log("  🔴 첫 장 안넘침→넘침");
    for (const f of reverseFirst)
      console.log(
        `    ${f.grade} ${f.section}  ${f.id}  ${f.pxBefore.toFixed(1)}→${f.pxAfter.toFixed(1)}px`,
      );
  }
  console.log(
    `  추정 px 가 0.5 이상 변한 문항 ${pxChanged.toLocaleString()} · 그대로 ${pxSame.toLocaleString()}`,
  );
  if (pxDeltas.length > 0) {
    console.log(
      `    Δpx 하위5% ${q(0.05).toFixed(1)} · 중앙 ${q(0.5).toFixed(1)} · 상위5% ${q(0.95).toFixed(1)} · 평균절대 ${(pxDiffAbs / pxDeltas.length).toFixed(1)}`,
    );
  }

  // 단원별 정원. 출제가능 전량(그림 없는 문항 포함)이 분모.
  // after 는 loadable 인 것만 판정이 바뀌고, 나머지는 before 와 같다.
  type UnitAgg = {
    unitId: string;
    grade: string;
    section: string;
    orderIndex: number;
    eligible: number;
    fig: number;
    fitBefore: number;
    fitAfter: number;
    riskBefore: number;
    riskAfter: number;
    o2f: number;
    f2o: number;
  };
  const units = new Map<string, UnitAgg>();
  const afterFit = new Set(
    flipsCont.filter((f) => f.dir === "overflow-to-fit").map((f) => f.id),
  );
  const afterRisk = new Set(
    flipsCont.filter((f) => f.dir === "fit-to-overflow").map((f) => f.id),
  );

  for (const row of eligible) {
    let u = units.get(row.unitId);
    if (!u) {
      u = {
        unitId: row.unitId,
        grade: row.grade,
        section: row.section,
        orderIndex: row.orderIndex,
        eligible: 0,
        fig: 0,
        fitBefore: 0,
        fitAfter: 0,
        riskBefore: 0,
        riskAfter: 0,
        o2f: 0,
        f2o: 0,
      };
      units.set(row.unitId, u);
    }
    u.eligible += 1;
    if (row.figureUrls.length > 0) u.fig += 1;
    const seat = assessSeat(
      {
        content: row.content,
        figureUrls: row.figureUrls,
        figureDims: row.figureDims,
      },
      SLOT,
    );
    const riskyBefore = seat.risky;
    let riskyAfter = riskyBefore;
    if (afterFit.has(row.id)) riskyAfter = false;
    if (afterRisk.has(row.id)) riskyAfter = true;
    if (riskyBefore) u.riskBefore += 1;
    else u.fitBefore += 1;
    if (riskyAfter) u.riskAfter += 1;
    else u.fitAfter += 1;
    if (riskyBefore && !riskyAfter) u.o2f += 1;
    if (!riskyBefore && riskyAfter) u.f2o += 1;
  }

  const unitList = [...units.values()].sort(
    (a, b) => a.orderIndex - b.orderIndex,
  );
  const below = (key: "fitBefore" | "fitAfter", n: number) =>
    unitList.filter((u) => u[key] < n && u.eligible >= n);
  const newlyBelow8 = unitList.filter(
    (u) => u.fitBefore >= 8 && u.fitAfter < 8,
  );
  const newlyBelow25 = unitList.filter(
    (u) => u.fitBefore >= 25 && u.fitAfter < 25,
  );
  const rescued8 = unitList.filter((u) => u.fitBefore < 8 && u.fitAfter >= 8);
  const rescued25 = unitList.filter(
    (u) => u.fitBefore < 25 && u.fitAfter >= 25,
  );

  console.log("\n── ④ 단원 정원 (출제가능 전량 · 이어지는 장 fit) ──");
  console.log(`  단원 수 ${unitList.length}`);
  console.log(
    `  fit < 8   전 ${below("fitBefore", 8).length} → 후 ${below("fitAfter", 8).length}  (새로 내려감 ${newlyBelow8.length} · 올라옴 ${rescued8.length})`,
  );
  console.log(
    `  fit < 25  전 ${below("fitBefore", 25).length} → 후 ${below("fitAfter", 25).length}  (새로 내려감 ${newlyBelow25.length} · 올라옴 ${rescued25.length})`,
  );
  const stillBelow25 = below("fitAfter", 25);
  if (stillBelow25.length > 0) {
    console.log("  25문항 정원 아래인 단원 (전후 모두, 이 변경 탓이 아님)");
    for (const u of stillBelow25)
      console.log(
        `    ${u.grade} ${u.section}  fit ${u.fitBefore}→${u.fitAfter} / 자격 ${u.eligible}`,
      );
  }
  if (newlyBelow8.length > 0) {
    console.log("  🔴 8문항 정원 아래로 새로 내려간 단원");
    for (const u of newlyBelow8)
      console.log(
        `    ${u.grade} ${u.section}  fit ${u.fitBefore}→${u.fitAfter} / 자격 ${u.eligible}`,
      );
  }
  if (newlyBelow25.length > 0) {
    console.log("  🔴 25문항 정원 아래로 새로 내려간 단원");
    for (const u of newlyBelow25)
      console.log(
        `    ${u.grade} ${u.section}  fit ${u.fitBefore}→${u.fitAfter} / 자격 ${u.eligible}`,
      );
  }

  // selectProblems — 제품 엔진. 지금 배선은 figureSourceMm 을 안 읽는다.
  let selectNowChanged = 0;
  let selectWiredChanged = 0;
  let selectTrials = 0;
  const changedUnits: Array<{
    grade: string;
    section: string;
    count: number;
    seedsDifferNow: number;
    seedsDifferIfWired: number;
    trials: number;
  }> = [];

  if (!skipSelect) {
    console.log("\n── ④ selectProblems (제품 엔진, 시드 10 × 8·25문항) ──");
    const mmById = new Map(loadable.map((x) => [x.row.id, x.mm]));
    const byUnit = new Map<string, DbRow[]>();
    for (const row of eligible) {
      const list = byUnit.get(row.unitId) ?? [];
      list.push(row);
      byUnit.set(row.unitId, list);
    }
    const seeds = Array.from({ length: 10 }, (_, i) => `figure-apply-${i}`);
    const counts = [8, 25];

    const toSel = (
      row: DbRow,
      withMm: boolean,
    ): SelectableProblem & { figureSourceMm?: number[] } => ({
      id: row.id,
      unitId: row.unitId,
      difficulty: row.difficulty,
      problemType: row.problemType,
      directUseAllowed: true,
      content: row.content,
      figureUrls: row.figureUrls,
      figureDims: row.figureDims,
      ...(withMm && mmById.has(row.id)
        ? { figureSourceMm: mmById.get(row.id) }
        : {}),
    });

    /**
     * 「배선된 엔진」은 제품 selectProblems 를 그대로 부르되, 풀에서
     * mm 를 아는 문항의 **높이 효과가 이미 반영된 것처럼** 보이게
     * 본문을 조작하지 않는다. 제품이 figureSourceMm 을 안 읽으면
     * 두 팔이 같아진다 — 그게 지금 배선의 측정이다.
     *
     * 배선 후 효과를 재려면 assessSeat 로 후순위 집합이 바뀌는 단원에서
     * 같은 시드로 뽑힌 id 집합을 견준다. 엔진이 mm 을 안 보면 집합이
     * 같고, 보면 다를 수 있다.
     */
    for (const u of unitList) {
      if (u.o2f + u.f2o === 0) continue;
      const pool = byUnit.get(u.unitId) ?? [];
      let nowDiff = 0;
      let wiredDiff = 0;
      let trials = 0;
      for (const count of counts) {
        if (pool.length < count) continue;
        const ratio = ratioFor(count);
        for (const seed of seeds) {
          trials += 1;
          selectTrials += 1;
          const a = selectProblems({
            pool: pool.map((r) => toSel(r, false)),
            difficultyRatio: ratio,
            count,
            recentProblemIds: [],
            seed,
          });
          const b = selectProblems({
            pool: pool.map((r) => toSel(r, true)),
            difficultyRatio: ratio,
            count,
            recentProblemIds: [],
            seed,
          });
          const idsA = a.problems.map((p) => p.id).join(",");
          const idsB = b.problems.map((p) => p.id).join(",");
          if (idsA !== idsB) {
            nowDiff += 1;
            selectNowChanged += 1;
          }

          // 배선 효과: 후순위 집합이 바뀌면 같은 시드라도 고른 문항이 달라질 수
          // 있다. 제품 엔진이 mm 을 읽지 않으므로, 여기서는 「후순위 멤버십이
          // 바뀐 문항이 한 팔에만 뽑혔는가」로 센다 — 엔진을 흉내 내지 않고
          // 엔진이 고른 id 와 assessSeat 전후 집합을 맞댈 뿐이다.
          const setB = new Set(b.problems.map((p) => p.id));
          const flippedInPaper = [...afterFit, ...afterRisk].some((id) =>
            setB.has(id),
          );
          if (flippedInPaper || idsA !== idsB) {
            // idsA !== idsB 는 배선이 이미 된 경우. flippedInPaper 는
            // 「이 시험지에 판정이 바뀐 문항이 실렸다」— 배선되면 자리가 달라질
            // 후보. 둘을 갈라 찍는다.
            wiredDiff += 1;
            selectWiredChanged += 1;
          }
        }
      }
      if (trials > 0 && (nowDiff > 0 || wiredDiff > 0)) {
        changedUnits.push({
          grade: u.grade,
          section: u.section,
          count: u.o2f + u.f2o,
          seedsDifferNow: nowDiff,
          seedsDifferIfWired: wiredDiff,
          trials,
        });
      }
    }
    console.log(
      `  판정이 바뀐 단원에서 시험 ${selectTrials.toLocaleString()}장`,
    );
    console.log(
      `  지금 배선(엔진이 mm 무시) 다른 시험 ${selectNowChanged.toLocaleString()}장`,
    );
    console.log(
      `  판정이 바뀐 문항이 그 시험에 실린 장 ${selectWiredChanged.toLocaleString()}  ← 배선되면 구성이 달라질 수 있는 상한`,
    );
    console.log(
      `  (상한이다. 후순위라서 풀이 두꺼우면 엔진이 그걸 안 고를 수도 있다.)`,
    );
  }

  const report = {
    generatedAt: new Date().toISOString(),
    ledger: {
      total: parsed.total,
      withMm: parsed.withMm,
      dropped: parsed.dropped,
    },
    db: {
      all,
      eligible: eligible.length,
      eligibleWithFigures: eligibleFig.length,
      allWithFigures: allFig.length,
      figuresEligible,
    },
    match: {
      usable: bucket.usable,
      partial: bucket.partial,
      none: bucket.none,
      urlOdd: bucket["url-odd"],
      partialDetail,
      partialRows,
      nonePrefix: Object.fromEntries(nonePrefix),
      figuresUsable,
      figuresPartialKnown,
    },
    dims,
    overflow: {
      loadable: loadable.length,
      continuation: {
        overflowToFit: o2f,
        fitToOverflow: f2o,
        unchanged: loadable.length - o2f - f2o,
        riskyBefore: beforeRiskCont,
        riskyAfter: afterRiskCont,
      },
      firstPage: { overflowToFit: o2f1, fitToOverflow: f2o1 },
      reverseContinuation: reverseCont,
      reverseFirst,
      pxChanged,
      pxSame,
      pxDelta: pxDeltas.length
        ? {
            p05: q(0.05),
            p50: q(0.5),
            p95: q(0.95),
            meanAbs: pxDiffAbs / pxDeltas.length,
          }
        : null,
    },
    units: {
      n: unitList.length,
      below8: {
        before: below("fitBefore", 8).length,
        after: below("fitAfter", 8).length,
        newlyDown: newlyBelow8.map((u) => ({
          grade: u.grade,
          section: u.section,
          fitBefore: u.fitBefore,
          fitAfter: u.fitAfter,
          eligible: u.eligible,
        })),
        rescued: rescued8.length,
      },
      below25: {
        before: below("fitBefore", 25).length,
        after: below("fitAfter", 25).length,
        newlyDown: newlyBelow25.map((u) => ({
          grade: u.grade,
          section: u.section,
          fitBefore: u.fitBefore,
          fitAfter: u.fitAfter,
          eligible: u.eligible,
        })),
        rescued: rescued25.length,
      },
    },
    select: skipSelect
      ? { skipped: true }
      : {
          trials: selectTrials,
          differNow: selectNowChanged,
          papersThatContainFlipped: selectWiredChanged,
          unitsSample: changedUnits.slice(0, 30),
        },
  };

  writeFileSync(OUT, JSON.stringify(report, null, 2), "utf8");
  console.log(`\n기록 → ${OUT}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
