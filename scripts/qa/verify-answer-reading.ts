/**
 * **정답 표기를 읽은 규칙을 «본문 밖 열쇠»로 검산한다** (읽기 전용).
 *
 *   npx tsx scripts/qa/verify-answer-reading.ts
 *   npx tsx scripts/qa/verify-answer-reading.ts --samples 8
 *
 * ## 왜 필요한가
 *
 * `answerChoiceRules.readAnswerRef` 는 「정답 `3` 은 보기 ③ 을 뜻한다」처럼 **표기를
 * 해석**한다. 그 해석이 맞다는 근거를 `content` 와 `answer` 안에서만 찾으면 동어반복이다
 * — 해석 규칙이 틀려도 같은 규칙으로 채점하면 늘 100% 가 나온다.
 *
 * 그래서 **다른 컬럼**을 쓴다: `solution`. 해설에 원문자가 **딱 하나** 있으면 그것이
 * 이 문항의 답 번호다. 본문·정답과 독립인 증거다(2026-08-18 «반증은 본문 밖에서»).
 *
 * ## 반드시 대조군을 같이 낸다
 *
 * 근거 `원문자`(정답이 그냥 `③`)는 해석이 아니라 **읽기**다. 이 무리에서 불일치가
 * 많이 나오면 증거원(해설) 자체를 못 믿는다는 뜻이므로, 다른 무리의 일치율도 무의미해진다.
 * 그래서 대조군을 먼저 찍는다 — 이게 없으면 이 검산은 자화자찬이다.
 */
import { PrismaClient } from "@prisma/client";

import {
  choiceLabels,
  circledValue,
  readAnswerRef,
  type AnswerBasis,
} from "./answerChoiceRules";

const prisma = new PrismaClient();

interface Row {
  id: string;
  content: string;
  answer: string;
  solution: string | null;
  school: string | null;
  questionNumber: number | null;
}

/** 해설이 «딱 한 번호»를 가리키면 그 번호, 아니면 0 (증거 없음). */
function soleCircledInSolution(solution: string | null): number {
  const seen = new Set<number>();
  for (const ch of solution ?? "") {
    const n = circledValue(ch);
    if (n > 0) seen.add(n);
  }
  return seen.size === 1 ? [...seen][0]! : 0;
}

interface Tally {
  total: number;
  withEvidence: number;
  agree: number;
  disagree: number;
  samples: string[];
}
const empty = (): Tally => ({
  total: 0,
  withEvidence: 0,
  agree: 0,
  disagree: 0,
  samples: [],
});

async function main(): Promise<void> {
  const flag = process.argv.indexOf("--samples");
  const nSamples = flag >= 0 ? Number(process.argv[flag + 1] ?? 5) : 0;

  const rows = (await prisma.$queryRawUnsafe(
    `SELECT id, content, answer, solution, school,
            question_number AS "questionNumber"
       FROM problem
      WHERE pool = 'shared' AND review_status = 'approved'
        AND direct_use_allowed = true AND answer <> '(정답 없음)'
      ORDER BY id`,
  )) as Row[];
  console.log(`분모: 출제 가능 풀 ${rows.length}건\n`);

  const byBasis = new Map<AnswerBasis, Tally>();
  for (const r of rows) {
    const labelled = choiceLabels(r.content ?? "");
    if (labelled === null || labelled.labels.length === 0) continue;
    const ref = readAnswerRef(r.answer ?? "", labelled.bodies, labelled.labels);

    const t = byBasis.get(ref.basis) ?? empty();
    t.total += 1;
    const evidence = soleCircledInSolution(r.solution);
    if (evidence > 0) {
      t.withEvidence += 1;
      // «모호» 는 규칙이 번호를 안 내므로 일치 여부를 물을 수 없다 —
      // 대신 해설이 답해 주는지만 센다(답해 주면 그 10건은 사람 없이 정해진다).
      if (ref.nums.length > 0) {
        if (ref.nums.includes(evidence)) t.agree += 1;
        else {
          t.disagree += 1;
          if (t.samples.length < 12)
            t.samples.push(
              `${r.id.slice(0, 8)} ${r.school ?? "?"} ${r.questionNumber ?? "?"}번 · 정답 ${JSON.stringify((r.answer ?? "").slice(0, 30))} → 규칙 ${JSON.stringify(ref.nums)} · 해설 ${evidence}`,
            );
        }
      }
    }
    byBasis.set(ref.basis, t);
  }

  const order: AnswerBasis[] = [
    "원문자",
    "번호.값",
    "값(번호)",
    "값일치",
    "맨숫자",
    "모호",
    "없음",
  ];
  console.log(
    `## 읽은 근거별 — 해설(다른 컬럼)과 대조\n\n` +
      `| 근거 | 건수 | 해설이 답해 줌 | 일치 | **불일치** |\n` +
      `| --- | ---: | ---: | ---: | ---: |`,
  );
  for (const basis of order) {
    const t = byBasis.get(basis);
    if (!t) continue;
    const control = basis === "원문자" ? " ← 대조군" : "";
    console.log(
      `| ${basis}${control} | ${t.total} | ${t.withEvidence} | ${t.agree} | ${t.disagree} |`,
    );
  }

  const control = byBasis.get("원문자");
  if (!control || control.withEvidence === 0)
    throw new Error(
      "대조군에 증거가 하나도 없다 — 이 검산은 아무것도 증명하지 못한다.",
    );
  const controlRate = control.agree / (control.agree + control.disagree);
  console.log(
    `\n대조군(«정답이 그냥 ③») 일치율 **${(controlRate * 100).toFixed(2)}%** ` +
      `(${control.agree}/${control.agree + control.disagree}).\n` +
      `이 값이 낮으면 증거원(해설)을 못 믿는다는 뜻이고, 아래 무리의 성적도 함께 무의미해진다.`,
  );

  const ambiguous = byBasis.get("모호");
  if (ambiguous)
    console.log(
      `\n«모호» ${ambiguous.total}건 중 해설이 답해 주는 것 **${ambiguous.withEvidence}건** — ` +
        `나머지는 이 경로로는 못 정한다(사람이 봐야 한다).`,
    );

  if (nSamples > 0) {
    console.log(`\n## 불일치 표본`);
    for (const basis of order) {
      const t = byBasis.get(basis);
      if (!t || t.samples.length === 0) continue;
      console.log(`\n### ${basis}`);
      for (const s of t.samples.slice(0, nSamples)) console.log(`  ${s}`);
    }
  }

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
