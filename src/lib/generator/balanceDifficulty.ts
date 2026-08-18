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

/**
 * 출제 엔진이 문항에 대해 **실제로 읽는 것 전부**.
 *
 * 앞의 다섯은 배분·자격이 읽고, 뒤의 셋은 **지면**이 읽는다(⑷, 2026-08-18 원장님 확정).
 * 예전에는 뒤의 셋이 아예 없어서 출제 엔진이 「이 문항이 칸에 안 들어간다」를
 * **구조적으로 알 수가 없었다** — 25문항 시험지의 89%에 넘침 경고가 떴다
 * (적대적 리뷰 ④ §8 G). 판정은 아는데 고르는 쪽이 못 보던 자리다.
 *
 * 뒤의 셋이 **선택(optional)인 이유**: 이 셋 없이 부르는 호출부(단위 테스트·
 * 지면과 무관한 조합)를 그대로 두기 위해서다. 없으면 엔진은 그 문항의 높이를
 * 「모른다」로 받고 **후순위**로 돌린다 — 「모른다」를 «들어간다»로 세면 정책이
 * 조용히 꺼지기 때문이다(`selectProblems` 의 `risksTightSeat` 주석 참조).
 */
export interface SelectableProblem {
  id: string;
  /** shortfall 보고의 단원 귀속에만 쓴다. */
  unitId: string;
  difficulty: Difficulty;
  problemType: string;
  /** false 면 변형 원본 전용 — 직접 출제하지 않는다(D-26). */
  directUseAllowed: boolean;
  /** 본문 — 지면에서 몇 줄을 먹는지 재는 근거(`estimateProblemPx`). */
  content?: string;
  /** 그림 경로들. 개수가 곧 `figureDims` 의 짝 수다. */
  figureUrls?: string[];
  /** `figureUrls` 와 같은 순서로 짝지은 원본 치수 `[w1,h1,…]`. 짝이 어긋나면 «모른다». */
  figureDims?: number[];
}

export interface SubstitutionRecord {
  requestedDifficulty: Difficulty;
  substitutedDifficulty: Difficulty;
  problemId: string;
}

export interface BalanceDifficultyResult<
  T extends SelectableProblem = ProblemEntity,
> {
  selected: T[];
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

function groupByDifficulty<T extends SelectableProblem>(
  pool: T[],
): Record<Difficulty, T[]> {
  const grouped: Record<Difficulty, T[]> = {
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
 * 후보 목록에서 **⑴ 지면 칸에 들어가는 것 → ⑵ 유형 사용 빈도가 낮은 것** 순으로
 * 최대 `target`개를 뽑는다. 동률이면 후보 목록 순서(호출자가 이미 시드로 셔플해
 * 넘긴 순서)를 그대로 지킨다.
 *
 * ## 왜 지면이 유형보다 앞인가 (⑷)
 *
 * 「같은 유형 3연속 금지」의 **보장 자체**는 `arrangeByType` 이 나중에 따로 한다.
 * 여기서 유형 빈도를 보는 것은 그 보장이 가능하도록 **구성을 미리 고르게 만드는**
 * 보조 규칙일 뿐이라, 앞에 지면을 두어도 그 보장은 그대로다.
 * 반대로 지면을 뒤에 두면 정책이 거의 안 듣는다 — 「아직 안 쓴 유형」 하나만 있으면
 * 안 들어가는 문항이 그대로 뽑힌다.
 *
 * ⚠️ **제외가 아니라 후순위다.** 들어가는 후보가 떨어지면 안 들어가는 것도 그대로
 *    뽑는다. 얇은 단원에서 출제가 막히면 안 된다(D-20 · `INSUFFICIENT_PROBLEMS`).
 */
function pickTypeBalanced<T extends SelectableProblem>(
  candidates: T[],
  target: number,
  typeUsage: Map<string, number>,
  seatRank: (problem: T) => number,
): T[] {
  const remaining = [...candidates];
  const picked: T[] = [];

  while (picked.length < target && remaining.length > 0) {
    let bestIndex = 0;
    let bestRank = seatRank(remaining[0]!);
    let bestUsage = typeUsage.get(remaining[0]!.problemType) ?? 0;
    for (let i = 1; i < remaining.length; i++) {
      const rank = seatRank(remaining[i]!);
      const usage = typeUsage.get(remaining[i]!.problemType) ?? 0;
      if (usage < bestUsage || (usage === bestUsage && rank < bestRank)) {
        bestRank = rank;
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

export function balanceDifficulty<T extends SelectableProblem>(
  pool: T[],
  ratio: DifficultyRatio,
  count: number,
  /**
   * 「이 문항이 지면 칸에 안 들어가는가」 — 0이 먼저, 1이 나중이다(⑷).
   * 규칙은 `selectProblems` 가 넘긴다. 이 모듈은 **판정을 스스로 만들지 않는다** —
   * 만들면 인쇄 판정과 두 벌이 되고, 한쪽만 고쳐도 아무도 모른다(리뷰 §A).
   * 생략하면 전부 0이라 예전과 한 글자도 다르지 않다.
   */
  seatRank: (problem: T) => number = () => 0,
): BalanceDifficultyResult<T> {
  const grouped = groupByDifficulty(pool);
  const selectedIds = new Set<string>();
  const selected: T[] = [];
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
    const picked = pickTypeBalanced(
      primaryCandidates,
      target,
      typeUsage,
      seatRank,
    );
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
      const altPicked = pickTypeBalanced(
        altCandidates,
        stillNeeded,
        typeUsage,
        seatRank,
      );
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
