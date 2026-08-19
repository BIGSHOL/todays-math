/**
 * **조판이 쓸 수 있는 것이 본문에 남아 있는가**를 센다 (읽기 전용 · DB 읽기만).
 *
 *   npx tsx scripts/qa/report-figref-layout.ts
 *   npx tsx scripts/qa/report-figref-layout.ts --list
 *   npx tsx scripts/qa/report-figref-layout.ts --json scripts/qa/reports/figref-layout.json
 *
 * ## 이 자가 «다른» 것을 세는 이유
 *
 * `report-choice-figures.ts` 는 **「끊겼는가」**를 센다(134건). 이 자는 그 다음 질문,
 * **「그러면 무엇을 보고 그릴 것인가」**를 센다. 둘은 다른 값이 나와야 정상이다 —
 * 끊긴 문항 중에 «본문만 보고도 이을 수 있는 것»이 얼마인지가 **자료 구조를 새로
 * 만들 것인가**를 가른다(브리프 §4 「content 규약으로 될 일인지, 컬럼이 필요한지」).
 *
 * ## 열쇠는 «본문과 독립인 것»을 하나 쓴다 — 기록된 정답
 *
 * 본문에서 나온 짝을 본문으로 검산하면 아무것도 증명하지 못한다. 그래서
 * **기록된 정답의 번호**를 쓴다. 정답이 `⑤` 인데 파서가 본 보기가 셋뿐이면
 * **그 본문 구조는 틀린 것이 증명된다** — 어느 규칙도 없는 다섯째 칸을 만들 수 없다.
 * 이 검사는 반증 가능하다(CLAUDE.md 2026-08-18 「반대쪽 모집단에 대 보라」).
 *
 * ## 미분류
 *
 * 아래 분류는 **`미분류` 를 낼 수 있다.** 0인 것과 낼 수 없는 것은 다른 말이다.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

import { parseProblemContent } from "../../src/lib/problem/parseProblemContent";
import {
  isBrokenByParsedChoices,
  isBrokenByMissingChoices,
} from "./report-choice-figures";
import {
  ANSWER_CIRCLED_CLASS,
  CHOICE_MARKS,
} from "../../src/lib/math/circledNumber";

const prisma = new PrismaClient();

interface Row {
  id: string;
  content: string;
  figureUrls: string[];
  figureDims: number[];
  answer: string;
  school: string | null;
  questionNumber: number | null;
  source: string;
  pool: string;
  reviewStatus: string;
  directUseAllowed: boolean;
  noAnswer: boolean;
}

/** 정답이 **원문자뿐**이면 객관식이다 — 본문과 독립인 근거다. */
// 계열은 `circledNumber.ts` 한 곳에서 온다.
export const OBJECTIVE_ANSWER = new RegExp(
  String.raw`^[${ANSWER_CIRCLED_CLASS}](?:\s*[,·/]\s*[${ANSWER_CIRCLED_CLASS}])*$`,
);

const CIRCLES = CHOICE_MARKS.join("");

/** 기록된 정답이 가리키는 **가장 큰 보기 번호**. 원문자가 없으면 0. */
export function answerChoiceMax(answer: string): number {
  let max = 0;
  for (const ch of answer ?? "") {
    const index = CIRCLES.indexOf(ch);
    if (index >= 0) max = Math.max(max, index + 1);
  }
  return max;
}

export interface LayoutFacts {
  /** 본문 전체의 `[그림]` 표시 수. */
  marks: number;
  /** 파서가 본 보기 칸 수. */
  choiceCells: number;
  /** 그 보기 칸들 안에 든 `[그림]` 표시 수. */
  marksInChoices: number;
  /** 발문 쪽 `[그림]` 표시 수. */
  marksInQuestion: number;
  figures: number;
  answerMax: number;
}

const MARK = /\[그림\]/g;

