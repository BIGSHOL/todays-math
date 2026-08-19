/**
 * RPM 문항의 **본문이 얼마나 깨져 있나**를 갈래별로 센다.
 *
 *   npx tsx scripts/qa/census-rpm-damage.ts            # 집계
 *   npx tsx scripts/qa/census-rpm-damage.ts --list 6   # 갈래마다 표본
 *   npx tsx scripts/qa/census-rpm-damage.ts --emit     # `rpm-damage-census.json`
 *
 * ## 왜 갈래를 나누나 — □ 가 다 결함이 아니다
 *
 * `\square ABCD` 는 **사각형 ABCD** 다. 정상 표기다. 실측으로 발문의 □ 233행 중
 * **164행이 이것**이었다 — 「□ 233행이 깨졌다」는 숫자는 그대로 쓰면 틀린다.
 * 반대로 □ 가 하나도 없어도 깨진 것이 있다: `\surd` 가 근호 뒤 숫자와 떨어져
 * 흩어진 자리(`$25cm^{2}\surd \surd \surd$`), 명령이 아닌 맨 글자가 남은 자리.
 *
 * 그래서 **무엇이 결함인지 미리 정하지 않고** 갈래를 나눠 센다. 고칠 대상을
 * 고를 때 이 표가 분모가 된다.
 */
import { writeFileSync } from "node:fs";

import { PrismaClient } from "@prisma/client";

import { renderMathHtml } from "../../src/lib/math/renderMathHtml";
import { preprocessMathText } from "../../src/lib/math/textPreprocess";

const OUT = "scripts/qa/reports/rpm-damage-census.json";
const FIELDS = ["content", "answer", "solution"] as const;

/** `\square` 가 **사각형 기호**로 쓰인 자리 — 뒤에 꼭짓점 이름이 온다. */
const QUAD = /\\square\s*(?=[A-Z]{3,4}(?![A-Za-z]))/gu;
const SQUARE = /\\square/gu;
/** 근호가 **혼자 남은** 자리. 뒤에 피연산자가 없다. */
const LONE_SURD = /\\surd(?!\s*\{)(?![\s$]*[0-9A-Za-z(])/gu;

interface Damage {
  kind: string;
  n: number;
}

function judge(text: string): Damage[] {
  const out: Damage[] = [];
  const sq = (text.match(SQUARE) ?? []).length;
  const quad = (text.match(QUAD) ?? []).length;
  if (sq > quad) out.push({ kind: "□ 로 무너진 자리", n: sq - quad });
  const surd = (text.match(LONE_SURD) ?? []).length;
  if (surd) out.push({ kind: "근호가 혼자 남은 자리", n: surd });
  const html = renderMathHtml(text);
  if (html.includes("math-raw"))
    out.push({ kind: "화면에서 물러선 자리", n: 1 });
  if (/#cc0000/iu.test(html)) out.push({ kind: "붉은 글씨", n: 1 });
  const outside = preprocessMathText(text).replace(
    /\$\$[\s\S]*?\$\$|\$[^$\r\n]*?\$/gu,
    "",
  );
  if (/\\(?:[A-Za-z]+|[{},.;:!%#$&_ |\\])/u.test(outside))
    out.push({ kind: "수식 밖에 명령이 남은 자리", n: 1 });
  return out;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const listAt = args.indexOf("--list");
  const list = listAt >= 0 ? Number(args[listAt + 1] ?? 4) : 0;
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.problem.findMany({
      where: { source: "transformed" },
      select: { id: true, content: true, answer: true, solution: true },
    });
    const tally = new Map<string, number>();
    const rowsHit = new Map<string, Set<string>>();
    const samples = new Map<string, Array<{ id: string; text: string }>>();
    for (const r of rows) {
      for (const f of FIELDS) {
        const text = (r[f] ?? "") as string;
        if (!text.trim()) continue;
        for (const d of judge(text)) {
          const key = `${f}: ${d.kind}`;
          tally.set(key, (tally.get(key) ?? 0) + d.n);
          if (!rowsHit.has(key)) rowsHit.set(key, new Set());
          rowsHit.get(key)!.add(r.id);
          const s = samples.get(key) ?? [];
          if (s.length < 8) s.push({ id: r.id, text });
          samples.set(key, s);
        }
      }
    }
    console.log(`RPM 문항 ${rows.length}행\n`);
    console.log("갈래                                     행    자리");
    const ordered = [...rowsHit].sort((a, b) => b[1].size - a[1].size);
    for (const [k, ids] of ordered)
      console.log(
        `  ${k.padEnd(38)} ${String(ids.size).padStart(5)} ${String(tally.get(k)).padStart(7)}`,
      );
    for (const [k] of ordered) {
      if (!list) break;
      console.log(`\n── ${k}`);
      for (const s of (samples.get(k) ?? []).slice(0, list))
        console.log(`   ${s.text.replace(/\s+/g, " ").slice(0, 150)}`);
    }
    if (args.includes("--emit")) {
      writeFileSync(
        OUT,
        JSON.stringify(
          {
            전체: rows.length,
            갈래: ordered.map(([k, ids]) => ({
              갈래: k,
              행: ids.size,
              자리: tally.get(k),
              id: [...ids],
            })),
            // 고치는 쪽이 «지금 값」을 다시 읽지 않아도 되게 같이 넣는다.
            지금: Object.fromEntries(
              rows
                .filter((r) => [...rowsHit.values()].some((s) => s.has(r.id)))
                .map((r) => [
                  r.id,
                  {
                    content: r.content,
                    answer: r.answer,
                    solution: r.solution,
                  },
                ]),
            ),
          },
          null,
          1,
        ),
        "utf8",
      );
      console.log(`\n→ ${OUT}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main();
