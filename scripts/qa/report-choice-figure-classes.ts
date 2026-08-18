/**
 * 보기 그림 문항을 **부류로 갈라 센다** (읽기 전용).
 *
 *   npx tsx scripts/qa/report-choice-figure-classes.ts [--samples 파일]
 *
 * 앞 자(`report-choice-figures.ts`)는 한 숫자(134)를 냈다. 이 자는
 *   ① 앞 자의 숫자를 **그대로 재현**하고 (안 그러면 비교가 무의미하다)
 *   ② 브리프가 지목한 «구조적으로 못 보는» 열쇠 셋을 더해 늘어난 몫을 따로 보이고
 *   ③ **반대쪽 모집단**(`보기글자`)과 **미분류**를 같이 낸다.
 *
 * 반대쪽을 내는 이유는 이 저장소가 여러 번 밟은 자리다 — 판정기는
 * 「그림이 붙어 있는 멀쩡한 문항에 대면 «보기그림»이 나오면 안 된다」처럼
 * **반증 가능한 형태**로 물어야 한다.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { PrismaClient } from "@prisma/client";

import {
  classifyChoiceFigureRow,
  type ChoiceFigureRow,
} from "./choiceFigureRules";
import {
  isBrokenByMissingChoices,
  isBrokenByParsedChoices,
} from "./report-choice-figures";

const prisma = new PrismaClient();

interface Row extends ChoiceFigureRow {
  id: string;
  content: string;
  figureUrls: string[];
  pool: string;
  reviewStatus: string;
  directUseAllowed: boolean;
  noAnswer: boolean;
  answer: string;
  school: string | null;
  source: string;
  sourceFile: string | null;
  examId: string | null;
  questionNumber: number | null;
}

function tallyToLines(t: Map<string, number>): string {
  return [...t.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `  ${String(v).padStart(5)}  ${k}`)
    .join("\n");
}

async function main() {
  const sampleArg = process.argv.indexOf("--samples");
  const samplePath =
    sampleArg >= 0
      ? process.argv[sampleArg + 1]
      : "scripts/qa/reports/choice-figure-samples.txt";

  const rows = (await prisma.$queryRawUnsafe(
    `SELECT id, content, figure_urls AS "figureUrls", pool::text AS pool,
            review_status::text AS "reviewStatus", direct_use_allowed AS "directUseAllowed",
            answer, answer = '(정답 없음)' AS "noAnswer", school, source::text AS source,
            source_file AS "sourceFile", exam_id AS "examId",
            question_number AS "questionNumber"
       FROM problem ORDER BY id`,
  )) as Row[];

  const eligible = rows.filter(
    (r) =>
      r.pool === "shared" &&
      r.reviewStatus === "approved" &&
      r.directUseAllowed &&
      !r.noAnswer,
  );

  const legacy = new Set(
    eligible
      .filter((r) => isBrokenByParsedChoices(r) || isBrokenByMissingChoices(r))
      .map((r) => r.id),
  );

  const verdicts = new Map(
    eligible.map((r) => [r.id, classifyChoiceFigureRow(r)]),
  );
  const broken = eligible.filter((r) => verdicts.get(r.id)!.broken);
  const unclassified = eligible.filter(
    (r) => verdicts.get(r.id)!.klass === "미분류",
  );

  console.log(
    `분모 — 출제 가능 풀 ${eligible.length}건 (DB 전량 ${rows.length})`,
  );
  console.log(
    `\n[기준] 앞 자 report-choice-figures.ts 의 합집합 ${legacy.size}건 ` +
      `— 이 값이 134가 아니면 분모가 움직인 것이다`,
  );

  const keyTally = new Map<string, number>();
  for (const r of eligible)
    for (const k of verdicts.get(r.id)!.keys)
      keyTally.set(k, (keyTally.get(k) ?? 0) + 1);
  console.log(`\n[열쇠별] (겹친다 — 합계는 합집합이 아니다)`);
  console.log(tallyToLines(keyTally));

  const newOnly = broken.filter((r) => !legacy.has(r.id));
  const lostOnly = [...legacy].filter((id) => !verdicts.get(id)?.broken);
  console.log(
    `\n[합집합] 보기그림 ${broken.length}건` +
      `\n  앞 자와 겹침        ${broken.length - newOnly.length}` +
      `\n  이 자만 잡음(늘어난 몫) ${newOnly.length}` +
      `\n  앞 자만 잡음(줄어든 몫) ${lostOnly.length}`,
  );

  const klassTally = new Map<string, number>();
  for (const r of eligible) {
    const v = verdicts.get(r.id)!;
    // 그림이 아예 없고 보기도 글자면 이 조사와 무관하다 — 세지 않는다.
    if (v.klass === "무관") continue;
    klassTally.set(v.klass, (klassTally.get(v.klass) ?? 0) + 1);
  }
  console.log(`\n[부류] (그림이 붙은 문항 + 보기가 그림인 문항)`);
  console.log(tallyToLines(klassTally));

  const cross = new Map<string, number>();
  for (const r of broken) {
    const v = verdicts.get(r.id)!;
    cross.set(
      `마커 ${v.markerState} · ${v.markRel} · 그림 ${v.features.nFig}장`,
      (cross.get(
        `마커 ${v.markerState} · ${v.markRel} · 그림 ${v.features.nFig}장`,
      ) ?? 0) + 1,
    );
  }
  console.log(`\n[보기그림 ${broken.length}건의 속모양]`);
  console.log(tallyToLines(cross));

  const markerState = new Map<string, number>();
  const figCount = new Map<string, number>();
  const srcTally = new Map<string, number>();
  let circled = 0;
  for (const r of broken) {
    const v = verdicts.get(r.id)!;
    markerState.set(v.markerState, (markerState.get(v.markerState) ?? 0) + 1);
    figCount.set(
      `그림 ${v.features.nFig}장`,
      (figCount.get(`그림 ${v.features.nFig}장`) ?? 0) + 1,
    );
    srcTally.set(r.source, (srcTally.get(r.source) ?? 0) + 1);
    if (v.features.anyCircled) circled += 1;
  }
  console.log(`\n[마커 잔존]`);
  console.log(tallyToLines(markerState));
  console.log(`\n[그림 장수]`);
  console.log(tallyToLines(figCount));
  console.log(`\n[출처]`);
  console.log(tallyToLines(srcTally));
  console.log(`\n[원문자 마커로 들어온 문항] ${circled}건`);

  const noMeta = broken.filter(
    (r) => !r.sourceFile || r.questionNumber === null,
  );
  console.log(
    `[원본 메타(sourceFile·문항번호)가 없는 문항] ${noMeta.length}건`,
  );

  /* ── 표본 파일 — 미분류를 반드시 싣는다 ─────────────────────────────── */
  const lines: string[] = [];
  const push = (title: string, list: Row[], take: number) => {
    lines.push(`\n${"=".repeat(78)}\n### ${title} — ${list.length}건\n`);
    for (const r of list.slice(0, take)) {
      const v = verdicts.get(r.id)!;
      lines.push(
        `--- ${r.id} ${r.school ?? "?"} ${r.questionNumber ?? "?"}번 exam=${r.examId} ` +
          `정답=${r.answer} 그림${v.features.nFig} 표시${v.features.nMark} ` +
          `마커[${v.features.markers.map((m) => (m.circled ? "○" : "") + m.n).join(",")}] ` +
          `열쇠[${v.keys.join(" ")}] ${v.klass}\n${r.sourceFile ?? ""}\n${r.content}\n`,
      );
    }
  };
  push("미분류 — 전량 (눈으로 볼 것)", unclassified, unclassified.length);
  push("이 자만 잡은 것 — 전량 (오탐 의심 순)", newOnly, newOnly.length);
  push(
    "앞 자만 잡은 것 — 전량",
    eligible.filter((r) => lostOnly.includes(r.id)),
    999,
  );
  // 반대쪽 모집단 — 그림이 붙었는데 «보기글자» 로 판정된 것
  const opposite = eligible.filter(
    (r) => verdicts.get(r.id)!.klass === "보기글자" && r.figureUrls.length >= 4,
  );
  push("반대쪽 표본 — 그림 4장 이상인데 «보기글자»", opposite, 25);

  mkdirSync(dirname(samplePath), { recursive: true });
  writeFileSync(samplePath, lines.join("\n"), "utf8");
  console.log(`\n표본 → ${samplePath}`);
  console.log(
    `  미분류 ${unclassified.length} · 늘어난 몫 ${newOnly.length} · ` +
      `줄어든 몫 ${lostOnly.length} · 반대쪽(그림4장+ 보기글자) ${opposite.length}`,
  );

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
