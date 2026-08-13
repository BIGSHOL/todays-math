/**
 * 난이도 배분 — 요청된 difficultyRatio에 맞춰 pool에서 문제를 선정하는 순수 함수.
 *
 * - 목표 난이도의 후보가 부족하면 인접 난이도(easy↔mid, mid↔hard)에서 대체하고
 *   substitutions에 그 사실을 기록한다(easy↔hard 직접 대체는 하지 않는다).
 * - 대체로도 못 채우면 조용히 넘어가지 않고 shortfall에 기록한다 — 계약
 *   test.contract.ts의 shortfallItemSchema 형태(unitId/difficulty/available/required).
 * - 유형(problemType) 편중을 줄이기 위해 선택 시점부터 유형 사용 빈도가 낮은 문제를
 *   우선한다 — 최종적인 "3연속 배치 방지" 보장 자체는 selectProblems의 arrangeByType이
 *   담당하고, 여기서는 그 보장이 가능하도록 구성을 미리 고르게 만드는 역할만 한다.
 *
 * 참조: docs/planning/06-tasks.md T4.1, sumaek packages/core/src/assessment/select.ts
 *       (결정론적 선택 + shortfall 보고 아이디어 참조 — 그대로 복사가 아닌 재구성)
 */
import type { Difficulty, DifficultyRatio } from "@/contracts/common.contract";
import type { ProblemEntity } from "@/contracts/problem.contract";
import type { ShortfallItem } from "@/contracts/test.contract";

export interface SubstitutionRecord {
  requestedDifficulty: Difficulty;
  substitutedDifficulty: Difficulty;
  problemId: string;
}

export interface BalanceDifficultyResult {
  selected: ProblemEntity[];
  substitutions: SubstitutionRecord[];
  shortfall: ShortfallItem[];
}

const DIFFICULTY_ORDER: Difficulty[] = ["easy", "mid", "hard"];

/** 난이도별 인접 대체 우선순위 — 한 단계 차이만 허용한다(easy↔hard 직접 대체 없음). */
const ADJACENT_DIFFICULTY: Record<Difficulty, Difficulty[]> = {
  easy: ["mid"],
  mid: ["easy", "hard"],
  hard: ["mid"],
};

function groupByDifficulty(
  pool: ProblemEntity[],
): Record<Difficulty, ProblemEntity[]> {
  const grouped: Record<Difficulty, ProblemEntity[]> = {
    easy: [],
    mid: [],
    hard: [],
  };
  for (const problem of pool) {
    grouped[problem.difficulty].push(problem);
  }
  return grouped;
}

/**
 * 후보 목록에서 유형 사용 빈도가 가장 낮은 문제부터 최대 `target`개를 뽑는다.
 * 동률이면 후보 목록 순서(호출자가 이미 시드로 셔플해 넘긴 순서)를 그대로 지킨다.
 */
function pickTypeBalanced(
  candidates: ProblemEntity[],
  target: number,
  typeUsage: Map<string, number>,
): ProblemEntity[] {
  const remaining = [...candidates];
  const picked: ProblemEntity[] = [];

  while (picked.length < target && remaining.length > 0) {
    let bestIndex = 0;
    let bestUsage = typeUsage.get(remaining[0]!.problemType) ?? 0;
    for (let i = 1; i < remaining.length; i++) {
      const usage = typeUsage.get(remaining[i]!.problemType) ?? 0;
      if (usage < bestUsage) {
        bestUsage = usage;
        bestIndex = i;
      }
    }
    const [chosen] = remaining.splice(bestIndex, 1);
    picked.push(chosen!);
    typeUsage.set(
      chosen!.problemType,
      (typeUsage.get(chosen!.problemType) ?? 0) + 1,
    );
  }

  return picked;
}

export function balanceDifficulty(
  pool: ProblemEntity[],
  ratio: DifficultyRatio,
  count: number,
): BalanceDifficultyResult {
  const grouped = groupByDifficulty(pool);
  const selectedIds = new Set<string>();
  const selected: ProblemEntity[] = [];
  const substitutions: SubstitutionRecord[] = [];
  const shortfall: ShortfallItem[] = [];
  const typeUsage = new Map<string, number>();
  // shortfall.unitId는 이 함수가 아는 유일한 단원 정보(pool[0])로 채운다 — 이 엔진은
  // 여러 단원이 섞인 범위 pool을 그대로 받을 수 있어 완벽한 단원별 귀속은 상위(T4.2
  // API 계층)가 단원별로 나눠 호출할 때 정확해진다.
  const fallbackUnitId = pool[0]?.unitId ?? "";

  for (const difficulty of DIFFICULTY_ORDER) {
    const target = ratio[difficulty] ?? 0;
    if (target <= 0) continue;

    const primaryCandidates = grouped[difficulty].filter(
      (p) => !selectedIds.has(p.id),
    );
    const picked = pickTypeBalanced(primaryCandidates, target, typeUsage);
    for (const p of picked) {
      selected.push(p);
      selectedIds.add(p.id);
    }
    let stillNeeded = target - picked.length;

    for (const altDifficulty of ADJACENT_DIFFICULTY[difficulty]) {
      if (stillNeeded <= 0) break;
      const altCandidates = grouped[altDifficulty].filter(
        (p) => !selectedIds.has(p.id),
      );
      const altPicked = pickTypeBalanced(altCandidates, stillNeeded, typeUsage);
      for (const p of altPicked) {
        selected.push(p);
        selectedIds.add(p.id);
        substitutions.push({
          requestedDifficulty: difficulty,
          substitutedDifficulty: altDifficulty,
          problemId: p.id,
        });
      }
      stillNeeded -= altPicked.length;
    }

    if (stillNeeded > 0) {
      shortfall.push({
        unitId: fallbackUnitId,
        difficulty,
        available: grouped[difficulty].length,
        required: target,
      });
    }
  }

  // count는 방어적 상한이다 — ratio 합이 count와 정확히 같은 정상 경로에서는 아무것도
  // 잘려 나가지 않는다(각 난이도 tier가 target을 넘지 않게 선정하므로 selected.length는
  // 항상 sum(ratio) 이하다).
  return { selected: selected.slice(0, count), substitutions, shortfall };
}
