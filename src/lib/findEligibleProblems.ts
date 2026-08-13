/**
 * 출제 엔진(src/lib/generator/selectProblems.ts)이 소비할 "출제 가능 문제 풀" 조회 함수.
 * T3.1 REFACTOR 산출물 — GET /api/problems의 범용 필터 조회에서 자동 출제 전용 조회를
 * 분리해 Phase 4, T4.2(자동 출제 API)가 그대로 재사용할 수 있게 한다(06-tasks.md T3.1 REFACTOR).
 *
 * 자동 출제 규칙: review_status='approved' 문제만 대상으로 한다 — pending(미검수)은
 * 시험지 검수 화면에서 검수를 거쳐야 승격된다(D-22, docs/planning/04-database-design.md §2.3
 * "출제 규칙").
 */
import type { Difficulty } from "@/contracts/common.contract";
import type { ProblemEntity } from "@/contracts/problem.contract";
import { db } from "@/lib/db";
import { serializeProblem } from "@/lib/serializers";

export interface FindEligibleProblemsParams {
  /** 출제 대상 단원 id 목록(반의 진도 범위 등에서 산출) — 비어 있으면 빈 배열을 즉시 반환한다. */
  unitIds: string[];
  /** 특정 난이도만 좁혀 조회할 때 사용 — 생략 시 전 난이도(easy/mid/hard)를 대상으로 한다
   *  (난이도 배분 자체는 selectProblems가 pool 전체를 받아 처리한다). */
  difficulty?: Difficulty;
}

/** 자동 출제용 문제 풀 조회 — reviewStatus='approved'만 대상으로 한다(D-22 품질 리스크 완화). */
export async function findEligibleProblems(
  params: FindEligibleProblemsParams,
): Promise<ProblemEntity[]> {
  if (params.unitIds.length === 0) return [];

  const rows = await db.problem.findMany({
    where: {
      unitId: { in: params.unitIds },
      reviewStatus: "approved",
      ...(params.difficulty ? { difficulty: params.difficulty } : {}),
    },
  });

  return rows.map(serializeProblem);
}
