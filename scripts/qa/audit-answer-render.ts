/**
 * DB 정답이 **지면에 제대로 렌더되는지** 전수 검사한다 (트랙 B).
 *
 * 왜: 값이 맞아도 표기가 깨지면 학생은 답을 못 읽는다. 3자 대조를 하다가
 * DB 정답 54건이 HWP 원본과 **글자까지 같다**는 걸 확인했는데(HWP 는 독립 출처가
 * 아니라 DB 의 출처다), 그 원본 문자열이 한글 수식 스크립트 그대로였다 —
 * `$2 sqrt {6}$풀이)`, `$-3le x`, `1 over2`. KaTeX 는 이런 걸 못 읽는다.
 *
 * `renderMathHtml` 은 실패해도 붉은 글씨 대신 중립 `math-raw` 로 떨어뜨린다.
 * 그 폴백이 나오면 **지면에 원시 문자열이 그대로 인쇄된다는 뜻**이다.
 *
 *   npx tsx scripts/qa/audit-answer-render.ts
 *
 * **DB 를 건드리지 않는다.**
 */
import { mkdir, writeFile } from "node:fs/promises";

import { PrismaClient } from "@prisma/client";

import { renderMathHtml } from "../../src/lib/math/renderMathHtml";

const OUT = "scripts/qa/reports/answer-render-audit.json";

/** KaTeX 가 못 읽어 원시 문자열로 떨어진 흔적. */
function failedRender(html: string): boolean {
  return (
    html.includes("math-raw") ||
    html.includes("katex-error") ||
    /#cc0000/i.test(html)
  );
}

/**
 * 한글 수식 스크립트(HWP) 흔적.
 *
 * `over` `sqrt {` `LEFT (` `LEQ` 는 HWP 수식 편집기 문법이라 **역슬래시가 없다.**
 * 같은 낱말이라도 `BsqrtB{15B}` 는 멀쩡한 LaTeX 이므로 역슬래시가 붙은 것은 뺀다.
 * 수식 구간(`$...$`) 안만 본다 — 한글 문장에 우연히 섞인 낱말을 잡지 않기 위해서다.
 */
const HWP_TOKEN =
  /(?<!\\)\b(?:over|sqrt|LEFT|RIGHT|ANGLE|TIMES|LEQ|GEQ|rarrow|dyad|cdots|bar|it|rm)\b/;

function hasHwpScript(answer: string): boolean {
  const math = answer.match(/\$([^$]*)\$/g) ?? [];
  if (math.some((seg) => HWP_TOKEN.test(seg))) return true;
  // 여는 `$` 만 있고 닫히지 않은 것도 HWP 산출물이 잘린 흔적이다 (`$-3le x`).
  return (answer.match(/\$/g) ?? []).length % 2 === 1;
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.problem.findMany({
      select: { id: true, source: true, externalId: true, answer: true },
    });

    const buckets = new Map<string, typeof rows>();
    const push = (key: string, row: (typeof rows)[number]) => {
      if (!buckets.has(key)) buckets.set(key, []);
      (buckets.get(key) as typeof rows).push(row);
    };

    for (const row of rows) {
      const answer = row.answer ?? "";
      if (answer.trim() === "" || answer.includes("정답 없음")) continue;
      let html = "";
      try {
        html = renderMathHtml(answer);
      } catch {
        push("렌더예외", row);
        continue;
      }
      if (failedRender(html)) push("렌더실패", row);
      else if (hasHwpScript(answer)) push("HWP스크립트잔재", row);
      else if (/[-]/.test(answer)) push("PUA잔재", row);
    }

    console.log("── 정답 렌더 전수 검사 ──");
    console.log(`대상 ${rows.length}문항 (빈 정답·센티널 제외)`);
    let total = 0;
    for (const [key, list] of [...buckets].sort(
      (a, b) => b[1].length - a[1].length,
    )) {
      total += list.length;
      const bySource = new Map<string, number>();
      for (const r of list) bySource.set(r.source, (bySource.get(r.source) ?? 0) + 1);
      console.log(
        `  ${key.padEnd(14)} ${String(list.length).padStart(5)}  ${[...bySource].map(([s, n]) => `${s} ${n}`).join(" · ")}`,
      );
      for (const r of list.slice(0, 3)) {
        console.log(
          `      ${(r.externalId ?? r.id).slice(0, 12).padEnd(13)} ${JSON.stringify(r.answer).slice(0, 60)}`,
        );
      }
    }
    console.log(`\n지면에 깨져 나갈 정답 ${total}건`);

    await mkdir("scripts/qa/reports", { recursive: true });
    await writeFile(
      OUT,
      JSON.stringify(
        {
          total: rows.length,
          broken: total,
          buckets: Object.fromEntries(
            [...buckets].map(([k, v]) => [
              k,
              {
                count: v.length,
                items: v.map((r) => ({
                  id: r.id,
                  source: r.source,
                  externalId: r.externalId,
                  answer: r.answer,
                })),
              },
            ]),
          ),
        },
        null,
        1,
      ),
      "utf-8",
    );
    console.log(`→ ${OUT}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
