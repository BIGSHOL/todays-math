/**
 * **처리 방안마다 몇 건이 살아나는가** — 후보 수리를 지면 밖에서 흉내 내 값을 잰다.
 *
 *   npx tsx scripts/qa/simulate-choice-repairs.ts
 *   npx tsx scripts/qa/simulate-choice-repairs.ts --samples 5
 *
 * **제품 코드는 한 줄도 안 고친다.** 후보 규칙을 이 파일 안에서만 흉내 내고,
 * 같은 판정기(`answerChoiceRules.ts`)로 전후를 견준다.
 *
 * ## 후보 둘
 *
 *   R1 «지면이 원래 번호를 찍는다» — `ProblemContent.tsx` 의 `CHOICE_MARKS[index]` 를
 *      파서가 읽은 **원래 번호**로 바꾼다. 판정기가 이미 `fixedByLabelRendering` 로 센다.
 *   R2 «줄 중간 마커를 보기 경계로 본다» — 원본 지면이 보기를 두 열로 앉히면 추출이
 *      `① 가 ② 나` 처럼 한 줄에 붙여 놓는다. 제품 파서는 `\n` 뒤의 마커만 본다.
 *
 * ## R2 를 좁게 잡은 이유 — 반대쪽이 깨지면 안 된다
 *
 * 「원문자가 나오면 자른다」로 하면 `∠A ① …` 같은 본문이 잘린다. 그래서
 * **바로 앞 마커의 다음 번호일 때만** 자른다. 그리고 이 자는 **성한 44,099건에
 * 같은 규칙을 대서 판정이 바뀌는지** 반드시 센다 — 그게 0이 아니면 규칙이 과한 것이다.
 * (2026-08-18 «반대쪽 모집단에 대 봐라»)
 */
import { PrismaClient } from "@prisma/client";

import { isFatal, judgeAnswerChoice } from "./answerChoiceRules";

const prisma = new PrismaClient();

interface Row {
  id: string;
  content: string;
  answer: string;
  figureUrls: string[];
  school: string | null;
  questionNumber: number | null;
  questionType: string | null;
}

const CIRCLED_1_15 = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮";

/**
 * R2 — 「바로 앞 마커의 **다음 번호**가 줄 중간에 있으면」 그 앞에서 줄을 나눈다.
 *
 * ⚠️ **줄 중간에서는 원문자(`①`)만 본다.** 처음에는 `N.`·`N)` 도 함께 봤는데,
 * 성한 문항 **3건이 깨졌다** — `-4.5` 의 `4.` 와 `(1,~-2)` 의 `2)` 가 마커로 잡혀
 * 보기가 쪼개졌다(성명여중 11 · 경상여고 1 · 동원중 15). 소수점과 좌표는 이 축에서
 * 마커와 **겹친다.** 겹치는 축에 문턱을 놓으면 어느 쪽으로 옮겨도 한쪽이 틀리므로
 * (2026-08-18 «문턱이 아니라 축이 틀린 것이다») 열쇠를 **글자 모양**으로 바꿨다.
 * 줄머리 마커는 종전대로 둘 다 본다 — 거기서는 겹치지 않는다.
 */
export function splitInlineChoiceMarkers(raw: string): string {
  const text = (raw ?? "").replace(/\r\n?/g, "\n");
  let out = "";
  let rest = text;
  let expected = 0; // 다음에 올 보기 번호. 0 이면 아직 첫 마커를 못 봤다.
  const MARKER = new RegExp(`(\\n[ \\t]*)?([${CIRCLED_1_15}]|[1-9][0-9]?[.)])`);
  for (;;) {
    const m = MARKER.exec(rest);
    if (!m) break;
    const atLineStart = m[1] !== undefined;
    const token = m[2]!;
    const circled = CIRCLED_1_15.indexOf(token[0]!);
    const num = circled >= 0 ? circled + 1 : Number(/^(\d+)/.exec(token)![1]);
    const end = m.index + m[0].length;

    if (atLineStart) {
      expected = num + 1;
      out += rest.slice(0, end);
    } else if (circled >= 0 && (num === expected || num === 1)) {
      // 줄 중간인데 **원문자**이고 «다음 번호»다 → 경계로 본다.
      // `expected === 0 && num === 1` 은 **줄머리 마커가 하나도 없는** 문항의 시작이다
      // (보기 다섯이 통째로 한 줄에 붙은 부류). 이걸 안 두면 그 부류가 통째로 안 잡힌다.
      out += `${rest.slice(0, m.index)}\n${token} `;
      expected = num + 1;
    } else {
      out += rest.slice(0, end);
    }
    rest = rest.slice(end);
  }
  return out + rest;
}

