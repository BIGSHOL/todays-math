/**
 * 높이 모형이 **어디서** 틀리는가 — 오차를 부류별로 센다 (읽기 전용).
 *
 * 왜 따로 있나: `eval-overflow-rules.ts` 는 「20px 넘게 과소 17.9%」라는 **한 숫자**만
 * 낸다. 그 숫자는 «무엇을 고쳐야 하는가»를 한 글자도 말해 주지 않는다.
 * 실제로 그 17.9% 의 **97.4%가 «세로로 쌓이는 수식»이 있는 문항**이었고, 그건
 * 해설 자에는 있는데 문제지 자에는 없던 항이었다(적대적 리뷰 ④ A).
 *
 *   npx tsx scripts/qa/analyze-height-error.ts
 *   npx tsx scripts/qa/analyze-height-error.ts --first-page
 *   npx tsx scripts/qa/analyze-height-error.ts --show 6      # 표본을 눈으로 본다
 *
 * ⚠️ **표본을 눈으로 보라.** 이 저장소가 2026-08-16~18 에 찾은 결함은 전부 눈으로
 *    봐서 찾았다(CLAUDE.md). `--show` 는 그러라고 있다.
 */
import { readFileSync } from "node:fs";

import { PrismaClient } from "@prisma/client";

import { parseProblemContent } from "../../src/lib/problem/parseProblemContent";
import {
  estimateProblemPx,
  parseFigureDimensions,
} from "../../src/lib/printOverflow";

const prisma = new PrismaClient();

/**
 * 세로로 자리를 더 먹는 수식. `printOverflow.ts` 의 `TALL_MATH_RE` 와 **같은 목록**을
 * 손으로 두 번 적지 않으려면 언젠가 합쳐야 하지만, 여기서는 «목록을 넓혀 보는» 것이
 * 일이라 일부러 조금 더 넓게 센다(`overline`·`underline` 포함).
 */
const TALL =
  /\\(?:d?frac|sum|int|prod|lim|binom|begin\{[a-z]*matrix\}|begin\{cases\}|begin\{array\}|sqrt\[|overline|underline)/g;

interface Height {
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
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const firstPage = process.argv.includes("--first-page");
  const heightsPath =
    arg("--heights") ??
    (firstPage ? ".measure/first.json" : ".measure/cont.json");
  const show = Number(arg("--show") ?? 0);

  const heights = JSON.parse(readFileSync(heightsPath, "utf8")) as Height[];
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT id, content, figure_urls AS "figureUrls", figure_dims AS "figureDims"
       FROM problem ORDER BY id`,
  )) as Row[];
  const byId = new Map(rows.map((r) => [r.id, r]));

  const recs = heights.map((h) => {
    const row = byId.get(h.pid)!;
    const content = row.content ?? "";
    const dims = parseFigureDimensions(
      row.figureUrls.length,
      row.figureDims ?? undefined,
    );
    const { choices } = parseProblemContent(content);
    return {
      pid: h.pid,
      err: estimateProblemPx(content, dims) - h.neededPx,
      needed: h.neededPx,
      tall: content.match(TALL)?.length ?? 0,
      figures: row.figureUrls.length,
      figureReal: h.figurePx,
      choiceReal: h.choicePx,
      boxReal: h.boxPx,
      choices: choices.length,
      content,
    };
  });

  const mean = (xs: number[]) =>
    xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  const under = recs.filter((r) => r.err < -20);
  const ok = recs.filter((r) => Math.abs(r.err) <= 20);
  console.log(
    `캐시 ${heightsPath} · ${recs.length.toLocaleString()}건\n` +
      `20px 넘게 **과소** ${under.length.toLocaleString()} (${((under.length * 100) / recs.length).toFixed(1)}%)` +
      ` · 20px 이내 ${((ok.length * 100) / recs.length).toFixed(1)}%`,
  );

  console.log(
    `\n세로 수식이 하나라도 있는 비율 — 과소 ${((100 * under.filter((r) => r.tall > 0).length) / Math.max(1, under.length)).toFixed(1)}%` +
      ` · 오차 20px 이내 ${((100 * ok.filter((r) => r.tall > 0).length) / Math.max(1, ok.length)).toFixed(1)}%`,
  );

  console.log("\n세로 수식 개수별 — 평균 오차와 과소 비율");
  const buckets: Array<[number, number]> = [
    [0, 0],
    [1, 2],
    [3, 5],
    [6, 10],
    [11, Number.MAX_SAFE_INTEGER],
  ];
  for (const [lo, hi] of buckets) {
    const g = recs.filter((r) => r.tall >= lo && r.tall <= hi);
    const label = hi === Number.MAX_SAFE_INTEGER ? `${lo}~` : `${lo}~${hi}`;
    console.log(
      `  ${label.padEnd(6)} ${String(g.length).padStart(6)}건 · 평균 오차 ${mean(
        g.map((r) => r.err),
      )
        .toFixed(1)
        .padStart(7)}px` +
        ` · 20px 넘게 과소 ${((100 * g.filter((r) => r.err < -20).length) / Math.max(1, g.length)).toFixed(1)}%`,
    );
  }

  // 어디에서 어긋나는가 — 그림/보기/상자/본문
  const where = (r: (typeof recs)[number]) => {
    if (r.figures > 0 && Math.abs(r.figureReal) > 0 && r.tall === 0)
      return "그림";
    if (r.boxReal > 0) return "상자";
    if (r.choiceReal > 0) return "보기";
    return "본문만";
  };
  const counts = new Map<string, number>();
  for (const r of under) counts.set(where(r), (counts.get(where(r)) ?? 0) + 1);
  console.log(
    "\n과소인 문항이 무엇을 담고 있나 — " +
      [...counts]
        .sort((a, b) => b[1] - a[1])
        .map(
          ([k, v]) =>
            `${k} ${v} (${((v * 100) / Math.max(1, under.length)).toFixed(1)}%)`,
        )
        .join(" · "),
  );

  if (show > 0) {
    console.log("\n표본 — 가장 크게 과소인 순 (눈으로 볼 것)");
    for (const r of [...under].sort((a, b) => a.err - b.err).slice(0, show)) {
      console.log(
        `\n──── ${r.pid} 오차 ${r.err.toFixed(0)}px (실측 ${r.needed.toFixed(0)}px) · 세로수식 ${r.tall} · 보기 ${r.choices} · 그림 ${r.figures}`,
      );
      console.log(r.content.slice(0, 600).replace(/\n/g, "\n  | "));
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
