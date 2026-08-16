/**
 * `Problem.questionType` 백필 — 추출 JSON 원본의 문항 유형(객관식/단답형/서술형)을
 * `externalId` 로 조인해 채운다. AI 0 · 토큰 0.
 *
 * 왜 필요한가: `mapProblemType.ts` 가 이관 때 객관식→"개념", 단답형→"계산" 으로
 * 뭉개 출제 형식 구분이 물리적으로 소실됐다(11-score-predictor.md §2.4). 청사진의
 * 유형 배분(학교 고유성 51.1%, 항목 중 최고)을 채우려면 이 컬럼이 필요하다.
 *
 * 조인 키: `Problem.externalId` 는 `"{exam_id}-{문항번호}"` 형식이다. 추출 코퍼스는
 * `loadCorpus()`(scripts/predictor/loadCorpus.ts) 가 이미 파싱해 두므로 재사용한다
 * — 이 스크립트가 직접 원본 JSON 파일을 읽지 않는다.
 *
 * ⚠️ `externalId` 는 트랙 C 소유 컬럼이다 — 이 스크립트는 **읽기만** 하고 절대
 *    쓰지 않는다. `applyBackfill` 은 `questionType` 한 필드만 UPDATE 한다.
 *
 *   npx tsx scripts/qa/backfill-question-type.ts                드라이런
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/backfill-question-type.ts --apply
 */
import { PrismaClient } from "@prisma/client";

import type {
  ExamPaper,
  QuestionType,
} from "../../src/contracts/predictor.contract";
import { allowSharedImport } from "../../src/lib/import/classifyDatabaseUrl";
import { isDirectScript } from "../import/isDirectScript";
import { inspectDatabaseTargets } from "../import/resolveDbTarget";
import { loadCorpus } from "../predictor/loadCorpus";

/** `${externalExamId}-${문항번호}` → 문항 유형. 코퍼스가 갖는 조인 키의 SSOT다. */
export function buildExternalIdMap(
  papers: ExamPaper[],
): Map<string, QuestionType> {
  const map = new Map<string, QuestionType>();
  for (const paper of papers) {
    for (const q of paper.questions) {
      map.set(`${paper.externalExamId}-${q.number}`, q.qtype);
    }
  }
  return map;
}

export interface ProblemJoinRow {
  id: string;
  externalId: string | null;
  questionType: string | null;
  /** 계산/개념/활용/서술형 — questionType 과는 다른 축(11 §2.4). 불일치 집계용으로만 읽는다. */
  problemType: string;
}

export interface BackfillPlan {
  /** 실제로 UPDATE 가 필요한 행만 담는다 — 이미 같은 값이면 넣지 않는다(멱등). */
  updates: Array<{ id: string; questionType: QuestionType }>;
  /** externalId 로 코퍼스와 조인에 성공한 행 수(갱신 필요 여부와 무관). */
  matched: number;
  /** 조인 실패 — externalId 가 없거나 코퍼스에 없다. 건드리지 않고 세기만 한다. */
  unmatched: number;
  /** 조인에 성공했고 이미 목표값과 같아 UPDATE 가 필요 없는 행 수. */
  alreadyCorrect: number;
  distribution: Record<QuestionType, number>;
  /**
   * 참고용 — `problemType==='서술형'` 라벨과 새로 매긴 `questionType==='서술형'` 이
   * 어긋나는 조인-성공 행 수. 두 축은 원래 다르므로 0이 아니어도 이상하지 않다.
   * (2026-08-14 교훈: 라벨은 표본으로 확인하기 전엔 근거가 아니다 — 수치만 남긴다.)
   */
  problemTypeMismatch: number;
}

/** 순수 함수 — DB/파일 IO 없음. externalId 로 조인해 갱신 계획만 세운다. */
export function planBackfill(
  problems: ProblemJoinRow[],
  externalIdMap: Map<string, QuestionType>,
): BackfillPlan {
  const updates: BackfillPlan["updates"] = [];
  const distribution: Record<QuestionType, number> = {
    객관식: 0,
    단답형: 0,
    서술형: 0,
  };
  let matched = 0;
  let unmatched = 0;
  let alreadyCorrect = 0;
  let problemTypeMismatch = 0;

  for (const row of problems) {
    const target = row.externalId
      ? externalIdMap.get(row.externalId)
      : undefined;
    if (!target) {
      unmatched += 1;
      continue;
    }
    matched += 1;
    distribution[target] += 1;
    if ((row.problemType === "서술형") !== (target === "서술형")) {
      problemTypeMismatch += 1;
    }
    if (row.questionType === target) {
      alreadyCorrect += 1;
      continue;
    }
    updates.push({ id: row.id, questionType: target });
  }

  return {
    updates,
    matched,
    unmatched,
    alreadyCorrect,
    distribution,
    problemTypeMismatch,
  };
}

