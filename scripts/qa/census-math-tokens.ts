/**
 * 지면에 **날 글자로 나가는 수식**을 전수로 센다 — 화면과 같은 방식으로 그려서.
 *
 *   npx tsx scripts/qa/census-math-tokens.ts                 # 전수 · 요약
 *   npx tsx scripts/qa/census-math-tokens.ts --samples       # 표본까지
 *   npx tsx scripts/qa/census-math-tokens.ts --field=answer  # content|answer|solution
 *   npx tsx scripts/qa/census-math-tokens.ts --json=out.json
 *
 * ## 이 계량기가 앞선 것들과 다른 점
 *
 * 1. **화면 파이프라인을 그대로 태운다.** `decodeHtmlEntities → preprocessMathText
 *    → tokenizeMath → (rehype-katex 와 같은 순서로) 렌더`. 기존
 *    `measure-katex-unknown.ts` 는 **DB 원문**을 우리 QA 옵션(`trust` 허용)으로
 *    그려서, 우리 전처리가 스스로 만들어 넣는 `\htmlClass` 붉은 글씨를 못 봤다.
 * 2. **어휘를 손으로 만들지 않는다.** `bareRuns` 가 수식 안 영문 덩어리를 전부
 *    세고, 정본 어휘(`hwpVocab`)로 «정본이 아는 것 / 모르는 것» 을 가른다.
 *    모르는 것이 곧 **아무도 목록에 안 적은 잔재**다 — `le`·`ge` 가 그렇게 나왔다.
 * 3. **붉은 명령을 보이는 조각에서만 귀속시킨다.** MathML 주석에서 뽑으면
 *    무고한 `\displaystyle` 이 1위가 된다(1차 측정의 실제 오류).
 */
import { writeFileSync } from "node:fs";

import { PrismaClient } from "@prisma/client";

import { tokenizeMath } from "../../src/lib/math/segments";
import {
  decodeHtmlEntities,
  preprocessMathText,
} from "../../src/lib/math/textPreprocess";
import { blockingKeyword, isCanonicalHwpToken } from "./hwpVocab";
import { bareRuns, redCommands } from "./mathTokenCensus";

const prisma = new PrismaClient();

type Field = "content" | "answer" | "solution";

interface Bucket {
  count: number;
  rows: Set<string>;
  samples: string[];
}

function bump(
  map: Map<string, Bucket>,
  key: string,
  id: string,
  sample: string,
) {
  let b = map.get(key);
  if (!b) {
    b = { count: 0, rows: new Set(), samples: [] };
    map.set(key, b);
  }
  b.count += 1;
  b.rows.add(id);
  if (b.samples.length < 5) b.samples.push(`${id.slice(0, 8)}  ${sample}`);
}

const table = (map: Map<string, Bucket>, limit: number) =>
  [...map.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, limit)
    .map(([key, b]) => ({
      key,
      count: b.count,
      rows: b.rows.size,
      samples: b.samples,
    }));

