/**
 * 출제 엔진(src/lib/generator/selectProblems.ts)이 소비할 "출제 가능 문제 풀" 조회 함수.
 * T3.1 REFACTOR 산출물 — GET /api/problems의 범용 필터 조회에서 자동 출제 전용 조회를
 * 분리해 Phase 4, T4.2(자동 출제 API)가 그대로 재사용할 수 있게 한다(06-tasks.md T3.1 REFACTOR).
 *
 * 자동 출제 규칙: review_status='approved' 이고 directUseAllowed=true 이고 정답이 있으며
 * 공용 풀이거나 본인 private인 문제만 대상으로 한다(D-22, D-26, D-31).
 *
 * ## 왜 select 로 컬럼을 좁혀 읽는가 (그리고 2026-08-18 에 셋이 늘었다)
 *
 * 이 조회의 유일한 소비자는 `selectProblems` 다. 예전에는 `findMany` 가 기본 동작대로
 * 28컬럼 전체를 읽어 `content` · `answer` · `solution` · `figureSvg` 네 개의 TEXT 를
 * 후보 수만큼 끌어왔고, 엔진은 그 중 **다섯 개**(`id · unitId · difficulty ·
 * problemType · directUseAllowed`)만 봤다. 한 단원 범위의 후보가 수백~수천 건이면
 * 그 전송량이 조회 비용을 지배하므로 다섯 개로 좁혔다.
 *
 * ⚠️ **2026-08-18(⑷ 확정) 부터 `content` · `figureUrls` · `figureDims` 를 같이 읽는다.**
 *    「엔진은 본문을 안 본다」는 그 최적화의 근거가 **정책과 함께 사라졌다** — 출제가
 *    「이 문항이 지면 칸에 들어가는가」를 보려면 본문과 그림이 있어야 한다
 *    (적대적 리뷰 ④ §8 G · §11 ⑷). 읽는 것을 늘린 대신 그대로 둔 것:
 *      · `answer` · `solution` · `figureSvg` — 세 TEXT 는 여전히 안 읽는다.
 *        이 중 `solution`·`figureSvg` 가 본문보다 훨씬 크다.
 *      · 출제가 끝난 뒤 지면이 쓰는 값은 `testProblem.findMany({include:{problem}})`
 *        가 따로 읽는다. 여기서 읽는 것은 **고르기 위한** 것뿐이다.
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

/**
 * 출제 후보 1건 — 엔진이 읽는 필드만.
 *
 * 지면 셋(`content`·`figureUrls`·`figureDims`)은 `SelectableProblem` 에서는 선택이지만
 * **여기서는 필수로 좁힌다.** 이 조회의 결과는 곧바로 출제 엔진의 풀이 되므로, select
 * 에서 하나라도 빠지면 정책이 조용히 꺼진다 — 그 배선을 타입이 붙잡게 한다.
 */
export interface EligibleProblem extends SelectableProblem {
  difficulty: Difficulty;
  problemType: ProblemType;
  content: string;
  figureUrls: string[];
  figureDims: number[];
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

/**
 * 출제 자격 where — **조회와 세기가 같은 것을 보게** 한 곳에 둔다.
 * `findEligibleProblems`(출제 풀)와 `countEligibleProblems`(화면의 «문항 N» 표시)가
 * 갈리면, 화면이 「부족 아님」이라 한 묶음이 출제에서 422 로 죽는다.
 */
export function eligibleProblemsWhere(params: FindEligibleProblemsParams) {
  return {
    AND: [
      problemVisibleWhere(params.userId),
      {
        unitId: { in: params.unitIds },
        reviewStatus: "approved" as const,
        directUseAllowed: true,
        // 정답이 없으면 정답지가 비어 채점이 불가능하다 → 출제 대상에서 제외.
        answer: { not: MISSING_ANSWER },
        ...(params.difficulty ? { difficulty: params.difficulty } : {}),
      },
    ],
  };
}

/** 출제 자격 문항 **수** — 일일 화면의 「문항 부족」 판정용. where 는 위와 한 벌이다. */
export async function countEligibleProblems(
  params: FindEligibleProblemsParams,
): Promise<number> {
  if (params.unitIds.length === 0) return 0;
  return db.problem.count({ where: eligibleProblemsWhere(params) });
}

/** 자동 출제용 문제 풀 조회 — reviewStatus='approved'만 대상으로 한다(D-22 품질 리스크 완화). */
export async function findEligibleProblems(
  params: FindEligibleProblemsParams,
): Promise<EligibleProblem[]> {
  if (params.unitIds.length === 0) return [];

  const rows = await db.problem.findMany({
    where: eligibleProblemsWhere(params),
    select: {
      id: true,
      unitId: true,
      difficulty: true,
      problemType: true,
      directUseAllowed: true,
      // ── 지면을 보기 위한 넷 (⑷ · mm 은 2026-08-20) ─────────────────────
      // 엔진(`risksTightSeat`)이 이 넷으로 「칸에 들어가나」를 본다. 하나라도
      // 빠지면 그 문항의 높이를 «모른다»로 받아 **후순위**로 돌린다.
      // `figureSourceMm` 은 컬럼(20260819120000)이 있어야 한다 — 없는 DB 에
      // 이걸 SELECT 하면 출제 조회가 통째로 죽는다.
      content: true,
      figureUrls: true,
      figureDims: true,
      figureSourceMm: true,
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
    content: row.content,
    figureUrls: row.figureUrls,
    figureDims: row.figureDims,
    figureSourceMm: row.figureSourceMm,
  }));
}