export function layoutFacts(row: {
  content: string;
  figureUrls: readonly string[];
  answer: string;
}): LayoutFacts {
  const parsed = parseProblemContent(row.content ?? "");
  const marksInQuestion = (parsed.question.match(MARK) ?? []).length;
  const marksInChoices = parsed.choices.reduce(
    (sum, c) => sum + (c.match(MARK) ?? []).length,
    0,
  );
  return {
    marks: (row.content?.match(MARK) ?? []).length,
    choiceCells: parsed.choices.length,
    marksInChoices,
    marksInQuestion,
    figures: row.figureUrls.length,
    answerMax: answerChoiceMax(row.answer ?? ""),
  };
}

export type LayoutClass =
  "표시없음" | "규약모순" | "그림부족" | "규약가능" | "미분류";

/**
 * 「본문 표시(`[그림]`)만 보고 보기 칸을 그릴 수 있는가」.
 *
 * ⚠️ `규약가능` 은 **«그릴 수 있다»이지 «짝이 옳다»가 아니다.** 표시 수가 맞아도
 *    표시가 엉뚱한 자리에 있을 수 있다. 그 판정은 본문으로는 못 한다(보고서 §1).
 *
 * 반증 열쇠 둘 — 둘 다 **본문 밖**에서 온다.
 *  ㉠ **기록된 정답**: 정답이 `⑤` 인데 파서가 본 보기가 셋뿐이면 그 구조는 틀렸다.
 *  ㉡ **보기 칸 수**: 출제 가능 객관식 33,794건 중 **33,489건(99.10%)이 정확히 5칸**이다
 *     (`--census` 로 다시 나온다). 4칸 46 · 3칸 37 · 2칸 54 · 0칸 109.
 *     그래서 4·5 가 아니면 구조가 깨진 것으로 본다 — 문턱이 아니라 **분포**에서 온 값이다.
 */
export function classify(f: LayoutFacts): LayoutClass {
  // 정답에서 보기 번호를 못 읽으면 아무것도 반증할 수 없다 — 조용히 «가능»으로 세지 않는다.
  if (f.answerMax === 0) return "미분류";
  // 그림이 정답 번호보다 적으면 어떤 규칙으로도 그 보기를 못 그린다.
  if (f.figures < f.answerMax) return "그림부족";
  // 표시가 본문에는 있는데 발문·보기 어디에서도 안 잡힌다(꼬리 중복 제거 등으로 사라진 자리).
  if (f.marks > f.marksInQuestion + f.marksInChoices) return "미분류";
  if (f.marks === 0) return "표시없음";
  if (f.answerMax > f.choiceCells) return "규약모순";
  if (f.choiceCells !== 5 && f.choiceCells !== 4) return "규약모순";
  if (f.marks !== f.figures) return "규약모순";
  /**
   * 남는 그림은 전부 발문 몫이어야 한다. 안 맞으면 어느 그림이 남는지 못 정한다.
   * (범물중 13: 표시 5·그림 5·보기 4칸 — 한 칸이 표시를 둘 물어 발문 몫이 0이 된다.)
   *
   * ⚠️ 여기 원래 `marksInChoices !== choiceCells` 검사가 하나 더 있었다.
   *    **변이 시험이 그것을 죽은 코드로 잡아냈다** — 위 셋을 통과하면
   *    `marksInChoices = marks − marksInQuestion = figures − marksInQuestion` 이라
   *    아래 검사와 **대수적으로 같은 말**이다. 지웠다. 검사를 늘리는 것과
   *    가르는 힘이 느는 것은 다른 말이다.
   */
  if (f.marksInQuestion !== f.figures - f.choiceCells) return "규약모순";
  return "규약가능";
}

