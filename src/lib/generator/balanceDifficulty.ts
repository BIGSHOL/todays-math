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
 * 앞의 다섯은 배분·자격이 읽고, 뒤의 넷은 **지면**이 읽는다(⑷, 2026-08-18 · mm 은 2026-08-20).
 * 예전에는 뒤의 셋이 아예 없어서 출제 엔진이 「이 문항이 칸에 안 들어간다」를
 * **구조적으로 알 수가 없었다** — 25문항 시험지의 89%에 넘침 경고가 떴다
 * (적대적 리뷰 ④ §8 G). 판정은 아는데 고르는 쪽이 못 보던 자리다.
 *
 * 뒤의 넷이 **선택(optional)인 이유**: 이 넷 없이 부르는 호출부(단위 테스트·
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
  /**
   * `figureUrls` 와 같은 순서·같은 길이의 원본 지면 물리 폭(mm).
   * 자와 지면이 쓰는 `parseFigureDimensions` 의 세 번째 인자.
   * 없으면 오늘처럼 픽셀로 잰다. **넘기지 않으면 출제만 옛 크기로 고른다.**
   */
  figureSourceMm?: number[];
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
 * 후보 목록에서 **⑴ 지면 칸에 들어가는 것 → ⑵ 단원·유형을 통틀어 제일 덜 쓴 것**
 * 순으로 최대 `target`개를 뽑는다. ⑵ 가 같으면 **단원을 덜 쓴 쪽**, 그것도 같으면
 * 후보 목록 순서(호출자가 이미 시드로 셔플해 넘긴 순서)를 그대로 지킨다.
 *
 * ## 왜 지면이 맨 앞인가 (⑷ · D-52)
 *
 * 「같은 유형 3연속 금지」의 **보장 자체**는 `arrangeByType` 이 나중에 따로 한다.
 * 여기서 유형 빈도를 보는 것은 그 보장이 가능하도록 **구성을 미리 고르게 만드는**
 * 보조 규칙일 뿐이라, 앞에 지면을 두어도 그 보장은 그대로다.
 * 반대로 지면을 뒤에 두면 정책이 거의 안 듣는다 — 「아직 안 쓴 유형」 하나만 있으면
 * 안 들어가는 문항이 그대로 뽑힌다. 원장님이 2026-08-18 지면 우선으로 확정했다.
 *
 * ## 왜 단원과 유형을 **합쳐서** 보나 (D-54, 2026-08-19 원장님 확정)
 *
 * 확인테스트는 여러 단원을 묶어 누적 점검을 하는데, 엔진이 단원을 안 보면 뽑힐
 * 확률이 **단원의 재고에 비례**한다 — 그 재고가 1건 대 736건까지 벌어져 있다.
 * 그래서 10단원 범위 8문항이 평균 4.5단원에서만 나왔다.
 *
 * 네 가지 규칙을 같은 시드·같은 범위로 실측했다(`scripts/qa/measure-review-spread.ts`.
 * 상세는 `docs/planning/tracks/reports/review-spread.md` · `adv-확인테스트.md`).
 * 아래는 **넓힌 표본**이다 — 학년 중간에서 시작하는 범위와 **2회차**(D-20 으로 지난
 * 회차 문항이 빠진 뒤)를 포함한 116개 조합 × 시드 30개:
 *
 * | 규칙 | 단원 커버리지 | 단원 최다몫 | 유형 최다몫 |
 * |---|---|---|---|
 * | 단원 안 봄(예전) | 66.4% | 46.0% | 36.8% |
 * | 단원 → 유형 | 98.0% | 21.8% | 43.4% |
 * | **합산 (채택)** | **96.1%** | **23.9%** | **39.7%** |
 *
 * ⚠️ **평균 뒤에 최저가 있다.** 조합별 최저 커버리지는 **55%**(중1 앞 10단원 8문항)이고,
 *    커버리지가 100% 인데 한 단원이 80% 인 조합도 있다(범위에 문항 있는 단원이 둘뿐이라
 *    «최대치»가 2다 — 분모가 작아지면 커버리지는 포화된다). 처음 보고서는 학년 앞부분·
 *    1회차만 재고 「95.9%」라고 적었다(적대적 리뷰 2026-08-19).
 *
 * 우선순위를 매기면 **뒤에 놓인 쪽이 그만큼 나빠진다.** 합산은 둘 중 무엇이 먼저인지
 * 정하지 않고 「이 시험지에서 제일 덜 쓴 것」을 고른다 — 커버리지의 대부분을 얻으면서
 * 유형 편중은 덜 는다. 합이 같으면 단원을 앞세우는데, 그 자리에서는 **유형을 한 칸
 * 양보한다**(합이 같다는 것은 한쪽이 크면 다른 쪽이 작다는 뜻이다).
 *
 * 그리고 이 규칙이 실제로 갈라 주는 것은 **확인테스트**뿐이다: 일일테스트는 풀의
 * 단원이 하나라 `unitUsage` 가 모든 후보에게 같은 값이라, 합이 유형 빈도만으로 갈려
 * 예전과 **한 글자도 다르지 않다**(`selectSpreadsUnits.test.ts` 가 정책 이전 실측
 * 순서로 잠근다).
 *
 * ⚠️ **제외가 아니라 후순위다.** 들어가는 후보가 떨어지면 안 들어가는 것도 그대로
 *    뽑는다. 얇은 단원에서 출제가 막히면 안 된다(D-20 · `INSUFFICIENT_PROBLEMS`).
 *    같은 이유로 **난이도 tier 안에서만** 고른다 — 단원을 고루 하려고 난이도를
 *    대체하지는 않는다.
 */
function pickTypeBalanced<T extends SelectableProblem>(
  candidates: T[],
  target: number,
  typeUsage: Map<string, number>,
  unitUsage: Map<string, number>,
  seatRank: (problem: T) => number,
): T[] {
  const remaining = [...candidates];
  const picked: T[] = [];

  while (picked.length < target && remaining.length > 0) {
    let bestIndex = 0;
    let bestRank = seatRank(remaining[0]!);
    let bestUnit = unitUsage.get(remaining[0]!.unitId) ?? 0;
    let bestType = typeUsage.get(remaining[0]!.problemType) ?? 0;
    for (let i = 1; i < remaining.length; i++) {
      const rank = seatRank(remaining[i]!);
      const unit = unitUsage.get(remaining[i]!.unitId) ?? 0;
      const type = typeUsage.get(remaining[i]!.problemType) ?? 0;
      // 지면이 갈리면 뒤는 안 본다(D-52). 그다음은 **단원+유형 합**이고, 합이 같을
      // 때만 단원을 앞세운다. 셋이 다 같으면 후보 순서(시드 셔플)를 그대로 지킨다.
      const better =
        rank !== bestRank
          ? rank < bestRank
          : unit + type !== bestUnit + bestType
            ? unit + type < bestUnit + bestType
            : unit < bestUnit;
      if (better) {
        bestRank = rank;
        bestUnit = unit;
        bestType = type;
        bestIndex = i;
      }
    }
    const [chosen] = remaining.splice(bestIndex, 1);
    picked.push(chosen!);
    typeUsage.set(
      chosen!.problemType,
      (typeUsage.get(chosen!.problemType) ?? 0) + 1,
    );
    unitUsage.set(chosen!.unitId, (unitUsage.get(chosen!.unitId) ?? 0) + 1);
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
  /** 이 시험지에서 각 단원을 몇 개 썼는가 — 난이도 tier 를 가로질러 이어진다. */
  const unitUsage = new Map<string, number>();
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
      unitUsage,
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
        unitUsage,
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
