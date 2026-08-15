/**
 * 이미 적재된 기출 문항의 **소문항(⑴⑵) 본문 복원**.
 *
 * 배경: `src/lib/import/convertPastExam.ts` 가 `sub_questions` 를 타입에만
 * 선언하고 읽지 않아, 추출 산출물 36,951문항 중 소문항을 가진 753건이
 * `물음에 답하시오.` 까지만 적재됐다(2026-08-15 실측). 변환기는 2ab73e9 에서
 * 고쳤지만 **이미 DB 에 들어간 행은 그대로다** — 그래서 이 스크립트가 필요하다.
 *
 * 본문을 직접 조립하지 않는다. 고쳐진 `convertPastExamQuestion()` 을 그대로
 * 불러 다시 만든다 — 손으로 짠 문자열은 다음 이관 때 변환기와 갈라진다.
 *
 * 안전 검증(문항마다, 하나라도 어긋나면 건너뛴다):
 *   1. 새 본문이 비어 있지 않다
 *   2. 새 본문이 기존보다 길다 (소문항이 **추가**되는 것이므로)
 *   3. 새 본문이 기존 본문을 **접두사로 포함**한다 (기존 지문이 보존됨)
 *
 * 본문은 학생이 보는 지면이라 기본은 드라이런이다.
 *
 *   npx tsx scripts/qa/restore-sub-questions.ts                        드라이런
 *   npx tsx scripts/qa/restore-sub-questions.ts --json out.json        대상 목록까지 파일로
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/restore-sub-questions.ts --apply
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

import { allowSharedImport } from "../../src/lib/import/classifyDatabaseUrl";
import {
  convertPastExamQuestion,
  normalizePastExamPaper,
  type PastExamAnswer,
  type PastExamPaper,
  type PastExamQuestion,
} from "../../src/lib/import/convertPastExam";
import { inspectDatabaseTargets } from "../import/resolveDbTarget";

/** 추출 산출물 디렉터리. 뒤쪽이 앞쪽을 덮지 않고 **충돌로 잡는다**. */
const SOURCE_DIRS = [
  "scripts/qa/reports/final-batch",
  "scripts/qa/reports/index-batch",
];

interface Rebuilt {
  externalId: string;
  content: string;
  subCount: number;
  /** 어느 산출물에서 나왔는지 — 충돌 보고용 */
  origin: string;
}

interface Target {
  id: string;
  externalId: string;
  oldLength: number;
  newLength: number;
  subCount: number;
  content: string;
}

/** 산출물 한 장을 읽어 소문항을 가진 문항만 변환기로 다시 만든다. */
function rebuildPaper(
  raw: PastExamPaper & { _answers?: PastExamAnswer[] },
  fileStem: string,
  origin: string,
): Rebuilt[] {
  const paper = normalizePastExamPaper(raw, fileStem);
  const answers = new Map(
    (raw._answers ?? []).map((answer) => [answer.number, answer]),
  );
  const out: Rebuilt[] = [];
  for (const question of paper.questions ?? []) {
    const subs = (question as PastExamQuestion).sub_questions ?? [];
    if (subs.length === 0) continue;
    const draft = convertPastExamQuestion(
      question,
      answers.get(question.number),
      paper,
    );
    out.push({
      externalId: draft.externalId,
      content: draft.content,
      subCount: subs.length,
      origin,
    });
  }
  return out;
}