async function main() {
  const list = process.argv.includes("--list");
  const jsonArg = process.argv.indexOf("--json");

  const rows = (await prisma.$queryRawUnsafe(
    `SELECT id, content, answer, figure_urls AS "figureUrls", figure_dims AS "figureDims",
            source::text AS source, pool::text AS pool, review_status::text AS "reviewStatus",
            direct_use_allowed AS "directUseAllowed", answer = '(정답 없음)' AS "noAnswer",
            school, question_number AS "questionNumber"
       FROM problem ORDER BY id`,
  )) as Row[];

  const eligible = (r: Row) =>
    r.pool === "shared" &&
    r.reviewStatus === "approved" &&
    r.directUseAllowed &&
    !r.noAnswer;
  const broken = rows.filter(
    (r) =>
      eligible(r) &&
      (isBrokenByParsedChoices(r) || isBrokenByMissingChoices(r)),
  );
  const objective = broken.filter((r) =>
    OBJECTIVE_ANSWER.test((r.answer ?? "").trim()),
  );
  const notObjective = broken.filter(
    (r) => !OBJECTIVE_ANSWER.test((r.answer ?? "").trim()),
  );

  console.log(
    `«보기 번호와 그림이 안 이어진» 문항 ${broken.length}건` +
      ` (report-choice-figures.ts 합집합)\n` +
      `  ├ 정답이 원문자 = **객관식** ${objective.length}건 ← 이 조판의 대상\n` +
      `  └ 그 외(서술형·단답형) ${notObjective.length}건 — 보기 그림이 아니다`,
  );
  const bySource = new Map<string, number>();
  for (const r of objective)
    bySource.set(r.source, (bySource.get(r.source) ?? 0) + 1);
  console.log(
    `     대상 출처: ${[...bySource.entries()].map(([k, v]) => `${k} ${v}`).join(" · ")}`,
  );

  console.log(`\n객관식 아닌 ${notObjective.length}건 — 전량`);
  for (const r of notObjective)
    console.log(
      `  · ${r.id.slice(0, 8)} ${r.school ?? "?"} ${r.questionNumber ?? "?"}번` +
        ` · 그림 ${r.figureUrls.length}장 · 정답 ${JSON.stringify((r.answer ?? "").slice(0, 36))}`,
    );

  const tally = new Map<LayoutClass, Row[]>();
  for (const r of objective) {
    const cls = classify(layoutFacts(r));
    (tally.get(cls) ?? tally.set(cls, []).get(cls)!).push(r);
  }

  console.log(
    `\n본문 표시(\`[그림]\`)만으로 보기 칸을 그릴 수 있는가 — 객관식 ${objective.length}건`,
  );
  const order: LayoutClass[] = [
    "규약가능",
    "규약모순",
    "표시없음",
    "그림부족",
    "미분류",
  ];
  for (const cls of order)
    console.log(
      `  ${cls.padEnd(6)} ${(tally.get(cls)?.length ?? 0)
        .toString()
        .padStart(4)}건`,
    );

  // 규약모순 안에서 «무엇이 반증했는가» 를 갈라 낸다 — 한 숫자로 뭉개면 안 보인다.
  const contra = tally.get("규약모순") ?? [];
  const byReason = {
    정답이보기수를넘음: 0,
    보기칸수가4·5가아님: 0,
    표시수불일치: 0,
    발문몫이안맞음: 0,
  };
  for (const r of contra) {
    const f = layoutFacts(r);
    if (f.answerMax > f.choiceCells) byReason.정답이보기수를넘음 += 1;
    else if (f.choiceCells !== 5 && f.choiceCells !== 4)
      byReason.보기칸수가4·5가아님 += 1;
    else if (f.marks !== f.figures) byReason.표시수불일치 += 1;
    else byReason.발문몫이안맞음 += 1;
  }
  console.log(
    `    └ 규약모순의 갈래: 정답이 보기 수를 넘음 ${byReason.정답이보기수를넘음}` +
      ` · 보기 칸이 4·5가 아님 ${byReason["보기칸수가4·5가아님"]}` +
      ` · 표시 수 ≠ 그림 수 ${byReason.표시수불일치}` +
      ` · 발문 몫이 안 맞음 ${byReason.발문몫이안맞음}`,
  );

  // 「규약가능」이 «옳다»가 아니라 «반증되지 않았다» 뿐이라는 것을 수치로 남긴다 —
  // 정답이 ① 이면 ㉠ 열쇠가 아무것도 못 가른다.
  const canDo = tally.get("규약가능") ?? [];
  const weak = canDo.filter((r) => layoutFacts(r).answerMax <= 2);
  console.log(
    `    └ 「규약가능」 ${canDo.length}건 중 정답이 ①·② 라 ㉠ 열쇠가 아무것도 못 가른 것: ${weak.length}건`,
  );

  // 반대쪽 모집단 — 「보기 칸은 다섯」이 얼마나 참인가. 문턱이 아니라 분포에서 나온다.
  if (process.argv.includes("--census")) {
    const objAll = rows.filter(
      (r) => eligible(r) && OBJECTIVE_ANSWER.test((r.answer ?? "").trim()),
    );
    const dist = new Map<number, number>();
    let disproved = 0;
    for (const r of objAll) {
      const f = layoutFacts(r);
      dist.set(f.choiceCells, (dist.get(f.choiceCells) ?? 0) + 1);
      if (f.answerMax > f.choiceCells) disproved += 1;
    }
    console.log(
      `
반대쪽 모집단 — 출제 가능 객관식 ${objAll.length}건의 보기 칸 수 분포`,
    );
    for (const [cells, count] of [...dist.entries()].sort(
      (a, b) => a[0] - b[0],
    ))
      console.log(
        `  보기 ${String(cells).padStart(3)}칸 : ${String(count).padStart(6)}` +
          ` (${((count / objAll.length) * 100).toFixed(2)}%)`,
      );
    console.log(
      `  정답 번호 > 보기 칸 수 = **본문 구조가 반증된 것** ${disproved}건` +
        ` (${((disproved / objAll.length) * 100).toFixed(1)}%)` +
        ` — 그중 이 조판 대상 안에 있는 것 ${byReason.정답이보기수를넘음}건`,
    );
  }

  // 지면에 지금 «무엇이 보이는가» — 원장님이 알아차릴 수 있는가(§3)
  let visibleMark = 0;
  let onlyNumber = 0;
  let noTrace = 0;
  for (const r of objective) {
    const f = layoutFacts(r);
    if (f.marks > 0) visibleMark += 1;
    else if (f.choiceCells > 0) onlyNumber += 1;
    else noTrace += 1;
  }
  console.log(
    `\n지금 지면에 남는 «흔적» — 원장님이 알아차릴 수 있는가 (객관식 ${objective.length}건)\n` +
      `  \`[그림]\` 날 문자열이 찍힌다        ${visibleMark}건\n` +
      `  보기 번호만 찍히고 내용이 없다      ${onlyNumber}건\n` +
      `  **아무 흔적도 없다**                ${noTrace}건 ← 지면만 보고는 «정상»과 구별 못 한다`,
  );

  if (list) {
    console.log(`\n전량 목록`);
    for (const r of objective) {
      const f = layoutFacts(r);
      console.log(
        `${classify(f).padEnd(6)} ${r.id} ${(r.school ?? "?").padEnd(8)} ${String(
          r.questionNumber ?? "?",
        ).padStart(3)}번 그림${String(f.figures).padStart(3)}` +
          ` 표시${String(f.marks).padStart(3)}(발문${f.marksInQuestion}/보기${f.marksInChoices})` +
          ` 보기칸${String(f.choiceCells).padStart(2)} 정답${r.answer}`,
      );
    }
  }

  if (jsonArg >= 0) {
    const file = process.argv[jsonArg + 1]!;
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(
      file,
      JSON.stringify(
        {
          broken: broken.length,
          objective: objective.length,
          notObjective: notObjective.map((r) => ({
            id: r.id,
            school: r.school,
            questionNumber: r.questionNumber,
            figures: r.figureUrls.length,
            answer: r.answer,
          })),
          rows: objective.map((r) => ({
            id: r.id,
            school: r.school,
            questionNumber: r.questionNumber,
            source: r.source,
            class: classify(layoutFacts(r)),
            ...layoutFacts(r),
            answer: r.answer,
            figureUrls: r.figureUrls,
            figureDims: r.figureDims,
          })),
        },
        null,
        1,
      ),
      "utf8",
    );
    console.log(`\n-> ${file}`);
  }
  await prisma.$disconnect();
}

if (process.argv[1]?.includes("report-figref-layout"))
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
