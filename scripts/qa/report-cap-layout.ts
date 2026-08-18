/**
 * 「그림 폭 상한 × 문항번호 서식」 조합의 **넘침 건수**를 낸다 (읽기 전용).
 *
 *   npx tsx scripts/qa/report-cap-layout.ts
 *   npx tsx scripts/qa/report-cap-layout.ts --write   # 조합별 전수 높이 캐시(.measure/mix-*.json)를 만든다
 *
 * ## 조합을 어떻게 만드나 — **전부 실측이고, 합성한 자리마다 근거가 있다**
 *
 * 조합이 18가지인데 하나가 전수 47,152건 렌더에 40분이다. 그래서 다시 그리는
 * 범위를 줄이되, 줄인 근거를 **숫자로 확인**한다.
 *
 *   ① **그림이 없는 문항은 상한과 무관하다.** 상한 덧칠은 `.figureRow img` 를 고르는데
 *      그림이 없으면 그 선택자가 **아무것도 못 고른다** — 지면이 글자 하나까지 같다.
 *      → 상한 넷(70·55·45·29mm)을 전수로 잰 파일끼리 그림 없는 문항 37,989건을 대조해
 *        **한 건도 다르지 않은지** 여기서 확인한다. 다르면 멈춘다. 그리고 **그 반대도**
 *        본다 — 그림 있는 문항은 반드시 달라져야 한다(안 달라지면 덧칠이 헛돈 것이다).
 *   ② **번호 서식이 더 먹는 세로는 상한과 무관하다.** 번호 줄은 본문 **위**의 블록이라
 *      본문 폭을 안 건드린다. → 그림 있는 문항 9,163건을 상한별로 **다시 그려**
 *      (`--only figures`) 70mm 에서 잰 Δ 와 같은지 확인한다. 다르면 멈춘다.
 *   ③ **권고안(1장 70mm · 2~4장 45mm · 5장+ 29mm)** 과 **권고안+축소(1장 55mm · …)** 는
 *      문항마다 그 장수에 맞는 상한의 **실측값을 그대로 고른 것**이다 — 근사가 아니다.
 *      같은 문항을 45mm 로 그리든 권고안으로 그리든, 2장짜리면 두 지면이 완전히 같기 때문이다.
 *
 * 넘침은 `usedPx`(문항 열에 그려진 것 중 가장 아래)로 센다. 칸은 실측값이다 —
 * 이어지는 장 484px · 첫 장 405px · 혼자 쓰는 칸 997px.
 *
 * ⚠️ 첫 장(405px) 숫자도 **이어지는 장으로 그린 높이**로 센다. 문항 높이가 장 종류와
 *    무관하다는 것은 3,000건으로 확인했다(`measure-cap-layout.tsx --verify-page-kind`,
 *    다른 것 0건 · 최대 차 0.000px). 첫 장은 칸만 79px 좁다.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { PrismaClient } from "@prisma/client";

import { JASEUP_MEASURED_PX } from "../../src/lib/printGeometry";
import { capByName } from "./capLayoutProbe";
import {
  estimateFigureBlockPx,
  parseFigureDimensions,
} from "../../src/lib/printOverflow";
import {
  buildHeightCacheManifest,
  measuredRowsHash,
  readHeightCacheManifest,
  rowDigests,
  writeHeightCacheManifest,
} from "./heightCacheManifest";

const prisma = new PrismaClient();

interface Height {
  pid: string;
  availPx: number;
  neededPx: number;
  usedPx: number;
  figurePx: number;
}

const CAPS = ["cap70", "cap55", "cap45", "cap29"] as const;
const LAYOUTS = ["base", "d", "dtight-a"] as const;
type Cap = (typeof CAPS)[number] | "policy" | "policy55";
type Layout = (typeof LAYOUTS)[number];

const CAP_LABEL: Record<Cap, string> = {
  cap70: "70mm(현행)",
  cap55: "55mm (다열은 안 됨 — 축소만)",
  cap45: "45mm",
  cap29: "29mm",
  policy: "권고안(1장 70 · 2~4장 45 · 5장+ 29)",
  policy55: "권고안+축소(1장 55 · 2~4장 45 · 5장+ 29)",
};
const LAYOUT_LABEL: Record<Layout, string> = {
  base: "지금 그대로",
  d: "D",
  "dtight-a": "D-tight",
};

const full = (cap: string, layout: string) =>
  `.measure/cl-${cap}-${layout}.json`;
const figuresOnly = (cap: string, layout: string) =>
  `.measure/cl-${cap}-${layout}-fig.json`;

/**
 * 조건 파일 하나를 읽는다. 읽으면서 두 가지를 확인한다.
 *   · **두 자가 같은 것을 가리키는가** — `usedPx`(가장 아래)와 `neededPx`(정답란 아래).
 *     이 표는 `usedPx` 로 세고 시뮬레이터는 `neededPx` 로 센다. 둘이 갈라지면 같은
 *     조건인데 표와 시뮬레이터가 다른 지면을 말하게 된다.
 *   · **어느 DB 를 보고 잰 것인가** — 조건 파일들이 서로 다른 시각의 공유 DB 를 보면
 *     「45mm 가 낮다」의 일부가 상한이 아니라 시각 차이가 된다.
 */