/** 한 번의 UPDATE 에 실을 최대 행 수. IN 절이 무한정 길어지지 않게 자른다. */
export const BACKFILL_BATCH_SIZE = 500;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}

/**
 * 계획된 UPDATE 를 실행한다. `questionType` 한 필드만 쓴다 — 절대 `externalId` 를
 * 건드리지 않는다(트랙 C 소유, 위 파일 헤더 참조).
 *
 * **유형별로 묶어 `updateMany` 로 쓴다.** 한 건씩 쓰면 실데이터 29,622건에 공유 DB
 * 풀러 왕복이 29,622회라 수십 분이 걸리고, 중간에 끊기면 어디까지 갔는지 알 수 없다.
 * 유형은 3가지뿐이라 배치로 자르면 왕복이 60회 남짓으로 줄어든다.
 *
 * 트랜잭션으로 묶지는 않는다 — 이 백필은 멱등이라(이미 같은 값이면 계획에서 빠진다)
 * 끊긴 자리에서 다시 돌리면 된다. 3만 행을 한 트랜잭션에 묶는 쪽이 더 위험하다.
 */
export async function applyBackfill(
  prisma: Pick<PrismaClient, "problem">,
  updates: BackfillPlan["updates"],
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  const byType = new Map<QuestionType, string[]>();
  for (const update of updates) {
    const bucket = byType.get(update.questionType);
    if (bucket) bucket.push(update.id);
    else byType.set(update.questionType, [update.id]);
  }

  let done = 0;
  for (const [questionType, ids] of byType) {
    for (const batch of chunk(ids, BACKFILL_BATCH_SIZE)) {
      const result = await prisma.problem.updateMany({
        where: { id: { in: batch } },
        data: { questionType },
      });
      done += result.count;
      onProgress?.(done, updates.length);
    }
  }
  return done;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");

  const prisma = new PrismaClient();
  try {
    const { papers, stats } = loadCorpus();
    const externalIdMap = buildExternalIdMap(papers);

    const rows = await prisma.problem.findMany({
      select: {
        id: true,
        externalId: true,
        questionType: true,
        problemType: true,
      },
    });

    const plan = planBackfill(rows, externalIdMap);

    console.log("── questionType 백필 (externalId 조인, AI 0 · 토큰 0) ──");
    console.log(`코퍼스 — 시험지 ${stats.papers} · 문항 ${stats.questions}`);
    console.log(
      `Problem ${rows.length}행 — 조인 성공 ${plan.matched} · 조인 실패(미변경) ${plan.unmatched}`,
    );
    console.log(
      `분포(조인 성공 기준) — 객관식 ${plan.distribution.객관식} · ` +
        `단답형 ${plan.distribution.단답형} · 서술형 ${plan.distribution.서술형}`,
    );
    console.log(
      `이미 일치(UPDATE 불필요) ${plan.alreadyCorrect} · 갱신 대상 ${plan.updates.length}`,
    );
    console.log(
      `problemType='서술형' 라벨과 불일치 ${plan.problemTypeMismatch}건 ` +
        `(참고용 — 두 축은 원래 다른 개념이다)`,
    );

    if (!apply) {
      console.log("\n드라이런 — 변경 없음. 적용하려면 --apply");
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

    console.log(`
적용 시작 — ${plan.updates.length}건`);
    const n = await applyBackfill(prisma, plan.updates, (done, total) => {
      if (done % 5000 < BACKFILL_BATCH_SIZE || done === total) {
        console.log(`  ${done}/${total}`);
      }
    });
    console.log(`적용 완료 — ${n}건`);
  } finally {
    await prisma.$disconnect();
  }
}

if (isDirectScript(import.meta.url)) {
  void main();
}
