/**
 * 자습 문제지가 **실제로 잘리는 문항**을 전수로 센다 (읽기 전용 · DB 읽기만).
 *
 * `printOverflow.ts` 의 경고와 대조해 «넘치는데 경고가 없는 것»을 낸다 —
 * 그게 학생에게 그대로 인쇄돼 나가는 부류다(절대 규칙 6).
 *
 *   npx tsx scripts/qa/measure-print-overflow.tsx                 # 전수, 이어지는 장
 *   npx tsx scripts/qa/measure-print-overflow.tsx --take 400      # 표본
 *   npx tsx scripts/qa/measure-print-overflow.tsx --screen        # 화면 미리보기 매체로
 *   npx tsx scripts/qa/measure-print-overflow.tsx --json out.json
 *   npx tsx scripts/qa/measure-print-overflow.tsx --verify out.json --take 2000
 *   npx tsx scripts/qa/measure-print-overflow.tsx --verify out.json --repair
 *
 * `--json` 은 높이 캐시와 함께 **지문**(`out.manifest.json`)을 남긴다. 지면 CSS·
 * `displayWidth`·본문이 바뀌면 캐시는 거짓이 되는데, 채점기가 그걸 볼 방법이
 * 그것뿐이다(적대적 리뷰 ④ F — 지문이 없을 때 실제로 조용히 통과했다).
 *
 * `--verify` 는 이미 있는 캐시를 **표본으로 다시 재서** 대조하고, 한 건도 다르지
 * 않으면 지문을 새로 찍는다. 전수 30분을 다시 쓰지 않고 캐시를 되살리는 자리다.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { PrismaClient } from "@prisma/client";
import { chromium, type Page } from "@playwright/test";

import { displayWidth } from "../../src/lib/math/displayWidth";
import {
  assessOverflowRisk,
  estimateProblemLines,
  parseFigureDimensions,
} from "../../src/lib/printOverflow";
import type { TestPrintProblem } from "../../src/components/print/types";
import {
  buildHeightCacheManifest,
  changedRowIds,
  measuredRowsHash,
  readHeightCacheManifest,
  rowDigests,
  writeHeightCacheManifest,
} from "./heightCacheManifest";
import {
  MEASURED,
  assertPaperSane,
  GUARD_SCRIPT,
  paperDocument,
  renderPage,
  renderSlot,
  writeProbe,
} from "./paperProbe";

const prisma = new PrismaClient();

interface Row {
  id: string;
  content: string;
  figureUrls: string[];
  figureDims: number[] | null;
  questionType: string | null;
}

interface Measured {
  pid: string;
  /** 문항 칸의 **실제** 남은 세로 (article 의 content box) */
  availPx: number;
  /** 문항번호 위 ~ 정답란 아래 실제 높이 */
  neededPx: number;
  figurePx: number;
  choicePx: number;
  boxPx: number;
}

/**
 * 지면을 그려 높이를 잰다. **장마다 두 문항**을 넣는다 — 칸은 `flex: 1 1 0%` 로
 * 나뉘므로 한 장에 하나만 넣으면 칸이 두 배가 되어 다른 것을 재게 된다.
 */