const seenRowsHash = new Map<string, string>();
/** 그 파일이 **그림 있는 문항만** 잰 것인가 — 지문의 분모가 다르다. */
const seenOnlyFigures = new Map<string, boolean>();
function read(path: string): Map<string, Height> {
  if (!existsSync(path)) throw new Error(`없는 파일이다: ${path}`);
  const rows = JSON.parse(readFileSync(path, "utf8")) as Height[];
  const gap = rows.filter((r) => Math.abs(r.usedPx - r.neededPx) > 0.5);
  if (gap.length > 0)
    throw new Error(
      `${path}: 「가장 아래」와 「정답란 아래」가 ${gap.length}건 다르다 — 표와 시뮬레이터가 다른 자를 쓰게 된다.`,
    );
  const manifest = readHeightCacheManifest(path);
  if (!manifest)
    throw new Error(`${path}: 지문이 없다 — 무엇을 보고 잰 것인지 모른다.`);
  seenRowsHash.set(path, manifest.rowsHash);
  seenOnlyFigures.set(
    path,
    manifest.overlay?.includes(";only=figures") ?? false,
  );
  return new Map(rows.map((r) => [r.pid, r]));
}

/**
 * 조건 파일들이 **같은 DB** 를 보고 잰 것인지. 다르면 그 사실을 말하고 멈춘다.
 *
 * ⚠️ 지문의 **분모가 파일마다 다르다** — 전수 파일은 47,152건으로, `--only figures`
 *    파일은 9,163건으로 계산한다. 한 값으로 대면 뒤쪽이 늘 어긋나고, 그러면 이
 *    가드는 늘 빨개져서 결국 아무도 안 본다(임계값을 물려받을 때 분모부터 볼 것 —
 *    CLAUDE.md 2026-08-17).
 */
function assertSameCorpus(nowHash: string, nowFiguresHash: string) {
  const bad = [...seenRowsHash.entries()].filter(
    ([f, h]) => h !== (seenOnlyFigures.get(f) ? nowFiguresHash : nowHash),
  );
  if (bad.length === 0) return;
  throw new Error(
    [
      "조건 파일이 지금 DB 와 다른 것을 보고 잰 것이다 (공유 DB 가 그 사이 움직였다):",
      ...bad.map(
        ([f, h]) =>
          `  · ${f} ${h.slice(0, 12)} ≠ 지금 ${(seenOnlyFigures.get(f) ? nowFiguresHash : nowHash).slice(0, 12)}`,
      ),
      "각 파일을 기워라: npx tsx scripts/qa/measure-cap-layout.tsx --patch <파일> --cap <상한> --layout <배치>",
    ].join("\n"),
  );
}

