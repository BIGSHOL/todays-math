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
 *
 * ## 검토용 조건 — `--cap` · `--layout` (`d-affordable` 트랙)
 *
 *   npx tsx scripts/qa/simulate-overflow-policies.ts --cap cap45 --layout d \
 *     --heights .measure/cl-cap45-d.json --baseline-heights .measure/cl-cap45-base.json
 *
 * 「그림 폭 상한을 45mm 로 낮추고 문항번호를 D안으로 바꾸면 **원장님 화면의 경고가
 * 어떻게 되는가**」를 재는 자리다. 안 주면 지금 제품 그대로 돈다.
 *
 * **제품 코드는 한 줄도 안 고친다.** 두 조건이 판정에 들어가는 길은 각각 하나뿐이라
 * 그 길로만 넣는다.
 *
 *   · **그림 폭 상한** — `estimateFigureBlockPx` 는 `scale = min(1, figureMaxWidth/w)`
 *     로 줄인다. 그러니 **미리 줄인 치수**(`w·s, h·s`)를 넘기면 제품의 `min` 이
 *     1이 되어 그 값을 그대로 쓴다 — 상한을 낮춘 것과 **수학적으로 같다**.
 *     규칙을 옮겨 적지 않으므로 갈라질 자리가 없다.
 *   · **번호 서식** — 늘어난 세로는 `fixedChrome`(문항번호+정답란) 한 상수에만 들어간다.
 *     그 값을 **실측 Δ 만큼** 올린다(아래 참조). 상수 하나를 바꾸는 것이므로
 *     `selectProblems`·`assessSeat`·`assessOverflowRisk` 가 **전부 같은 값**을 본다.
 *
 * ⚠️ **Δ 를 손으로 적지 않는다.** 조건 캐시와 기준선 캐시의 차(중앙값)를 쓴다 —
 *    채점의 «참»과 판정의 «가정»이 같은 실측에서 나오게 하려는 것이다. 그 차가
 *    문항마다 제각각이면(=배치가 문항 내용을 건드린다는 뜻) **멈춘다.**
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
import {
  assessOverflowRisk,
  estimateProblemPx,
  packProblems,
  parseFigureDimensions,
} from "../../src/lib/printOverflow";
import { capByName } from "./capLayoutProbe";
import { packProblemsLegacy } from "./legacy/printPack-20260821";
import {
  assertHeightCacheFresh,
  measuredRowsHash,
} from "./heightCacheManifest";
import { layoutByName } from "./idLayouts";

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
  /**
   * 🔴 그림의 **물리 폭(mm)**. 2026-08-20 부터 인쇄 크기는 픽셀이 아니라 이 값에서
   *    온다(8,238문항). 이걸 안 넘기면 엔진이 **옛 픽셀 규칙**으로 크기를 재서,
   *    이 시뮬레이션이 «제품이 아닌 것»의 성적을 내게 된다.
   */
  figureSourceMm?: number[];
  /** 채점의 «참» — 지면을 그려 잰 값이다. 제품은 이 값을 못 본다. */
  neededPx: number;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** 엔진이 지면을 못 보던 때 — 지면 셋을 떼고 부른다. */
function blind(row: Row): Row {
  const { content, figureUrls, figureDims, figureSourceMm, ...rest } = row;
  void content;
  void figureUrls;
  void figureDims;
  void figureSourceMm;
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
    figureSourceMm: r.figureSourceMm ?? [],
  }));

/**
 * **옛 분할(장당 2문항 고정)의 자리별 칸** — git 에서 꺼낸 옛 코드로 구한다.
 *
 * 「이렇게 부르면 옛 동작과 같다」고 손으로 적으면 그건 추론이지 측정이 아니다
 * (CLAUDE.md 2026-08-18). 칸을 «혼자인가·첫 장인가»로 고르는 규칙은 안 바뀌었으므로
 * 그대로 쓰고, **바뀐 것(분할)만** 옛것으로 갈아 끼운다.
 */