async function measureRows(
  page: Page,
  rows: Row[],
  kind: "first" | "continuation",
  onProgress?: (done: number) => void,
): Promise<Measured[]> {
  const all: Measured[] = [];
  const PAGES_PER_BATCH = 60;
  for (let start = 0; start < rows.length; start += PAGES_PER_BATCH * 2) {
    const chunk = rows.slice(start, start + PAGES_PER_BATCH * 2);
    const pages: string[] = [];
    for (let i = 0; i < chunk.length; i += 2) {
      const slots = chunk.slice(i, i + 2).map((row, j) =>
        renderSlot(
          {
            id: row.id,
            content: row.content ?? "",
            figureUrls: row.figureUrls,
            essayNumber: row.questionType === "서술형" ? 1 : null,
          },
          i + j + 1,
        ),
      );
      pages.push(renderPage(kind, slots, kind === "first" ? 1 : 2));
    }
    const url = writeProbe("probe-overflow.html", await paperDocument(pages));
    await page.goto(url, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    assertPaperSane(await page.evaluate(GUARD_SCRIPT));

    const measured = (await page.evaluate(() => {
      const out: unknown[] = [];
      document.querySelectorAll(".problemItem").forEach((node) => {
        const item = node as HTMLElement;
        const num = item.querySelector(".questionNumber") as HTMLElement;
        const blank = item.querySelector(".answerBlank") as HTMLElement;
        const view = item.querySelector("[data-paper-view]") as HTMLElement;
        const style = getComputedStyle(item);
        let boxPx = 0;
        view.querySelectorAll("[data-box-card]").forEach((b) => {
          boxPx += (b as HTMLElement).getBoundingClientRect().height;
        });
        const figures = view.querySelector(
          "div[class*='mt-3']",
        ) as HTMLElement | null;
        const choices = view.querySelector(
          "div[class*='mt-4']",
        ) as HTMLElement | null;
        out.push({
          pid: item.dataset.pid,
          // ⚠️ grid row 가 아니라 article 의 content box 로 잰다(paperProbe 주석 (4)).
          availPx:
            item.clientHeight -
            parseFloat(style.paddingTop) -
            parseFloat(style.paddingBottom),
          neededPx:
            blank.getBoundingClientRect().bottom -
            num.getBoundingClientRect().top,
          figurePx: figures ? figures.getBoundingClientRect().height : 0,
          choicePx: choices ? choices.getBoundingClientRect().height : 0,
          boxPx,
        });
      });
      return out;
    })) as Measured[];
    all.push(...measured);
    onProgress?.(all.length);
  }
  return all;
}

/**
 * 실측 칸 높이를 하나로 모은다. 값이 갈리면 **지면이 우리가 아는 그 지면이 아니다** —
 * 조용히 평균 내지 말고 멈춘다.
 */
function singleSlot(measured: Measured[]): number {
  const distinct = [...new Set(measured.map((m) => m.availPx))];
  if (distinct.length !== 1)
    throw new Error(
      `문항 칸 높이가 ${distinct.length}가지다(${distinct.slice(0, 5).join(", ")}) — 지면이 바뀌었다. 측정 중단.`,
    );
  return distinct[0]!;
}

async function fetchRows(take: number): Promise<Row[]> {
  return (await prisma.$queryRawUnsafe(
    `SELECT id, content, figure_urls AS "figureUrls", figure_dims AS "figureDims",
            question_type AS "questionType"
       FROM problem ORDER BY id ${take > 0 ? `LIMIT ${take}` : ""}`,
  )) as Row[];
}

async function main() {
  const arg = (name: string) => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const take = Number(arg("--take") ?? 0);
  const outPath = arg("--json");
  const verifyPath = arg("--verify");
  const media = process.argv.includes("--screen") ? "screen" : "print";
  const kind = process.argv.includes("--first-page") ? "first" : "continuation";

  if (verifyPath)
    return verify(
      verifyPath,
      take || 2000,
      kind,
      media,
      process.argv.includes("--repair"),
    );

  const rows = await fetchRows(take);
  console.log(
    `문항 ${rows.length.toLocaleString()}건 · ${kind} 장 · ${media} 매체`,
  );

  /**
   * ⚠️ **홀수면 마지막 장이 한 문항이 되고 그 칸은 두 배(997px)다.**
   *    그러면 `singleSlot` 이 「칸이 2가지다 — 지면이 바뀌었다」로 멈춘다. 지면은
   *    안 바뀌었는데도 그렇다 — **문항 수가 홀수인 것뿐**이다. 28분을 다 쓰고 마지막
   *    한 줄에서 전부 버려진다(2026-08-20 실제 발생: 중복 372건을 지워 47,049가 됐다).
   *
   *    `verify()` 는 이 함정을 알고 채워 넣는데(§짝수로 맞춘다) **전수 경로에는 그게
   *    없었다.** 같은 규칙이 두 곳에 있으면 한쪽만 고쳐도 아무도 모른다 —
   *    그래서 여기서도 같은 방식으로 채운다: 앞의 한 문항을 **한 번 더** 재고,
   *    잰 뒤 그 덧댄 줄만 버린다.
   */
  const padded = rows.length % 2 === 1 ? [...rows, rows[0]!] : rows;
  if (padded.length !== rows.length)
    console.log(
      "문항 수가 홀수라 마지막 장이 한 문항이 된다 — 앞의 한 문항을 덧대 짝을 맞춘다(잰 뒤 버린다).",
    );

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1000, height: 1200 },
  });
  if (media === "print") await page.emulateMedia({ media: "print" });

  let all: Measured[];
  try {
    all = await measureRows(page, padded, kind, (done) =>
      process.stdout.write(`\r측정 ${done}/${padded.length}`),
    );
  } finally {
    await browser.close();
  }
  console.log("");

  // 덧댄 줄을 버린다 — 맨 끝 하나다(앞의 문항을 한 번 더 잰 것).
  if (padded.length !== rows.length) all = all.slice(0, -1);
  if (all.length !== rows.length)
    throw new Error(`잰 줄 ${all.length} ≠ 문항 ${rows.length} — 멈춘다.`);

  const byId = new Map(rows.map((r) => [r.id, r]));
  const slot = singleSlot(all);
  const expected =
    kind === "first" ? MEASURED.slotFirstPagePx : MEASURED.slotContinuationPx;
  if (slot !== expected)
    console.warn(
      `⚠️ 실측 문항 칸 ${slot}px 인데 상수는 ${expected}px 이다 — paperProbe.MEASURED 와 JASEUP_MEASURED_PX 를 같이 고칠 것.`,
    );

  let over = 0;
  let missed = 0;
  let falseAlarm = 0;
  const missedRows: Array<{ pid: string; excess: number; lines: number }> = [];
  for (const m of all) {
    const row = byId.get(m.pid)!;
    const problem: TestPrintProblem = {
      id: row.id,
      orderIndex: 0,
      content: row.content ?? "",
      answer: "",
      solution: null,
      figureUrls: row.figureUrls,
      // ⚠️ 치수를 안 넘기면 이 요약만 «전부 모른다»로 채점된다 — 판정이 실제로 보는
      //    것과 달라져 「놓침」이 부풀려 보인다(적대적 리뷰 ④에서 실제로 그랬다).
      figureDims: row.figureDims ?? undefined,
    };
    // ⚠️ 판정은 «그 장에 몇 개인가»로 칸을 고른다. 지면은 두 문항으로 그렸으므로
    //    판정에도 짝을 채워 넣어야 같은 칸을 본다(혼자면 칸이 두 배다).
    const filler: TestPrintProblem = {
      id: "filler",
      orderIndex: 0,
      content: "",
      answer: "",
      solution: null,
    };
    const placed =
      kind === "first" ? [problem, filler] : [filler, filler, problem, filler];
    const at = kind === "first" ? 1 : 3;
    const warned = assessOverflowRisk(placed).some((r) => r.number === at);
    const overflows = m.neededPx > m.availPx;
    if (overflows) over += 1;
    if (overflows && !warned) {
      missed += 1;
      missedRows.push({
        pid: m.pid,
        excess: m.neededPx - m.availPx,
        lines: estimateProblemLines(
          row.content ?? "",
          parseFigureDimensions(
            row.figureUrls.length,
            row.figureDims ?? undefined,
          ),
        ),
      });
    }
    if (!overflows && warned) falseAlarm += 1;
  }
  const pct = (n: number) => `${((n * 100) / all.length).toFixed(2)}%`;
  console.log(`문항 칸 ${slot}px (실측)`);
  console.log(`실측 넘침            ${over} (${pct(over)})`);
  console.log(`★ 넘치는데 경고 없음 ${missed} (${pct(missed)})`);
  console.log(`  경고인데 안 넘침   ${falseAlarm} (${pct(falseAlarm)})`);
  console.log(
    `  경고 재현율        ${((100 * (over - missed)) / Math.max(1, over)).toFixed(1)}%`,
  );

  missedRows.sort((a, b) => b.excess - a.excess);
  console.log("\n놓친 표본 — 넘친 양이 큰 순");
  for (const r of missedRows.slice(0, 10)) {
    const row = byId.get(r.pid)!;
    console.log(
      `· ${r.pid} 넘침 ${r.excess.toFixed(0)}px 추정 ${r.lines}줄 폭 ${displayWidth(row.content ?? "")} 그림 ${row.figureUrls.length}`,
    );
  }

  if (outPath) {
    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(all), "utf8");
    const manifest = writeHeightCacheManifest(
      outPath,
      buildHeightCacheManifest({
        kind,
        rows: all.length,
        rowsHash: measuredRowsHash(rows),
        slotPx: slot,
        measuredAt: new Date().toISOString(),
        rowDigests: rowDigests(rows),
      }),
    );
    console.log(`\n→ ${outPath}\n→ ${manifest}`);
  }
}

