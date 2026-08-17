/**
 * 출제 엔진(src/lib/generator/selectProblems.ts)이 소비할 "출제 가능 문제 풀" 조회 함수.
 * T3.1 REFACTOR 산출물 — GET /api/problems의 범용 필터 조회에서 자동 출제 전용 조회를
 * 분리해 Phase 4, T4.2(자동 출제 API)가 그대로 재사용할 수 있게 한다(06-tasks.md T3.1 REFACTOR).
 *
 * 자동 출제 규칙: review_status='approved' 이고 directUseAllowed=true 이고 정답이 있으며
 * 공용 풀이거나 본인 private인 문제만 대상으로 한다(D-22, D-26, D-31).
 *
 * ## 왜 select 로 5컬럼만 읽는가
 *
 * 이 조회의 유일한 소비자는 `selectProblems` 이고, 그 엔진이 문항에서 읽는 것은
 * `id · unitId · difficulty · problemType · directUseAllowed` **다섯 개뿐**이다
 * (`SelectableProblem`). 예전에는 `findMany` 가 기본 동작대로 28컬럼 전체를 읽어
 * `content` · `answer` · `solution` · `figureSvg` 네 개의 TEXT 를 후보 수만큼 끌어왔다.
 * 한 단원 범위의 후보가 수백~수천 건이면 그 전송량이 조회 비용을 지배한다.
 * 문항 **본문**이 필요한 곳은 출제가 끝난 뒤의 `testProblem.findMany({include:{problem}})`
 * 이지, 후보 풀 조회가 아니다.
 *
 * 🔴 where 절은 손대지 않았다 — `answer` 를 select 하지 않아도 "정답 없음" 제외는
 *    **DB 가 계속 판정한다**. 읽는 컬럼을 줄인 것이지 자격 규칙을 줄인 것이 아니다.
 */
import type { Difficulty } from "@/contracts/common.contract";
import type { ProblemType } from "@/contracts/problem.contract";
import { db } from "@/lib/db";
import type { SelectableProblem } from "@/lib/generator/selectProblems";
import { MISSING_ANSWER } from "@/lib/missingAnswer";
import { problemVisibleWhere } from "@/lib/problemPool";

/** 출제 후보 1건 — 엔진이 읽는 필드만. `ProblemEntity` 의 진부분집합이다. */
export interface EligibleProblem extends SelectableProblem {
  difficulty: Difficulty;
  problemType: ProblemType;
}

export interface FindEligibleProblemsParams {
  /** 출제자(강사) — 공용 풀 + 본인 private만 본다 (D-31). */
  userId: string;
  /** 출제 대상 단원 id 목록(반의 진도 범위 등에서 산출) — 비어 있으면 빈 배열을 즉시 반환한다. */
  unitIds: string[];
  /** 특정 난이도만 좁혀 조회할 때 사용 — 생략 시 전 난이도(easy/mid/hard)를 대상으로 한다
   *  (난이도 배분 자체는 selectProblems가 pool 전체를 받아 처리한다). */
  difficulty?: Difficulty;
}

/** 자동 출제용 문제 풀 조회 — reviewStatus='approved'만 대상으로 한다(D-22 품질 리스크 완화). */
export async function findEligibleProblems(
  params: FindEligibleProblemsParams,
): Promise<EligibleProblem[]> {
  if (params.unitIds.length === 0) return [];

  const rows = await db.problem.findMany({
    where: {
      AND: [
        problemVisibleWhere(params.userId),
        {
          unitId: { in: params.unitIds },
          reviewStatus: "approved",
          directUseAllowed: true,
          // 정답이 없으면 정답지가 비어 채점이 불가능하다 → 출제 대상에서 제외.
          answer: { not: MISSING_ANSWER },
          ...(params.difficulty ? { difficulty: params.difficulty } : {}),
        },
      ],
    },
    select: {
      id: true,
      unitId: true,
      difficulty: true,
      problemType: true,
      directUseAllowed: true,
    },
  });

  return rows.map((row) => ({
    id: row.id,
    unitId: row.unitId,
    difficulty: row.difficulty,
    // Problem.problemType은 DB에서 자유 문자열(VarChar)이지만 앱 계약은 4종으로 좁힌다
    // (07-coding-convention.md §2.3, serializeProblem 과 같은 규칙).
    problemType: row.problemType as ProblemType,
    directUseAllowed: row.directUseAllowed,
  }));
}
