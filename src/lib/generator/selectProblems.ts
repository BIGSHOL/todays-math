/**
 * 문제 선정 오케스트레이터(★ 프로젝트의 심장) — 최근 출제 제외 + 난이도 배분 + 유형
 * 재배치를 순서대로 적용하는 순수 함수. 같은 pool/정책/시드로 호출하면 항상 같은 결과를
 * 낸다(결정론, docs/planning/06-tasks.md T4.1 인수 조건).
 *
 * 참조: docs/planning/06-tasks.md T4.1, src/contracts/test.contract.ts
 */
import type { DifficultyRatio } from "@/contracts/common.contract";
import type { ProblemEntity } from "@/contracts/problem.contract";
import type { ShortfallItem } from "@/contracts/test.contract";

import { JASEUP_MEASURED_PX } from "@/lib/printGeometry";
import { assessSeat, seatCapacities } from "@/lib/printOverflow";

import {
  balanceDifficulty,
  type SelectableProblem,
  type SubstitutionRecord,
} from "./balanceDifficulty";
import { seededShuffle } from "./seededRandom";

export type { SelectableProblem };

/**
 * 자리별 문항 칸 — 인쇄 판정이 쓰는 **바로 그 함수**를 그대로 내보낸다.
 * 출제가 제 손으로 자리 계산을 갖지 않게 하려는 것이다(리뷰 §A: 한 숫자를 두 곳이).
 */
export const seatCapacitiesFor = seatCapacities;

/**
 * **이 문항을 높이 `slotPx` 인 칸에 놓으면 겹칠 위험이 있는가.**
 * 판정(`assessSeat`)을 그대로 부른다 — 출제와 인쇄 경고가 **한 규칙**을 본다.
 *
 * ## 「모른다」를 어느 쪽으로 세는가
 *
 * · **그림 치수를 모르는 것**은 여기서 다시 정하지 않는다. `parseFigureDimensions` 가
 *   손상된 입력(없음·짝 어긋남·0·음수·NaN)을 전부 «모른다»로 받고, 그 자리를
 *   `UNKNOWN_FIGURE_HEIGHT_PX`(207px — 실측 9,587장의 중앙값)로 센다. 판정이 이미
 *   쓰는 값이라 출제가 따로 정하면 두 곳이 갈라진다. 실측으로 이 부류는 591건이다.
 * · **본문 자체가 없는 것**(엔진이 문항을 아예 못 볼 때)은 **위험한 쪽**으로 센다.
 *   둘 다 위험하다 — «크다»로 보면 그림 문항이 통째로 밀리고, «작다»로 보면 이번
 *   정책이 그 문항들에 대해 **조용히 꺼진다**. 뒤쪽을 고른 이유:
 *   (1) 「모른다」가 «안 넘친다»로 미끄러지는 것이 이 저장소가 여섯 번 낸 결함이고
 *       (CLAUDE.md 2026-08-16·17), 침묵하는 실패는 눈에 안 띈다.
 *   (2) 여기서 «위험»은 **제외가 아니라 후순위**다 — 잃는 것은 순서뿐이고 출제는
 *       막지 않는다. 반대 방향의 실패는 겹쳐 찍힌 시험지가 학생 손에 간다.
 *   (3) 풀 전체가 「모른다」면 등급이 균일해져 예전 결과와 **한 글자도 다르지 않다.**
 */
export function risksTightSeat(
  problem: SelectableProblem,
  slotPx: number,
): boolean {
  if (problem.content === undefined) return true;
  return assessSeat(
    {
      content: problem.content,
      figureUrls: problem.figureUrls,
      figureDims: problem.figureDims,
    },
    slotPx,
  ).risky;
}

export interface SelectProblemsArgs<
  T extends SelectableProblem = ProblemEntity,