function legacySeatCapacities(problems: TestPrintProblem[]): number[] {
  const out: number[] = [];
  packProblemsLegacy(problems).forEach((page, pageIndex) => {
    const alone = page.problems.length === 1;
    const first = pageIndex === 0;
    const px = alone
      ? first
        ? JASEUP_MEASURED_PX.soloFirstPageSlot
        : JASEUP_MEASURED_PX.soloContinuationSlot
      : first
        ? JASEUP_MEASURED_PX.firstPageSlot
        : JASEUP_MEASURED_PX.continuationSlot;
    for (let i = 0; i < page.problems.length; i += 1) out.push(px);
  });
  return out;
}

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
  /** 시험지 장 수 — 높이 분할의 **대가**다. 재지 않으면 이득만 적히게 된다. */
  pages: number;
  overflow: number;
  /** **같은 시험지**를 옛 분할(장당 2문항 고정)로 찍었다면. 분할만 갈아 낀 대조군이다. */
  legacyPages: number;
  legacyOverflow: number;
  warnings: number;
  warnedSheets: number;
  typeBreak: number;
  substitutions: number;
  allFitting: number;
  distinct: Map<string, Set<string>>;
}

const newArm = (label: string): Arm => ({
  label,
  pages: 0,
  overflow: 0,
  legacyPages: 0,
  legacyOverflow: 0,
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
  /**
   * 검토용 조건(`d-affordable` 트랙). 안 주면 **지금 제품 그대로** 돈다 —
   * 기존 호출은 한 글자도 안 바뀐다.
   */
  const capName = arg("--cap");
  const layoutName = arg("--layout");
  const baselineHeightsPath = arg("--baseline-heights");
  const cap = capName ? capByName(capName) : null;
  const layout = layoutName ? layoutByName(layoutName) : null;

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
            figure_source_mm AS "figureSourceMm",
            question_type AS "questionType",
            (pool = 'shared' AND review_status = 'approved'
             AND direct_use_allowed = TRUE AND answer <> '(정답 없음)') AS eligible
       FROM problem ORDER BY id`,
  )) as Array<
    Omit<Row, "neededPx" | "directUseAllowed"> & {
      content: string;
      figureUrls: string[];
      figureDims: number[];
      figureSourceMm: number[] | null;
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
  /**
   * 🔴 **크기 기준 두 컬럼을 반드시 같이 넘긴다.**
   *
   * `measuredRowsHash` 는 `figureDims`·`figureSourceMm` 도 지문에 넣는다. 여기서
   * 빠뜨리면 측정기가 낸 지문과 **영영 어긋나** 「캐시가 낡았다」는 거짓 경보가
   * 난다 — 실제로 mm 적재(8,238문항, 2026-08-20) 뒤로 이 도구는 계속 빨간색이었고,
   * 그래서 아무도 못 돌렸다. **거짓 경보는 침묵하는 가드보다 나쁘다.**
   */
  const rowsHash = measuredRowsHash(
    rows.map((r) => ({
      id: r.id,
      content: r.content,
      figureUrls: r.figureUrls,
      figureDims: r.figureDims,
      figureSourceMm: r.figureSourceMm,
      questionType: r.questionType,
    })),
  );
  /**
   * ⚠️ `overlay` 를 같이 본다. 안 보면 「45mm 로 잰 캐시」와 「70mm 로 잰 캐시」가
   * 지문이 **똑같아서**, 조건을 바꿔 놓고 옛 캐시로 채점해도 아무 말이 없다.
   */
  const overlay =
    cap || layout
      ? `cap=${cap?.name ?? "cap70"};layout=${layout?.name ?? "base"}`
      : undefined;
  assertHeightCacheFresh(heightsPath, {
    kind: "continuation",
    rows: heights.length,
    rowsHash,
    slotPx: slot,
    overlay,
  });

  /* ── 번호 서식의 세로 Δ — **실측에서 가져온다** ───────────────────────────
     조건 캐시와 기준선 캐시의 차다. 손으로 적으면 채점의 «참»과 판정의 «가정»이
     따로 놀고, 그러면 이 표는 제품이 틀릴수록 좋은 점수를 낼 수 있다(리뷰 §E). */
  let chromeDelta = 0;
  if (layout && layout.name !== "base") {
    if (!baselineHeightsPath)
      throw new Error(
        `--layout ${layout.name} 을 쓰려면 --baseline-heights <같은 상한의 base 캐시> 가 필요하다 — Δ 를 실측에서 가져와야 한다.`,
      );
    const baseHeights = JSON.parse(
      readFileSync(baselineHeightsPath, "utf8"),
    ) as Height[];
    assertHeightCacheFresh(baselineHeightsPath, {
      kind: "continuation",
      rows: baseHeights.length,
      rowsHash,
      slotPx: slot,
      overlay: `cap=${cap?.name ?? "cap70"};layout=base`,
    });
    const baseById = new Map(baseHeights.map((h) => [h.pid, h.neededPx]));
    const deltas: number[] = [];
    for (const h of heights) {
      const b = baseById.get(h.pid);
      if (b !== undefined)
        deltas.push(Math.round((h.neededPx - b) * 100) / 100);
    }
    const tally = new Map<number, number>();
    for (const d of deltas) tally.set(d, (tally.get(d) ?? 0) + 1);
    const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1]);
    chromeDelta = ranked[0]![0];
    const share = ranked[0]![1] / deltas.length;
    console.log(
      `번호 서식 Δ (실측 ${deltas.length.toLocaleString()}건) — ` +
        ranked
          .slice(0, 4)
          .map(
            ([d, n]) =>
              `${d >= 0 ? "+" : ""}${d}px ${((100 * n) / deltas.length).toFixed(1)}%`,
          )
          .join(" · "),
    );
    /**
     * 배치는 문항 **위쪽 살**만 바꾼다. 그러니 Δ 는 문항마다 거의 같아야 한다.
     * 판정은 상수 **하나**만 쓸 수 있으므로(=`fixedChrome`), 그 하나로 흉내 낼 수
     * 있는지를 여기서 본다 — **최빈값의 몫이 아니라 «흩어진 정도»로** 본다.
     * (몫으로 보면 서술형 비율 16.5% 같은 정상적인 쏠림에 문턱이 걸린다.
     *  묻고 싶은 것은 「몇 %가 최빈값인가」가 아니라 「최빈값에서 얼마나 벗어나나」다.)
     *
     * 벗어나는 부류는 **서술형**이다 — 「서술형 n」 배지가 번호 줄에 참여해 2px 를 더
     * 먹는다. 판정은 그 배지를 원래 모르므로(지금도 모른다) 그 2px 는 **덜 세는 쪽**
     * 으로 남는다. 그 사실을 아래에 찍어 둔다 — 조용히 넘기면 「경고가 안 뜬다」의
     * 일부가 이 2px 이 된다.
     */
    const off = deltas.filter((d) => Math.abs(d - chromeDelta) > 0.01);
    const worst = off.length
      ? Math.max(...off.map((d) => Math.abs(d - chromeDelta)))
      : 0;
    if (worst > 6)
      throw new Error(
        `번호 서식 Δ 가 최빈값에서 최대 ${worst.toFixed(1)}px 벗어난다 — 상수 하나로 판정에 넣을 수 없다.`,
      );
    if (off.length > 0)
      console.log(
        `  └ 최빈값에서 벗어나는 문항 ${off.length.toLocaleString()}건 (${((100 * off.length) / deltas.length).toFixed(1)}%) · 최대 ${worst.toFixed(1)}px — ` +
          `판정은 이만큼 **덜 센다**(서술형 배지를 원래 안 본다).`,
      );
    void share;
  }

  /* ── 조건을 판정에 넣는다 ───────────────────────────────────────────────
     `JASEUP_MEASURED_PX` 는 런타임에는 보통 객체다. 지면이 바뀌면 이 상수를 다시
     재는 것이 제품의 정상 절차이므로(`measure-paper-units.tsx`), 「그 조건이 채택된
     세상」을 흉내 내려면 상수를 그 값으로 두고 **제품 함수를 그대로** 부르면 된다.
     규칙을 옮겨 적지 않는 것이 핵심이다. */
  if (chromeDelta !== 0) {
    const before = estimateProblemPx("", []);
    if (Math.abs(before - JASEUP_MEASURED_PX.fixedChrome) > 0.01)
      throw new Error(
        `빈 문항의 추정이 ${before}px 인데 fixedChrome 은 ${JASEUP_MEASURED_PX.fixedChrome}px 이다 — 이 자리로 Δ 를 못 넣는다.`,
      );
    (JASEUP_MEASURED_PX as { fixedChrome: number }).fixedChrome =
      before + chromeDelta;
    const after = estimateProblemPx("", []);
    if (Math.abs(after - (before + chromeDelta)) > 0.01)
      throw new Error(
        `Δ 를 넣었는데 추정이 ${after}px 다 — 판정이 이 상수를 안 본다. 이 표는 거짓이 된다.`,
      );
    console.log(
      `판정에 넣은 값 · 문항번호+정답란 ${before}px → ${after}px (Δ ${chromeDelta >= 0 ? "+" : ""}${chromeDelta}px)`,
    );
  }
  if (cap) console.log(`판정에 넣은 값 · 그림 폭 상한 — ${cap.label}`);

  /**
   * 그림 폭 상한을 **미리 줄인 치수**로 넘긴다(위 머리말 참조 — 제품의 `min` 이 1이
   * 되어 이 값을 그대로 쓴다). 상한을 안 주면 원본 치수 그대로다.
   */
  let unknownDims = 0;
  const capDims = (figureUrls: string[], flat: number[]): number[] => {
    const parsed = parseFigureDimensions(figureUrls.length, flat);
    if (parsed.some((f) => f === null)) unknownDims += 1;
    if (!cap) return flat;
    const capPx = cap.expectedMaxWidthPx(figureUrls.length);
    const out: number[] = [];
    parsed.forEach((f, i) => {
      if (!f) {
        out.push(flat[i * 2] ?? 0, flat[i * 2 + 1] ?? 0);
        return;
      }
      const s = Math.min(1, capPx / f.width);
      out.push(f.width * s, f.height * s);
    });
    return out;
  };

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
      figureDims: capDims(r.figureUrls, r.figureDims),
      figureSourceMm: r.figureSourceMm ?? undefined,
      neededPx,
    });
  }
  if (unmeasured > 0)
    console.log(
      `⚠️ 출제 자격은 있는데 **높이를 안 잰** 문항 ${unmeasured.toLocaleString()}건 — 캐시를 뜬 뒤 들어온 것이다. 이 시뮬레이션에서는 빠진다.`,
    );
  /**
   * **치수를 모르는 그림**은 「미리 줄인 치수」로 상한을 못 넣는다 — 판정이 그 자리를
   * `UNKNOWN_FIGURE_HEIGHT_PX`(70mm 기준 중앙값)로 세기 때문이다. 지금 DB 에는 한 건도
   * 없지만, 생기면 그 문항만 상한이 안 걸린 채로 채점된다. **조용히 넘기지 않는다.**
   */
  if (unknownDims > 0) {
    if (cap)
      throw new Error(
        `그림 치수를 모르는 문항 ${unknownDims.toLocaleString()}건 — 상한을 «미리 줄인 치수»로 넣을 수 없다. ` +
          `이 조건의 경고 숫자는 그만큼 거짓이 된다.`,
      );
    console.log(
      `그림 치수를 모르는 문항 ${unknownDims.toLocaleString()}건 (상한을 안 걸었으므로 채점에는 영향 없음)`,
    );
  }

  /* ── 검산 — 출제의 후순위 판정 ↔ **분할이 장을 통째로 주는 문항**이 같은가 ──── */
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
    /**
     * **판정이 이 조건에서도 맞는가**를 같이 센다. 조건을 바꾸면 지면이 달라지고,
     * 그러면 판정의 성적도 달라진다 — 「경고가 덜 뜬다」가 «지면이 좋아졌다»인지
     * «판정이 눈이 멀었다»인지는 여기서만 갈린다. 참은 실측 높이다.
     */
    let warnCount = 0;
    let realCount = 0;
    let hitCount = 0;
    /**
     * 🔴 **2026-08-21 — 견주는 상대가 바뀌었다.** 분할이 문항 높이를 보게 되면서
     *    (원장님 확정) 반 칸을 넘는 문항은 **경고가 아니라 자리로** 풀린다. 그러니
     *    「출제가 미는 문항 == 인쇄가 경고하는 문항」은 더 이상 참이 아니고, 참인
     *    것은 **「출제가 미는 문항 == 분할이 장을 통째로 주는 문항」**이다.
     *    뜻은 그대로다 — 출제와 조판이 «반 칸에 들어가는가»를 **한 규칙**으로 본다.
     */
    for (const p of pool) {
      // 3번 자리 = 이어지는 장. 캐시가 잰 것과 같은 자리다.
      const placed = [filler, filler, ...toPrint([p]), filler];
      const page = packProblems(placed).find((pg) =>
        pg.problems.some((q) => q.id === p.id),
      )!;
      const alone = page.problems.length === 1;
      const tight = risksTightSeat(p, JASEUP_MEASURED_PX.continuationSlot);
      if (tight !== alone) {
        drift += 1;
        if (!example) example = p.id;
      }
      const real = p.neededPx > JASEUP_MEASURED_PX.continuationSlot;
      if (tight) warnCount += 1;
      if (real) realCount += 1;
      if (tight && real) hitCount += 1;
    }
    if (drift > 0)
      throw new Error(
        `출제의 후순위 판정이 분할과 ${drift}건 다르다 — 규칙이 두 벌이 됐다. 예: ${example}`,
      );
    console.log(
      `검산 · 출제 후순위 판정 ↔ 분할이 장을 통째로 주는 문항 일치 (0건 불일치, ${pool.length.toLocaleString()}건 전수)`,
    );
    console.log(
      `검산 · 이 조건에서 판정의 성적 (484px 칸, 출제 가능 풀 전수) — ` +
        `실측 넘침 ${realCount.toLocaleString()} · 경고 ${warnCount.toLocaleString()} · 맞음 ${hitCount.toLocaleString()}` +
        ` · 재현율 ${((100 * hitCount) / Math.max(1, realCount)).toFixed(1)}%` +
        ` · 정밀도 ${((100 * hitCount) / Math.max(1, warnCount)).toFixed(1)}%`,
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
    const ratio = ratioFor(count);
    /**
     * 🔴 자리는 **시험지마다 다르다.** 분할이 문항 높이를 보게 된 뒤로
     *    (원장님 확정 2026-08-21) 개수로 미리 구할 수 없다 — 아래 채점 고리 안에서
     *    그 시험지의 실제 문항으로 구한다. 여기 표시는 «짧은 문항만일 때»의 모양이다.
     */
    const nominal = seatCapacitiesFor(
      Array.from({ length: count }, () => ({ content: "짧다." })),
    );
    const seatDesc = `${nominal.filter((s) => s === firstPageSlot).length}×${firstPageSlot} · ${nominal.filter((s) => s === continuationSlot).length}×${continuationSlot}${
      count % 2 === 1 ? ` · 1×${nominal[nominal.length - 1]}` : ""
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
          // 자리는 그 시험지의 **실제 문항**이 정한다(높은 문항은 칸을 혼자 쓴다).
          const printed = toPrint(order);
          const seats = seatCapacitiesFor(printed);
          arm.pages += packProblems(printed).length;
          arm.overflow += overflowCount(order, seats);
          // 🔴 **같은 시험지**를 옛 분할로 찍었다면 — 분할만 갈아 낀 대조군.
          arm.legacyPages += packProblemsLegacy(printed).length;
          arm.legacyOverflow += overflowCount(
            order,
            legacySeatCapacities(printed),
          );
          const risks = assessOverflowRisk(printed);
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
      `      시험지 장 수 ${per(base.pages)} → ${per(arms[1]!.pages)}장/장`,
    );
    const now = arms[1]!;
    console.log(
      `  └ 분할만 갈아 끼우면 (같은 시험지 · 같은 문항 순서)
` +
        `      옛 분할(장당 2문항 고정)  넘침 ${per(now.legacyOverflow)}건/장 · ${per(now.legacyPages)}장
` +
        `      지금(길이가 정한다)       넘침 ${per(now.overflow)}건/장 · ${per(now.pages)}장`,
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
