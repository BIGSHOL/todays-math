/**
 * 「나열식 대상」 상자 실태 조사 (읽기 전용).
 *
 * 원장님(2026-08-18): "이런 문제의 경우 다음 작은 수를 네모 박스 안에 넣으면 더
 * 깔끔할텐데 … 박스를 가운데 정렬하면 문제가 더 깔끔해 보일듯."
 * 스크린샷: `다음을 작은 수부터 차례대로 나열한 것은?` 다음에
 * `-(-1/2), (-1/2)², 1, -1/2` 가 마커 없이 그냥 흐른다.
 *
 * 정본 `F:\시험지변환기` 를 봤지만 **거기에도 이 규칙은 없다** — `content_parser.py`
 * 의 박스 판정도 우리와 같은 **마커 기반**(`<보기>`/`<조건>`/`<상자>`)이고,
 * 발문 뒤 마커 없는 나열을 상자로 올리는 코드는 없다. 벤치마킹할 규칙이 없으니
 * 데이터에서 신호를 찾아야 한다.
 *
 *   npx tsx scripts/qa/measure-enumeration-box.ts
 *   npx tsx scripts/qa/measure-enumeration-box.ts --samples
 */
import { PrismaClient } from "@prisma/client";

import { parseProblemContent } from "../../src/lib/problem/parseProblemContent";

const prisma = new PrismaClient();

/** 발문이 「뒤에 나열이 온다」고 말하는 문구. */
const TRIGGER_RE =
  /나열한\s*것은|나열하시오|나열하면|차례대로|작은\s*(?:수|것)부터|큰\s*(?:수|것)부터|크기순|대소\s*관계/;

/** 마커 없는 수식 나열 — `$…$`,`$…$`,`$…$` 가 잇따른다. */
const MATH_LIST_RE = /(?:\$[^$\n]+\$\s*,\s*){2,}\$[^$\n]+\$/;
/** 한 수식 안에 쉼표로 늘어선 나열 — `$a,~b,~c,~d$`. */
const INLINE_LIST_RE = /\$[^$\n]*?(?:,[^$\n,]+){3,}[^$\n]*\$/;

async function main() {
  const wantSamples = process.argv.includes("--samples");
  const total = await prisma.problem.count();

  let triggered = 0;
  let alreadyBoxed = 0;
  let listAfter = 0;
  let listInsideQuestion = 0;
  const samples: Array<{ id: string; where: string; text: string }> = [];

  const PAGE = 2000;
  for (let skip = 0; skip < total; skip += PAGE) {
    const rows = await prisma.problem.findMany({
      select: { id: true, content: true },
      orderBy: { id: "asc" },
      skip,
      take: PAGE,
    });
    if (!rows.length) break;

    for (const row of rows) {
      const { question } = parseProblemContent(row.content ?? "");
      if (!TRIGGER_RE.test(question)) continue;
      triggered += 1;
      if (question.split(/\r?\n/).some((l) => l.trimStart().startsWith(">"))) {
        alreadyBoxed += 1;
        continue;
      }

      // 발문 종결(물음표) **뒤**에 나열이 오는가 — 그것만이 «상자 대상»이다.
      const q = question.search(/[?？]/);
      const tail = q >= 0 ? question.slice(q + 1) : "";
      const head = q >= 0 ? question.slice(0, q) : question;

      if (MATH_LIST_RE.test(tail) || INLINE_LIST_RE.test(tail)) {
        listAfter += 1;
        if (samples.length < 14)
          samples.push({ id: row.id, where: "발문 뒤", text: question });
      } else if (MATH_LIST_RE.test(head) || INLINE_LIST_RE.test(head)) {
        // 발문 **안**에 나열이 박혀 있으면 상자로 뺄 수 없다 — 문장이 끊긴다.
        listInsideQuestion += 1;
        if (samples.length < 14)
          samples.push({ id: row.id, where: "발문 안", text: question });
      }
    }
  }

  console.log(`문항 ${total.toLocaleString()}건 — 전수\n`);
  console.log(
    `발문이 「나열」류를 말하는 문항: ${triggered}건 (${((triggered * 100) / total).toFixed(2)}%)`,
  );
  console.log(`  이미 상자로 그려짐: ${alreadyBoxed}건`);
  console.log(`  **발문 뒤**에 나열이 오는 문항: ${listAfter}건 (상자 후보)`);
  console.log(
    `  발문 **안**에 나열이 박힌 문항: ${listInsideQuestion}건 (상자로 못 뺀다)`,
  );

  if (wantSamples) {
    console.log("\n\n표본 — 규칙은 눈으로 봐야 틀린 게 보인다");
    for (const s of samples)
      console.log(
        `\n· ${s.id.slice(0, 8)} [${s.where}]\n    ${s.text.slice(0, 260).replace(/\n/g, " ⏎ ")}`,
      );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