async function main(): Promise<void> {
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT id, content, answer, figure_urls AS "figureUrls", school,
            question_number AS "questionNumber", question_type AS "questionType"
       FROM problem
      WHERE pool = 'shared' AND review_status = 'approved'
        AND direct_use_allowed = true AND answer <> '(정답 없음)'
      ORDER BY id`,
  )) as Row[];
  console.log(`분모: 출제 가능 풀 ${rows.length}건\n`);

  const before = rows.map((r) => ({ row: r, j: judgeAnswerChoice(r) }));
  const fatalBefore = before.filter((x) => isFatal(x.j.verdict));

  /* ── R1 ─────────────────────────────────────────────────────────────── */
  const r1 = fatalBefore.filter((x) => x.j.fixedByLabelRendering);

  /* ── R2 ─────────────────────────────────────────────────────────────── */
  const guarded = process.argv.includes("--no-guard") ? false : true;
  const after = before.map((x) => {
    const split = judgeAnswerChoice({
      content: splitInlineChoiceMarkers(x.row.content),
      answer: x.row.answer,
      figureUrls: x.row.figureUrls,
    });
    // ── 가드(기본 켬): 다시 자른 결과가 **1..n 으로 온전해지고 n 이 4 이상일 때만**
    //    받아들인다. 정답을 안 보는 판단이라 제품 파서가 그대로 쓸 수 있다(--no-guard 로 끔).
    //
    //    ⚠️ `n >= 4` 를 나중에 더했다. 「1..n 이면 받는다」만으로는 **서술형 3건이
    //    가짜 객관식이 됐다** — 발문 속 「두 직선 ①, ②를」 의 참조가 보기로 잘렸다
    //    (학산중 22 · 강동중 18 · 다사중 21). 경계는 문턱이 아니라 **분포**에서 왔다:
    //    보기가 있는 문항의 99% 가 정확히 5칸이다(`report-unusable-problems.ts` 참조).
    const CHOICE_BLOCK_MIN = 4;
    const wasClean =
      x.j.labels.length >= 2 && x.j.labels.every((l, i) => l === i + 1);
    const nowClean =
      split.labels.length >= CHOICE_BLOCK_MIN &&
      split.labels.every((l, i) => l === i + 1);
    const accept = guarded ? nowClean && !wasClean : true;
    return { ...x, j2: accept ? split : x.j };
  });
  const r2 = after.filter(
    (x) => isFatal(x.j.verdict) && !isFatal(x.j2.verdict),
  );
  const r1r2 = after.filter(
    (x) =>
      isFatal(x.j.verdict) &&
      !(isFatal(x.j2.verdict) && !x.j2.fixedByLabelRendering),
  );

  /* ── 반대쪽 — 성한 문항이 깨지는가 ──────────────────────────────────── */
  const healthy = after.filter((x) => !isFatal(x.j.verdict));
  const brokenByR2 = healthy.filter((x) => isFatal(x.j2.verdict));
  const changedByR2 = healthy.filter((x) => x.j.verdict !== x.j2.verdict);

  console.log(`## 후보 수리별 값 (치명 ${fatalBefore.length}건 기준)\n`);
  console.log("| 수리 | 살아나는 문항 | 남는 치명 |");
  console.log("| --- | ---: | ---: |");
  console.log(
    `| R1 지면이 원래 번호를 찍는다 | ${r1.length} | ${fatalBefore.length - r1.length} |`,
  );
  console.log(
    `| R2 줄 중간 마커를 보기 경계로 | ${r2.length} | ${fatalBefore.length - r2.length} |`,
  );
  console.log(
    `| R1 + R2 | ${r1r2.length} | ${fatalBefore.length - r1r2.length} |`,
  );

  console.log(`\n## 반대쪽 검사 — R2 를 **성한 ${healthy.length}건**에 대면\n`);
  console.log(
    `- 판정이 «치명»으로 바뀐 것 **${brokenByR2.length}건** (0이어야 한다)\n` +
      `- 판정이 어떤 식으로든 바뀐 것 **${changedByR2.length}건**`,
  );
  if (changedByR2.length > 0) {
    const t = new Map<string, number>();
    for (const x of changedByR2) {
      const k = `${x.j.verdict} → ${x.j2.verdict}`;
      t.set(k, (t.get(k) ?? 0) + 1);
    }
    console.log("\n| 바뀜 | 건수 | 표본 |");
    console.log("| --- | ---: | --- |");
    for (const [k, n] of [...t].sort((a, b) => b[1] - a[1])) {
      const ex = changedByR2
        .filter((x) => `${x.j.verdict} → ${x.j2.verdict}` === k)
        .slice(0, 4)
        .map((x) => x.row.id.slice(0, 8))
        .join(" ");
      console.log(`| ${k} | ${n} | ${ex} |`);
    }
  }

  /* ── R2 가 살린 것의 원인 분포 ──────────────────────────────────────── */
  const cause = new Map<string, number>();
  for (const x of r2) cause.set(x.j.cause, (cause.get(x.j.cause) ?? 0) + 1);
  console.log(`\n## R2 가 살린 ${r2.length}건의 «원인»\n`);
  console.log("| 원인 | 건수 |");
  console.log("| --- | ---: |");
  for (const [k, n] of [...cause].sort((a, b) => b[1] - a[1]))
    console.log(`| ${k} | ${n} |`);

  /* ── 어느 수리로도 안 되는 것 ───────────────────────────────────────── */
  const stillFatal = after.filter(
    (x) =>
      isFatal(x.j.verdict) &&
      isFatal(x.j2.verdict) &&
      !x.j2.fixedByLabelRendering,
  );
  const stillCause = new Map<string, number>();
  for (const x of stillFatal)
    stillCause.set(x.j.cause, (stillCause.get(x.j.cause) ?? 0) + 1);
  console.log(
    `\n## 두 수리를 다 해도 못 쓰는 ${stillFatal.length}건의 «원인»\n`,
  );
  console.log("| 원인 | 건수 |");
  console.log("| --- | ---: |");
  for (const [k, n] of [...stillCause].sort((a, b) => b[1] - a[1]))
    console.log(`| ${k} | ${n} |`);

  const n = Number(
    process.argv[process.argv.indexOf("--samples") + 1] ??
      (process.argv.includes("--samples") ? 3 : 0),
  );
  if (n > 0) {
    console.log(`\n## R2 가 살린 표본 ${Math.min(n, r2.length)}건\n`);
    for (const x of r2.slice(0, n)) {
      console.log("```");
      console.log(
        `${x.row.id.slice(0, 8)} ${x.row.school ?? "?"} ${x.row.questionNumber ?? "?"}번 · 정답 ${JSON.stringify(x.row.answer.slice(0, 40))}`,
      );
      console.log(
        `전 ${x.j.verdict} 라벨[${x.j.labels.join(",")}]  →  후 ${x.j2.verdict} 라벨[${x.j2.labels.join(",")}]`,
      );
      console.log(`원문 ---\n${x.row.content.slice(0, 700)}`);
      console.log("```\n");
    }
  }

  /* ── 브리프가 준 숫자와 대조 ────────────────────────────────────────── */
  const objective = before.filter((x) => x.j.ref.basis === "원문자");
  const asEssay = objective.filter((x) => x.row.questionType === "서술형");
  const asShort = objective.filter((x) => x.row.questionType === "단답형");
  const circledOne = asEssay.filter((x) => x.row.answer.trim().startsWith("①"));
  console.log(`\n## 브리프의 숫자와 대조\n`);
  console.log(
    `- 「정답이 원문자인데 question_type 이 서술형」 → **${asEssay.length}건** ` +
      `(그중 정답이 정확히 ① 로 시작하는 것 ${circledOne.length}건)\n` +
      `- 「… 단답형」 → **${asShort.length}건** · 둘을 합치면 **${asEssay.length + asShort.length}건**\n` +
      `- 브리프·앞 보고서의 값은 **36건**이다. 분모(44,396)와 원문자 계열(➀·PUA 포함)이 다르다.`,
  );

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
