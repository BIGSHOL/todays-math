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

import {
  balanceDifficulty,
  type SubstitutionRecord,
} from "./balanceDifficulty";
import { seededShuffle } from "./seededRandom";

export interface SelectProblemsArgs {
  pool: ProblemEntity[];
  difficultyRatio: DifficultyRatio;
  count: number;
  /** 최근 출제되어 후보에서 제외할 problemId 목록 — 날짜 판정은 호출자/excludeRecent가
   *  이미 끝낸 뒤 넘긴다(D-20). */
  recentProblemIds: string[];
  /** 결정론적 셔플·선택에 쓰이는 시드 — 같은 시드는 항상 같은 결과를 낸다. */
  seed: string;
}

export interface SelectProblemsResult {
  problems: ProblemEntity[];
  substitutions: SubstitutionRecord[];
  shortfall: ShortfallItem[];
}

/** 이 값을 넘겨 배치되면(3연속) 같은 유형이 반복 배치된 것으로 본다. */
const MAX_CONSECUTIVE_SAME_TYPE = 2;

export function selectProblems(args: SelectProblemsArgs): SelectProblemsResult {
  const { pool, difficultyRatio, count, recentProblemIds, seed } = args;

  const excludedIds = new Set(recentProblemIds);
  const candidates = pool.filter((p) => !excludedIds.has(p.id));
  const shuffled = seededShuffle(candidates, seed);

  const { selected, substitutions, shortfall } = balanceDifficulty(
    shuffled,
    difficultyRatio,
    count,
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
function arrangeByType(items: ProblemEntity[]): ProblemEntity[] {
  const byType = new Map<string, ProblemEntity[]>();
  for (const item of items) {
    const bucket = byType.get(item.problemType);
    if (bucket) bucket.push(item);
    else byType.set(item.problemType, [item]);
  }

  const result: ProblemEntity[] = [];
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
