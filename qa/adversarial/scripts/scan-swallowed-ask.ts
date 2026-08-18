/**
 * 적대적 리뷰 — **발문이 상자 안으로 들어갔는가**를 목록에 기대지 않고 센다. 읽기 전용.
 *
 * 기존 감사(`audit-box-boundary.ts`)의 「발문 삼킴」 신호는 **물음표 하나**다.
 * 이 말뭉치의 서술형 문항은 물음표로 끝나지 않는다(`…구하시오.`) — 그래서 그 지표는
 * 서술형 삼킴을 **구조적으로 0으로 센다**.
 *
 * 여기서는 열쇠를 바꾼다: 「상자 **밖**에 발문이 하나도 없다」.
 * 문항은 무엇이든 묻는다. 상자 밖에 묻는 문장이 없으면 그 문항의 발문은
 * 상자가 삼킨 것이다. 목록(`시오`·`?`)은 **상자 밖**을 볼 때만 쓰므로,
 * 상자 안에 무엇이 들어갔는지 미리 알 필요가 없다.
 *
 * 옛 코드(`qa/adversarial/baseline`, main 5c0b1400)와 **나란히** 재서 이번 수리가
 * 이 부류를 줄였는지 늘렸는지 본다.
 *
 * 실행: npx tsx qa/adversarial/scripts/scan-swallowed-ask.ts [--samples] [--new-only]
 */
import { PrismaClient } from "@prisma/client";

import { parseProblemContent as parseNew } from "../../../src/lib/problem/parseProblemContent";
import { parseProblemContent as parseOld } from "../baseline/problem/parseProblemContent";

const prisma = new PrismaClient();

/** 묻는 문장의 끝. 상자 **밖**에만 쓴다. */
const ASK_RE =
  /[?？]|(?:구하시오|구하여라|구하라|나타내시오|나타내어라|서술하시오|설명하시오|답하시오|답하여라|쓰시오|써라|보이시오|하여라|고르시오|구할\s*수|얼마인가|무엇인가)/;

interface Split {
  /** 상자 밖 평문. */
  outside: string;
  /** 상자 안(라벨 줄 제외). */
  inside: string;
  boxes: number;
}

function splitQuestion(question: string): Split {
  const outside: string[] = [];
  const inside: string[] = [];
  let boxes = 0;
  let inBox = false;
  for (const rawLine of question.split(/\r?\n/)) {
    const line = rawLine.trimStart();
    if (line.startsWith(">")) {
      if (!inBox) {
        boxes += 1;
        inBox = true;
      }
      inside.push(line.replace(/^>\s?/, ""));
      continue;
    }
    inBox = false;
    outside.push(line);
  }
  return { outside: outside.join("\n"), inside: inside.join("\n"), boxes };
}

/** 상자가 발문을 삼켰는가 — 상자 밖엔 없고 상자 안엔 있다. */
function swallowed(question: string): boolean {
  const { outside, inside, boxes } = splitQuestion(question);
  if (boxes === 0) return false;
  return !ASK_RE.test(outside) && ASK_RE.test(inside);
}

async function main() {
  const wantSamples = process.argv.includes("--samples");
  const newOnly = process.argv.includes("--new-only");
  const total = await prisma.problem.count();

  let oldBoxProblems = 0;
  let newBoxProblems = 0;
  let oldSwallow = 0;
  let newSwallow = 0;
  let regressed = 0; // 옛 코드는 안 삼켰는데 새 코드가 삼킨 것
  let fixed = 0;
  const samples: Array<{ id: string; kind: string; q: string }> = [];

  const PAGE = 2000;
  for (let skip = 0; skip < total; skip += PAGE) {
    const rows = await prisma.problem.findMany({
      select: { id: true, content: true },
      orderBy: { id: "asc" },
      skip,
      take: PAGE,
    });
    if (rows.length === 0) break;
    for (const row of rows) {
      const content = row.content ?? "";
      const oldQ = parseOld(content).question;
      const newQ = parseNew(content).question;
      if (splitQuestion(oldQ).boxes > 0) oldBoxProblems += 1;
      if (splitQuestion(newQ).boxes > 0) newBoxProblems += 1;
      const a = swallowed(oldQ);
      const b = swallowed(newQ);
      if (a) oldSwallow += 1;
      if (b) newSwallow += 1;
      if (!a && b) {
        regressed += 1;
        if (samples.length < 30)
          samples.push({ id: row.id, kind: "회귀", q: newQ });
      }
      if (a && !b) fixed += 1;
      if (newOnly && b && samples.length < 60)
        samples.push({ id: row.id, kind: "지금 삼킴", q: newQ });
    }
  }

  console.log(`전수 ${total}문항`);
  console.log(
    `상자를 그린 문항   옛 ${oldBoxProblems} → 지금 ${newBoxProblems}`,
  );
  console.log(`발문을 삼킨 문항   옛 ${oldSwallow} → 지금 ${newSwallow}`);
  console.log(`  새로 삼킨 것(회귀) ${regressed} · 고쳐진 것 ${fixed}`);

  if (wantSamples)
    for (const s of samples) {
      console.log(`\n--- [${s.kind}] ${s.id}`);
      console.log(s.q.slice(0, 900));
    }
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