async function collectRebuilt(): Promise<{
  byExternalId: Map<string, Rebuilt>;
  scanned: number;
  conflicts: string[];
}> {
  const byExternalId = new Map<string, Rebuilt>();
  const conflicts: string[] = [];
  let scanned = 0;

  for (const dir of SOURCE_DIRS) {
    let files: string[];
    try {
      files = (await readdir(dir)).filter((name) => name.endsWith(".json"));
    } catch {
      continue;
    }
    for (const file of files) {
      const fileStem = path.basename(file, ".json");
      let raw: PastExamPaper & { _answers?: PastExamAnswer[] };
      try {
        raw = JSON.parse(await readFile(path.join(dir, file), "utf8"));
      } catch {
        continue;
      }
      scanned += raw.questions?.length ?? 0;
      for (const item of rebuildPaper(raw, fileStem, `${dir}/${file}`)) {
        const seen = byExternalId.get(item.externalId);
        if (!seen) {
          byExternalId.set(item.externalId, item);
        } else if (seen.content !== item.content) {
          // 같은 externalId 인데 산출물마다 본문이 다르면 어느 쪽인지 모른다.
          conflicts.push(item.externalId);
          byExternalId.delete(item.externalId);
        }
      }
    }
  }
  return { byExternalId, scanned, conflicts };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const jsonAt = argv.indexOf("--json");
  const jsonOut = jsonAt >= 0 ? argv[jsonAt + 1] : null;

  const { byExternalId, scanned, conflicts } = await collectRebuilt();
  const externalIds = [...byExternalId.keys()];
  console.log(`산출물 문항 ${scanned}건 · 소문항 보유 ${externalIds.length}건`);
  if (conflicts.length > 0) {
    console.log(`  산출물 간 본문 충돌로 제외 ${conflicts.length}건`);
  }

  const prisma = new PrismaClient();
  try {
    const problems = await prisma.problem.findMany({
      where: { source: "past_exam", externalId: { in: externalIds } },
      select: { id: true, externalId: true, content: true },
    });
    const matched = new Map(
      problems
        .filter((problem) => problem.externalId)
        .map((problem) => [problem.externalId as string, problem]),
    );

    const targets: Target[] = [];
    let alreadyApplied = 0;
    let failEmpty = 0;
    let failNotLonger = 0;
    let failNotPrefix = 0;
    const notPrefixSamples: string[] = [];

    for (const externalId of externalIds) {
      const problem = matched.get(externalId);
      if (!problem) continue;
      const next = byExternalId.get(externalId)!;
      const oldContent = problem.content;

      if (next.content === oldContent) {
        alreadyApplied += 1;
        continue;
      }
      if (!next.content.trim()) {
        failEmpty += 1;
        continue;
      }
      if (next.content.length <= oldContent.length) {
        failNotLonger += 1;
        continue;
      }
      if (!next.content.startsWith(oldContent)) {
        failNotPrefix += 1;
        if (notPrefixSamples.length < 10) notPrefixSamples.push(externalId);
        continue;
      }
      targets.push({
        id: problem.id,
        externalId,
        oldLength: oldContent.length,
        newLength: next.content.length,
        subCount: next.subCount,
        content: next.content,
      });
    }

    const unmatched = externalIds.length - matched.size;
    console.log(
      [
        `\nDB 매칭 ${matched.size}건 · 매칭 실패 ${unmatched}건`,
        `검증 통과(교체 대상) ${targets.length}건`,
        `이미 반영됨 ${alreadyApplied}건`,
        `검증 실패 — 새 본문 비어 있음 ${failEmpty}건 · 길어지지 않음 ${failNotLonger}건 · 기존 본문이 접두사가 아님 ${failNotPrefix}건`,
      ].join("\n"),
    );
    if (notPrefixSamples.length > 0) {
      console.log(`  접두사 불일치 예: ${notPrefixSamples.join(", ")}`);
    }
    const addedChars = targets.reduce(
      (sum, target) => sum + (target.newLength - target.oldLength),
      0,
    );
    console.log(`  복원되는 본문 ${addedChars}자`);

    if (jsonOut) {
      await writeFile(
        jsonOut,
        // 본문은 싣지 않는다 — 길이만으로 규모를 확인한다.
        JSON.stringify(
          targets.map((target) => ({
            id: target.id,
            externalId: target.externalId,
            oldLength: target.oldLength,
            newLength: target.newLength,
            subCount: target.subCount,
          })),
          null,
          1,
        ),
        "utf8",
      );
      console.log(`  대상 목록 → ${jsonOut}`);
    }

    if (!apply) {
      console.log(
        `\n드라이런 — 변경 없음. 적용하려면 --apply (대상 ${targets.length})`,
      );
      return;
    }

    const inspection = await inspectDatabaseTargets();
    if (
      !inspection.selected.canMigrateOrLoad &&
      !allowSharedImport(inspection.selected)
    ) {
      console.log(
        `\n차단 — ${inspection.selected.reason}\nALLOW_SHARED_IMPORT=1 을 명시하세요.`,
      );
      return;
    }

    let updated = 0;
    for (const target of targets) {
      await prisma.problem.update({
        where: { id: target.id },
        data: { content: target.content },
      });
      updated += 1;
    }
    console.log(`\n복원 완료 — ${updated}건`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