/** 두 측정본이 지정한 문항 집합에서 한 건도 다르지 않은지 — 다르면 그 사실을 돌려준다. */
function compare(
  a: Map<string, Height>,
  b: Map<string, Height>,
  ids: string[],
): { diff: number; maxDelta: number; examples: string[] } {
  let diff = 0;
  let maxDelta = 0;
  const examples: string[] = [];
  for (const id of ids) {
    const x = a.get(id);
    const y = b.get(id);
    if (!x || !y) continue;
    const d = Math.abs(x.usedPx - y.usedPx);
    if (d > 0.01) {
      diff += 1;
      maxDelta = Math.max(maxDelta, d);
      if (examples.length < 5)
        examples.push(`${id} ${x.usedPx.toFixed(2)} vs ${y.usedPx.toFixed(2)}`);
    }
  }
  return { diff, maxDelta, examples };
}

async function main() {
  const write = process.argv.includes("--write");

  const rows = (await prisma.$queryRawUnsafe(
    `SELECT id, content, figure_urls AS "figureUrls", question_type AS "questionType",
            figure_dims AS "figureDims",
            coalesce(array_length(figure_urls,1), 0) AS "figureCount"
       FROM problem ORDER BY id`,
  )) as Array<{
    id: string;
    content: string;
    figureUrls: string[];
    questionType: string | null;
    figureDims: number[] | null;
    figureCount: number;
  }>;
  const figureCount = new Map(rows.map((r) => [r.id, r.figureCount]));
  const withFigures = rows.filter((r) => r.figureCount > 0).map((r) => r.id);
  const noFigures = rows.filter((r) => r.figureCount === 0).map((r) => r.id);
  console.log(
    `문항 ${rows.length.toLocaleString()}건 — 그림 있음 ${withFigures.length.toLocaleString()} · 없음 ${noFigures.length.toLocaleString()}\n`,
  );

  /* ── 근거 ① 그림 없는 문항은 상한과 무관한가 ────────────────────────────── */
  const baseByCap = new Map<string, Map<string, Height>>();
  for (const cap of CAPS) baseByCap.set(cap, read(full(cap, "base")));
  console.log("근거 ① 그림 없는 문항은 상한이 무엇이든 같은가 (70mm 대비)");
  for (const cap of CAPS.slice(1)) {
    const r = compare(baseByCap.get("cap70")!, baseByCap.get(cap)!, noFigures);
    console.log(
      `  ${cap}: 다른 것 ${r.diff}건 (최대 차 ${r.maxDelta.toFixed(2)}px)` +
        r.examples.map((e) => `\n    · ${e}`).join(""),
    );
    if (r.diff > 0)
      throw new Error(
        `그림 없는 문항이 상한에 따라 달라진다 — 덧칠이 그림 밖까지 건드리고 있다. 조합을 합성할 수 없다.`,
      );
  }
  // 그리고 **그림 있는 문항은 실제로 달라져야 한다** — 안 달라지면 덧칠이 헛돈 것이다.
  for (const cap of CAPS.slice(1)) {
    const r = compare(
      baseByCap.get("cap70")!,
      baseByCap.get(cap)!,
      withFigures,
    );
    console.log(
      `  (대조) ${cap}: 그림 있는 문항 중 달라진 것 ${r.diff.toLocaleString()}건 (최대 차 ${r.maxDelta.toFixed(0)}px)`,
    );
    if (r.diff === 0)
      throw new Error(
        `${cap}: 그림 있는 문항도 한 건도 안 달라졌다 — 상한이 안 걸린 것이다.`,
      );
  }

  /* ── 조합표를 만든다 ────────────────────────────────────────────────────── */
  const table = new Map<string, Map<string, Height>>();
  const key = (cap: Cap, layout: Layout) => `${cap}|${layout}`;

  console.log(
    "\n근거 ② 번호 서식의 Δ 가 상한과 무관한가 (그림 있는 문항 전수 재측정)",
  );
  for (const layout of LAYOUTS) {
    const at70 = read(full("cap70", layout));
    table.set(key("cap70", layout), at70);
    for (const cap of CAPS.slice(1)) {
      const capBase = baseByCap.get(cap)!;
      if (layout === "base") {
        table.set(key(cap, layout), capBase);
        continue;
      }
      const fig = read(figuresOnly(cap, layout));
      // Δ 대조: (상한 C 에서 잰 배치 L) − (상한 C 의 base) 가 70mm 에서 잰 Δ 와 같은가.
      let diff = 0;
      let maxDelta = 0;
      const examples: string[] = [];
      const merged = new Map(at70);
      /**
       * ⚠️ **빠진 문항을 조용히 넘기면 그 행만 70mm 값으로 남는다.** 공유 DB 가
       * 재는 도중에 그림을 붙이면 그런 행이 생기는데, 그러면 「45mm 표」의 일부가
       * 실은 70mm 다 — 게다가 그쪽이 늘 «더 나쁜» 쪽이라 눈에 안 띈다.
       */
      const absent = withFigures.filter(
        (id) => !fig.has(id) || !capBase.has(id) || !at70.has(id),
      );
      if (absent.length > 0)
        throw new Error(
          `${figuresOnly(cap, layout)}: 그림 있는 문항 ${absent.length}건이 빠져 있다(예: ${absent[0]}) — ` +
            `공유 DB 가 그 사이 움직였다. 기워라: npx tsx scripts/qa/measure-cap-layout.tsx --patch <파일> --cap ${cap} --layout ${layout}`,
        );
      for (const id of withFigures) {
        const a = fig.get(id);
        const b = capBase.get(id);
        const l70 = at70.get(id);
        const b70 = baseByCap.get("cap70")!.get(id);
        if (!a || !b || !l70 || !b70) continue;
        const d = Math.abs(a.usedPx - b.usedPx - (l70.usedPx - b70.usedPx));
        if (d > 0.01) {
          diff += 1;
          maxDelta = Math.max(maxDelta, d);
          if (examples.length < 5)
            examples.push(
              `${id} Δ${cap} ${(a.usedPx - b.usedPx).toFixed(2)} vs Δ70 ${(l70.usedPx - b70.usedPx).toFixed(2)}`,
            );
        }
        merged.set(id, a);
      }
      console.log(
        `  ${cap} × ${layout}: Δ 가 다른 것 ${diff}건 (최대 차 ${maxDelta.toFixed(2)}px)` +
          examples.map((e) => `\n    · ${e}`).join(""),
      );
      table.set(key(cap, layout), merged);
    }
  }

  /* ── 권고안 — 문항마다 그 장수에 맞는 상한의 **실측값을 고른다** ───────────
     근사가 아니다: 2장짜리 문항을 45mm 로 그리든 권고안으로 그리든 지면이 완전히 같다. */
  for (const [name, oneSheet] of [
    ["policy", "cap70"],
    ["policy55", "cap55"],
  ] as [Cap, Cap][]) {
    for (const layout of LAYOUTS) {
      const picked = new Map<string, Height>();
      for (const r of rows) {
        const cap: Cap =
          r.figureCount >= 5
            ? "cap29"
            : r.figureCount >= 2
              ? "cap45"
              : oneSheet;
        const found = table.get(key(cap, layout))!.get(r.id);
        if (found) picked.set(r.id, found);
      }
      table.set(key(name, layout), picked);
    }
  }

  const digestOf = (list: typeof rows) =>
    measuredRowsHash(
      list.map((r) => ({
        id: r.id,
        content: r.content,
        figureUrls: r.figureUrls,
        questionType: r.questionType,
      })),
    );
  assertSameCorpus(
    digestOf(rows),
    digestOf(rows.filter((r) => r.figureCount > 0)),
  );

  /* ── 표 ─────────────────────────────────────────────────────────────────── */
  const { continuationSlot, firstPageSlot, soloContinuationSlot } =
    JASEUP_MEASURED_PX;
  const order: Cap[] = [
    "cap70",
    "cap55",
    "cap45",
    "cap29",
    "policy",
    "policy55",
  ];
  console.log(
    `\n넘침 건수 (전수 ${rows.length.toLocaleString()}건 · 실측 높이 vs 실측 칸)\n`,
  );
  console.log(
    "그림 폭 상한".padEnd(34) +
      "배치".padEnd(14) +
      "484px".padStart(9) +
      "405px".padStart(9) +
      "997px".padStart(8) +
      "중앙높이".padStart(9),
  );
  console.log("─".repeat(84));
  const rowsOut: string[] = [];
  for (const cap of order) {
    for (const layout of LAYOUTS) {
      const m = table.get(key(cap, layout))!;
      const values = [...m.values()];
      if (values.length !== rows.length)
        throw new Error(
          `${cap}×${layout}: 조합표가 ${values.length}건뿐이다(전수 ${rows.length}) — 빠진 문항이 있다.`,
        );
      const over = (limit: number) =>
        values.filter((v) => v.usedPx > limit).length;
      const sorted = values.map((v) => v.usedPx).sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)]!;
      console.log(
        CAP_LABEL[cap].padEnd(34) +
          LAYOUT_LABEL[layout].padEnd(14) +
          over(continuationSlot).toLocaleString().padStart(9) +
          over(firstPageSlot).toLocaleString().padStart(9) +
          over(soloContinuationSlot).toLocaleString().padStart(8) +
          `${median.toFixed(0)}px`.padStart(9),
      );
      rowsOut.push(
        `| ${CAP_LABEL[cap]} | ${LAYOUT_LABEL[layout]} | ${over(continuationSlot).toLocaleString()} / ${over(firstPageSlot).toLocaleString()} | ${over(soloContinuationSlot)} | ${median.toFixed(0)}px |`,
      );
      if (write) {
        const outPath = `.measure/mix-${cap}-${layout}.json`;
        mkdirSync(".measure", { recursive: true });
        writeFileSync(outPath, JSON.stringify(values), "utf8");
        writeHeightCacheManifest(
          outPath,
          buildHeightCacheManifest({
            kind: "continuation",
            rows: values.length,
            rowsHash: measuredRowsHash(rows),
            slotPx: continuationSlot,
            measuredAt: new Date().toISOString(),
            rowDigests: rowDigests(rows),
            overlay: `cap=${cap};layout=${layout}`,
          }),
        );
      }
    }
  }
  if (write) console.log("\n→ .measure/mix-<상한>-<배치>.json (지문 포함)");
  console.log("\n마크다운 표:");
  for (const line of rowsOut) console.log(line);

  /* ── 문턱 둘레에 몇 건이 몰려 있나 ───────────────────────────────────────
     D 의 값은 「문턱 가까이 몰려 있는 문항이 얼마나 많은가」의 함수다. 지금은 여유
     5px 안쪽이 484px 기준 333건·405px 기준 564건이라 조금만 밀어도 우수수 넘어간다.
     상한을 낮추면 그 밀집이 실제로 흩어지는지 — 그게 「곧 바뀐다」의 근거다. */
  console.log(
    "\n문턱 바로 아래에 몰려 있는 문항 (배치는 지금 그대로 · 아직 안 넘친 것)",
  );
  console.log(
    "그림 폭 상한".padEnd(34) +
      "484px 여유≤5".padStart(13) +
      "≤10".padStart(8) +
      "≤20".padStart(8) +
      "405px 여유≤5".padStart(14) +
      "≤10".padStart(8) +
      "≤20".padStart(8),
  );
  for (const cap of order) {
    const m = table.get(key(cap, "base"))!;
    const values = [...m.values()].map((v) => v.usedPx);
    const near = (limit: number, w: number) =>
      values.filter((v) => v <= limit && limit - v <= w).length;
    console.log(
      CAP_LABEL[cap].padEnd(34) +
        near(continuationSlot, 5).toLocaleString().padStart(13) +
        near(continuationSlot, 10).toLocaleString().padStart(8) +
        near(continuationSlot, 20).toLocaleString().padStart(8) +
        near(firstPageSlot, 5).toLocaleString().padStart(14) +
        near(firstPageSlot, 10).toLocaleString().padStart(8) +
        near(firstPageSlot, 20).toLocaleString().padStart(8),
    );
  }

  /* ── 판정이 이 상한에서도 그림을 옳게 세는가 ─────────────────────────────
     경고는 제품의 **추정**이다. 상한을 낮췄을 때 경고가 덜 뜨는 것이 «지면이
     좋아져서»인지 «추정이 눈이 멀어서»인지는 이걸 봐야 갈린다. 시뮬레이터가
     조건별 재현율·정밀도를 따로 찍지만, 그림 묶음만 떼어 보면 원인이 분명해진다.

     ⚠️ 상한은 **미리 줄인 치수**로 넣는다 — `estimateFigureBlockPx` 의
     `min(1, figureMaxWidth/w)` 가 1이 되어 그 값을 그대로 쓰므로, 상한을 낮춘 것과
     수학적으로 같다. 규칙을 옮겨 적지 않는다. */
  console.log(
    "\n그림 묶음 — 제품 추정 vs 실측 (그림 있는 문항, 배치는 지금 그대로)",
  );
  const dimsById = new Map(rows.map((r) => [r.id, r.figureDims]));
  const countById = new Map(rows.map((r) => [r.id, r.figureCount]));
  for (const cap of order) {
    const m = table.get(key(cap, "base"))!;
    // 상한 CSS 와 **같은 한 곳**에서 값을 가져온다 — 옮겨 적으면 갈라진다.
    const capPxOf = (n: number) => capByName(cap).expectedMaxWidthPx(n);
    const errors: number[] = [];
    let unknown = 0;
    for (const id of withFigures) {
      const measuredPx = m.get(id)!.figurePx;
      const n = countById.get(id)!;
      const parsed = parseFigureDimensions(n, dimsById.get(id) ?? undefined);
      if (parsed.some((f) => f === null)) {
        unknown += 1;
        continue;
      }
      const capPx = capPxOf(n);
      const scaled = parsed.map((f) => {
        const s2 = Math.min(1, capPx / f!.width);
        return { width: f!.width * s2, height: f!.height * s2 };
      });
      /**
       * ⚠️ **자를 맞춘다.** `estimateFigureBlockPx` 는 그림 묶음 위 여백(`mt-3` 12px)을
       * 포함한 값이고, 실측 `figurePx` 는 `.figureRow` **상자 자체**의 높이라 그 여백이
       * 빠져 있다. 안 맞추면 오차가 전 구간에서 정확히 +12.0px 로 나오고, 그걸
       * 「추정이 12px 크게 본다」로 읽게 된다 — 자가 다른 것을 재고 있는 것이다.
       */
      errors.push(
        estimateFigureBlockPx(scaled) -
          JASEUP_MEASURED_PX.figureBlockTop -
          measuredPx,
      );
    }
    errors.sort((a, b) => a - b);
    const at = (q: number) => errors[Math.floor(errors.length * q)]!;
    const within = errors.filter((e) => Math.abs(e) <= 20).length;
    console.log(
      `  ${CAP_LABEL[cap].padEnd(34)} 오차 중앙 ${at(0.5).toFixed(1)}px · p05 ${at(0.05).toFixed(1)} · p95 ${at(0.95).toFixed(1)}` +
        ` · |오차|≤20px ${((100 * within) / errors.length).toFixed(1)}%` +
        (unknown > 0 ? ` · 치수 모름 ${unknown}건(뺐다)` : ""),
    );
  }

  /* ── 곁가지 — 그림 장수별로 무엇이 실제로 달라지나 ─────────────────────── */
  console.log(
    "\n그림 장수별 — 70mm 대비 문항 높이 중앙값 변화 (배치는 지금 그대로)",
  );
  const buckets = new Map<string, string[]>();
  for (const r of rows) {
    if (r.figureCount === 0) continue;
    const b =
      r.figureCount === 1 ? "1장" : r.figureCount <= 4 ? "2~4장" : "5장+";
    buckets.set(b, [...(buckets.get(b) ?? []), r.id]);
  }
  for (const [bucket, ids] of [...buckets.entries()].sort()) {
    const parts = [`${bucket} ${ids.length.toLocaleString()}건`];
    for (const cap of CAPS) {
      const m = baseByCap.get(cap)!;
      const s = ids.map((id) => m.get(id)!.usedPx).sort((a, b) => a - b);
      parts.push(`${cap} ${s[Math.floor(s.length / 2)]!.toFixed(0)}px`);
    }
    console.log(`  ${parts.join(" · ")}`);
  }
  void figureCount;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