> {
  pool: T[];
  difficultyRatio: DifficultyRatio;
  count: number;
  /** 최근 출제되어 후보에서 제외할 problemId 목록 — 날짜 판정은 호출자/excludeRecent가
   *  이미 끝낸 뒤 넘긴다(D-20). */
  recentProblemIds: string[];
  /** 결정론적 셔플·선택에 쓰이는 시드 — 같은 시드는 항상 같은 결과를 낸다. */
  seed: string;
}

export interface SelectProblemsResult<
  T extends SelectableProblem = ProblemEntity,
> {
  problems: T[];
  substitutions: SubstitutionRecord[];
  shortfall: ShortfallItem[];
}

/** 이 값을 넘겨 배치되면(3연속) 같은 유형이 반복 배치된 것으로 본다. */
const MAX_CONSECUTIVE_SAME_TYPE = 2;

export function selectProblems<T extends SelectableProblem>(
  args: SelectProblemsArgs<T>,
): SelectProblemsResult<T> {
  const { pool, difficultyRatio, count, recentProblemIds, seed } = args;

  const excludedIds = new Set(recentProblemIds);
  const candidates = pool.filter(
    (p) => !excludedIds.has(p.id) && p.directUseAllowed !== false,
  );
  const shuffled = seededShuffle(candidates, seed);

  /**
   * ⑷ — 「이어지는 장의 반 칸(484px)에 안 들어가는 문항」을 후순위로 돌린다.
   *
   * 왜 **이어지는 장**을 기준으로 삼나: 시험지 자리의 대부분이 그 칸이고, 좁은 첫 장
   * 자리(405px, 둘뿐)는 뒤의 ⑸-c 가 자리를 바꿔 따로 푼다. 여기서 405px 로 거르면
   * 405~484px 짜리(실측 풀의 상당수)가 통째로 후순위가 되어 풀이 크게 얇아진다.
   *
   * 한 문항을 여러 번 재게 되므로(난이도 tier 마다 후보를 훑는다) 판정을 기억해 둔다.
   */
  const seatMemo = new Map<string, number>();
  const seatRank = (problem: T): number => {
    const cached = seatMemo.get(problem.id);
    if (cached !== undefined) return cached;
    const rank = risksTightSeat(problem, JASEUP_MEASURED_PX.continuationSlot)
      ? 1
      : 0;
    seatMemo.set(problem.id, rank);
    return rank;
  };

  const { selected, substitutions, shortfall } = balanceDifficulty(
    shuffled,
    difficultyRatio,
    count,
    seatRank,
  );

  return {
    problems: arrangeByType(selected),
    substitutions,
    shortfall,
  };
}

/**
 * 같은 problemType이 `MAX_CONSECUTIVE_SAME_TYPE`(2)개를 초과해 연속 배치되지 않도록
 * 재배열한다. 매 단계 "직전 연속 조건을 어기지 않는" 유형 중 남은 개수가 가장 많은
 * 유형을 우선 배치하는 결정론적 그리디 방식이다(입력 순서 외 무작위성 없음).
 */
function arrangeByType<T extends SelectableProblem>(items: T[]): T[] {
  const byType = new Map<string, T[]>();
  for (const item of items) {
    const bucket = byType.get(item.problemType);
    if (bucket) bucket.push(item);
    else byType.set(item.problemType, [item]);
  }

  const result: T[] = [];
  while (result.length < items.length) {
    const lastTypes = result
      .slice(-MAX_CONSECUTIVE_SAME_TYPE)
      .map((p) => p.problemType);
    const wouldViolate = (type: string) =>
      lastTypes.length === MAX_CONSECUTIVE_SAME_TYPE &&
      lastTypes.every((t) => t === type);

    const remaining = [...byType.entries()].filter(
      ([, bucket]) => bucket.length > 0,
    );
    const eligible = remaining.filter(([type]) => !wouldViolate(type));
    const candidates = eligible.length > 0 ? eligible : remaining;

    candidates.sort((a, b) => b[1].length - a[1].length);
    const [type] = candidates[0]!;
    const bucket = byType.get(type)!;
    result.push(bucket.shift()!);
  }

  return result;
}