async function main() {
  const argv = process.argv.slice(2);
  const wantSamples = argv.includes("--samples");
  const field = (argv.find((a) => a.startsWith("--field="))?.slice(8) ??
    "content") as Field;
  const jsonOut = argv.find((a) => a.startsWith("--json="))?.slice(7);
  const limit = Number(
    argv.find((a) => a.startsWith("--limit="))?.slice(8) ?? "60",
  );

  const total = await prisma.problem.count();
  console.log(
    `문항 ${total.toLocaleString()}건 · 대상 컬럼 ${field} — 전수 렌더\n`,
  );

  const red = new Map<string, Bucket>();
  const unknownRun = new Map<string, Bucket>();
  const canonRun = new Map<string, Bucket>();
  const labelRun = new Map<string, Bucket>();

  let spans = 0;
  let redSpans = 0;
  let redRows = 0;
  let residueRows = 0;
  let scanned = 0;
  let preprocessFailures = 0;

  const PAGE = 2000;
  for (let skip = 0; skip < total; skip += PAGE) {
    const rows = await prisma.problem.findMany({
      select: { id: true, content: true, answer: true, solution: true },
      orderBy: { id: "asc" },
      skip,
      take: PAGE,
    });
    if (rows.length === 0) break;

    for (const row of rows) {
      scanned += 1;
      const raw = (row[field] ?? "") as string;
      if (!raw) continue;
      let pre: string;
      try {
        pre = preprocessMathText(decodeHtmlEntities(raw));
      } catch {
        // 전처리가 던지면 화면도 그 행을 못 그린다 — 침묵시키지 않고 센다.
        preprocessFailures += 1;
        continue;
      }

      let rowRed = false;
      let rowResidue = false;
      for (const seg of tokenizeMath(pre)) {
        if (seg.type === "text") continue;
        spans += 1;
        const expr = seg.value.trim();
        const cut = expr.slice(0, 130);

        const commands = redCommands(expr, seg.type === "display");
        // span 은 한 번만 센다 — 한 span 안에 붉은 명령이 여럿이어도 span 하나다.
        if (commands.length > 0) {
          redSpans += 1;
          rowRed = true;
          for (const command of commands) bump(red, command, row.id, cut);
        }

        for (const { run, inLabelCommand } of bareRuns(expr)) {
          if (inLabelCommand) {
            bump(labelRun, run, row.id, cut);
            continue;
          }
          if (isCanonicalHwpToken(run)) {
            bump(canonRun, run, row.id, cut);
            rowResidue = true;
            continue;
          }
          bump(unknownRun, run, row.id, cut);
        }
      }
      if (rowRed) redRows += 1;
      if (rowResidue) residueRows += 1;
    }
    if (skip % 10000 === 0 && skip > 0)
      console.log(`  … ${skip.toLocaleString()}건`);
  }

  const pct = (n: number, d: number) => ((n * 100) / Math.max(1, d)).toFixed(2);

  console.log(
    `\n스캔 ${scanned.toLocaleString()}건 · 수식 span ${spans.toLocaleString()}`,
  );
  if (preprocessFailures)
    console.log(`⚠️ 전처리 예외 ${preprocessFailures}건 — 화면도 못 그린다`);
  console.log(
    `붉게 나가는 문항 ${redRows.toLocaleString()} (${pct(redRows, scanned)}%)` +
      ` · 붉은 span ${redSpans.toLocaleString()} (${pct(redSpans, spans)}%)`,
  );
  console.log(
    `정본 키워드가 맨 글자로 남은 문항 ${residueRows.toLocaleString()} (${pct(residueRows, scanned)}%)`,
  );

  const dump = (title: string, map: Map<string, Bucket>, n: number) => {
    console.log(`\n── ${title} (상위 ${n}) ──`);
    for (const r of table(map, n)) {
      console.log(
        `  ${r.key.padEnd(22)} ${String(r.count).padStart(6)}  행 ${r.rows}`,
      );
      if (wantSamples) for (const s of r.samples) console.log(`        ${s}`);
    }
  };

  dump("붉은 명령 — KaTeX 가 못 그린다", red, limit);
  dump(
    "정본 HWP 키워드가 맨 글자로 남음 — 조용히 틀리게 그려진다",
    canonRun,
    limit,
  );
  dump(
    "정본에 **없는** 맨 덩어리 — 여기서 새 잔재가 나온다",
    unknownRun,
    limit,
  );
  dump("라벨 명령 안 (참고 — 잔재 아님)", labelRun, 15);

  // `le`/`ge` 후보는 **전량**을 낸다. 표본이 아니라 전량이라야 눈으로 다 볼 수 있다.
  const LEGE = /^(?:[A-Za-z]{0,2}(?:le|ge))+[A-Za-z]{0,2}$/;
  const legeAll = [...unknownRun.entries()]
    .filter(([run]) => LEGE.test(run))
    .sort((a, b) => b[1].count - a[1].count);
  const blocked = [...unknownRun.entries()]
    .filter(([run]) => /le|ge/.test(run) && !LEGE.test(run))
    .sort((a, b) => b[1].count - a[1].count);

  console.log(
    `\n── \`le\`/\`ge\` 분해가 되는 덩어리 **전량** (${legeAll.length}종) ──`,
  );
  for (const [run, b] of legeAll) {
    const block = blockingKeyword(run);
    console.log(
      `  ${run.padEnd(20)} ${String(b.count).padStart(5)}  행 ${b.rows.size}` +
        (block ? `   ⛔ ${block}` : ""),
    );
  }
  console.log(
    `\n── \`le\`/\`ge\` 를 품었지만 분해 실패 — 손대지 않는다 (${blocked.length}종) ──`,
  );
  for (const [run, b] of blocked.slice(0, 40)) {
    console.log(
      `  ${run.padEnd(20)} ${String(b.count).padStart(5)}  행 ${b.rows.size}`,
    );
  }

  if (jsonOut) {
    writeFileSync(
      jsonOut,
      JSON.stringify(
        {
          field,
          scanned,
          spans,
          redRows,
          redSpans,
          residueRows,
          preprocessFailures,
          red: table(red, 9999),
          canonicalResidue: table(canonRun, 9999),
          unknownRuns: table(unknownRun, 9999),
          legeCandidates: legeAll.map(([run, b]) => ({
            run,
            count: b.count,
            rows: b.rows.size,
            blockedBy: blockingKeyword(run),
            samples: b.samples,
          })),
        },
        null,
        2,
      ),
      "utf-8",
    );
    console.log(`\nJSON → ${jsonOut}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