/**
 * 이미 있는 캐시를 **표본으로 다시 재서** 대조한다. 한 건도 다르지 않으면
 * 지문을 새로 찍는다 — 「캐시가 아직 맞다」를 손이 아니라 도구가 말하게 한다.
 */
async function verify(
  cachePath: string,
  sample: number,
  kind: "first" | "continuation",
  media: string,
  repair: boolean,
) {
  const cached = JSON.parse(readFileSync(cachePath, "utf8")) as Measured[];
  const cachedById = new Map(cached.map((m) => [m.pid, m]));
  const rows = await fetchRows(0);
  if (rows.length !== cached.length)
    throw new Error(
      `캐시 ${cached.length}건 vs DB ${rows.length}건 — 표본으로 되살릴 수 없다. 전수로 다시 재라.`,
    );
  const missingRow = rows.find((r) => !cachedById.has(r.id));
  if (missingRow)
    throw new Error(`DB 문항 ${missingRow.id} 가 캐시에 없다 — 다시 재라.`);

  // 무작위를 안 쓴다 — 같은 명령이 같은 표본을 고르게 해서 재실행이 재현되게.
  const stride = Math.max(1, Math.floor(rows.length / Math.max(1, sample)));
  const spread = rows.filter((_, i) => i % stride === 0).slice(0, sample);

  /**
   * ⚠️ **본문이 바뀐 문항은 표본이 아니라 «반드시»다.** 공유 DB(D-31)는 다른 트랙이
   *    `apply-*` 로 본문을 고친다 — 실제로 이 도구를 만드는 동안에도 한 행이 바뀌었다.
   *    고루 뽑은 표본이 하필 그 문항을 안 뽑으면 «확인»이 아니라 요행이 된다.
   */
  const changed = changedRowIds(readHeightCacheManifest(cachePath), rows);
  if (changed === null)
    console.log(
      "이전 지문에 문항별 지문이 없다 — 바뀐 문항을 집어낼 수 없어 표본만 본다.",
    );
  else if (changed.length > 0)
    console.log(
      `본문이 바뀐 문항 ${changed.length.toLocaleString()}건 — 전부 다시 잰다.`,
    );
  const mustCheck = new Set(changed ?? []);

  /**
   * **캐시 자신이 어긋난 자리**도 반드시 다시 잰다. 칸 높이는 이 캐시 안에서 하나여야
   * 하는데(장마다 두 문항), 다른 값이 섞여 있으면 그 줄은 다른 지면을 잰 것이다.
   * (이 도구가 표본을 홀수로 골라 마지막 장을 한 문항으로 그린 적이 있다 — 그 한 줄이
   *  997px 로 들어갔다. 도구가 낸 흠은 도구가 스스로 알아채고 고쳐야 한다.)
   */
  const cacheSlot =
    kind === "first" ? MEASURED.slotFirstPagePx : MEASURED.slotContinuationPx;
  const odd = cached.filter((m) => m.availPx !== cacheSlot);
  if (odd.length > 0) {
    console.log(
      `캐시 안에서 칸이 어긋난 줄 ${odd.length}건 (${cacheSlot}px 이 아니다) — 같이 다시 잰다.`,
    );
    for (const m of odd) mustCheck.add(m.pid);
  }
  const picked = [
    ...spread,
    ...rows.filter((r) => mustCheck.has(r.id) && !spread.includes(r)),
  ];
  /**
   * ⚠️ **짝수로 맞춘다.** 장마다 두 문항을 넣으므로 홀수면 마지막 장이 한 문항이 되고,
   *    그 칸은 997px 이라 캐시(484px)와 다른 것을 잰다(적대적 리뷰 ④ B 와 같은 이유).
   *    **버리지 말고 채운다** — 버리면 하필 «반드시 봐야 할» 그 줄이 빠질 수 있다
   *    (실제로 그랬다). 표본에서 안 쓰인 문항 하나를 끝에 덧대 짝을 맞춘다.
   */
  if (picked.length % 2 === 1) {
    const inPicked = new Set(picked.map((r) => r.id));
    const filler = rows.find((r) => !inPicked.has(r.id));
    if (filler) picked.push(filler);
    else picked.pop();
  }
  console.log(
    `대조 ${picked.length.toLocaleString()}건 (고른 표본 ${spread.length.toLocaleString()} + 바뀐 문항 ${(picked.length - spread.length).toLocaleString()}) / 캐시 ${cached.length.toLocaleString()}건 · ${kind} 장 · ${media} 매체`,
  );

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1000, height: 1200 },
  });
  if (media === "print") await page.emulateMedia({ media: "print" });
  let fresh: Measured[];
  try {
    fresh = await measureRows(page, picked, kind, (done) =>
      process.stdout.write(`\r측정 ${done}/${picked.length}`),
    );
  } finally {
    await browser.close();
  }
  console.log("");

  /**
   * 다른 것을 **두 갈래로** 가른다.
   *   · 본문이 바뀐 문항 → **당연히 다르다.** 그 자리만 캐시를 깁는다(`--repair`).
   *   · 본문이 그대로인데 다르다 → **지면이 바뀐 것**이다. 전수로 다시 재야 한다.
   * 한 갈래로 뭉개면 「공유 DB 가 한 행 고쳤다」와 「지면 CSS 가 바뀌었다」가 같아 보인다.
   */
  const expected: Measured[] = [];
  const unexpected: string[] = [];
  let maxDelta = 0;
  for (const m of fresh) {
    const old = cachedById.get(m.pid)!;
    const delta = Math.abs(m.neededPx - old.neededPx);
    if (delta <= 0.01 && m.availPx === old.availPx) continue;
    if (mustCheck.has(m.pid)) {
      expected.push(m);
      continue;
    }
    maxDelta = Math.max(maxDelta, delta);
    unexpected.push(
      `${m.pid} 캐시 ${old.neededPx.toFixed(2)}/${old.availPx} → 지금 ${m.neededPx.toFixed(2)}/${m.availPx}`,
    );
  }
  console.log(
    `본문이 그대로인데 다른 것 ${unexpected.length}건 (최대 차 ${maxDelta.toFixed(2)}px)` +
      ` · 본문이 바뀌어 다른 것 ${expected.length}건`,
  );
  for (const d of unexpected.slice(0, 10)) console.log(`  · ${d}`);
  if (unexpected.length > 0) {
    console.log("지면이 바뀌었다 — 지문을 찍지 않는다. 전수로 다시 재라.");
    process.exitCode = 1;
    return;
  }

  if (expected.length > 0) {
    if (!repair) {
      console.log(
        `본문이 바뀐 ${expected.length}건이 캐시와 다르다. --repair 를 붙이면 그 자리만 깁는다.`,
      );
      process.exitCode = 1;
      return;
    }
    for (const m of expected) Object.assign(cachedById.get(m.pid)!, m);
    writeFileSync(cachePath, JSON.stringify(cached), "utf8");
    console.log(`캐시를 ${expected.length}건 기웠다 → ${cachePath}`);
  }

  const manifest = writeHeightCacheManifest(
    cachePath,
    buildHeightCacheManifest({
      kind,
      rows: cached.length,
      rowsHash: measuredRowsHash(rows),
      slotPx: singleSlot(fresh),
      measuredAt: new Date().toISOString(),
      rowDigests: rowDigests(rows),
    }),
  );
  console.log(`캐시가 아직 맞다 — 지문을 찍었다.\n→ ${manifest}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
