/**
 * 🔴 RED — 대응 구현 태스크: Phase 4, T4.1 (출제 엔진 순수 함수 RED→GREEN, ★ 프로젝트의 심장)
 *
 * `src/lib/generator/*.ts`가 아직 존재하지 않으므로(현재 `src/lib/generator/.gitkeep`만 있음)
 * 아래 import들은 런타임에 모듈 해석에 실패해 이 파일 전체가 FAILED로 보고된다 — RED의 정상
 * 상태다. (`@ts-expect-error` 사용 이유는 src/__tests__/api/auth.test.ts 상단 주석 참조.)
 *
 * 이 엔진은 **순수 함수**여야 한다(DB/AI import 없음, 06-tasks.md T4.1 인수 조건) — 그래서
 * 모든 테스트가 네트워크/DB 없이 인메모리 픽스처(주로 src/mocks/data)만으로 검증된다.
 *
 * 참조: docs/planning/06-tasks.md T0.5.3 + T4.1, sumaek packages/core/src/assessment/select.ts
 *       (결정론적 선택 — 같은 풀·정책·시드 → 같은 결과, shortfall 투명 보고),
 *       src/contracts/test.contract.ts (shortfallItemSchema, insufficientProblemsDetailSchema)
 */
import { describe, expect, it } from "vitest";

// @ts-expect-error TODO(T4.1) — src/lib/generator/selectProblems.ts 구현 전까지 모듈이 없다.
import { selectProblems } from "@/lib/generator/selectProblems";
// @ts-expect-error TODO(T4.1) — src/lib/generator/balanceDifficulty.ts 구현 전까지 모듈이 없다.
import { balanceDifficulty } from "@/lib/generator/balanceDifficulty";
// @ts-expect-error TODO(T4.1) — src/lib/generator/excludeRecent.ts 구현 전까지 모듈이 없다.
import { excludeRecent } from "@/lib/generator/excludeRecent";
// @ts-expect-error TODO(T4.1) — src/lib/generator/resolveRange.ts 구현 전까지 모듈이 없다.
import { resolveRange } from "@/lib/generator/resolveRange";

import type { ProblemEntity } from "@/contracts/problem.contract";
import {
  MOCK_CURRENT_PROGRESS_UNIT,
  MOCK_PROBLEMS,
  MOCK_PROBLEMS_BY_UNIT,
  MOCK_REVIEW_RANGE_END_UNIT,
  MOCK_REVIEW_RANGE_START_UNIT,
  MOCK_UNITS,
  MOCK_UNITS_SUWASIK,
} from "@/mocks/data";

// "수와 식" 8개 차시(24문항, 난이도별 8/8/8 = easy/mid/hard 균등) — 배분 테스트용 풀.
const BALANCED_POOL = MOCK_UNITS_SUWASIK.flatMap(
  (u) => MOCK_PROBLEMS_BY_UNIT[u.id] ?? [],
);

// ⚠️ 아래 결과 타입들은 T4.1 구현이 아직 없어 import된 함수가 전부 `any`로 취급되는 데서 오는
// implicit-any 연쇄를 막기 위한 "기대 응답 형태" 문서화용 캐스트다 — 실제 구현 시그니처를
// 강제하지 않으며, T4.1 담당자가 이 형태를 참고해 자유롭게 구체화하면 된다.
interface ShortfallItem {
  unitId: string;
  difficulty: string;
  available: number;
  required: number;
}
interface BalanceDifficultyResult {
  selected: ProblemEntity[];
  substitutions: unknown[];
  shortfall: ShortfallItem[];
}
interface SelectProblemsResult {
  problems: ProblemEntity[];
  shortfall: ShortfallItem[];
}
interface ResolveRangeResult {
  unitIds: string[];
}

describe("[T4.1] 난이도 배분 (balanceDifficulty)", () => {
  it("8문항 요청(easy:3, mid:4, hard:1)이 요청 배분을 그대로 채운다", () => {
    const result = balanceDifficulty(
      BALANCED_POOL,
      { easy: 3, mid: 4, hard: 1 },
      8,
    ) as BalanceDifficultyResult;
    const counts = { easy: 0, mid: 0, hard: 0 };
    for (const p of result.selected) counts[p.difficulty]++;
    expect(counts).toEqual({ easy: 3, mid: 4, hard: 1 });
    expect(result.selected).toHaveLength(8);
  });

  it("특정 난이도가 부족하면 인접 난이도로 대체하고 그 사실을 보고한다", () => {
    // hard 문항이 1개뿐인 풀에서 hard:3을 요청하면 2개는 인접(mid)으로 대체되어야 한다.
    const scarcePool = MOCK_PROBLEMS.filter(
      (p) => p.difficulty !== "hard" || p.id === MOCK_PROBLEMS[2]!.id,
    );
    const result = balanceDifficulty(
      scarcePool,
      { easy: 0, mid: 0, hard: 3 },
      3,
    ) as BalanceDifficultyResult;
    expect(result.selected).toHaveLength(3);
    expect(result.substitutions.length).toBeGreaterThan(0);
  });

  it("모든 난이도가 심각하게 부족하면 부족분을 조용히 채우지 않고 shortfall로 보고한다", () => {
    const tinyPool = MOCK_PROBLEMS.slice(0, 2);
    const result = balanceDifficulty(
      tinyPool,
      { easy: 3, mid: 4, hard: 1 },
      8,
    ) as BalanceDifficultyResult;
    expect(result.selected.length).toBeLessThan(8);
    expect(result.shortfall.length).toBeGreaterThan(0);
  });
});

describe("[T4.1] 유형 배분 — 같은 유형 연속 배치 방지 (selectProblems)", () => {
  it("선정된 문항 목록에서 같은 problemType이 3개 연속으로 배치되지 않는다", () => {
    const { problems } = selectProblems({
      pool: BALANCED_POOL,
      difficultyRatio: { easy: 3, mid: 4, hard: 1 },
      count: 8,
      recentProblemIds: [],
      seed: "test-seed-1",
    }) as SelectProblemsResult;
    let streak = 1;
    for (let i = 1; i < problems.length; i++) {
      streak =
        problems[i].problemType === problems[i - 1].problemType
          ? streak + 1
          : 1;
      expect(streak).toBeLessThan(3);
    }
  });
});

describe("[T4.1] 최근 14일 중복 제외 (excludeRecent, D-20)", () => {
  it("최근 14일 이내 출제된 문제는 후보 풀에서 제외된다", () => {
    const recentIds = [MOCK_PROBLEMS[0]!.id, MOCK_PROBLEMS[1]!.id];
    const result = excludeRecent(MOCK_PROBLEMS, recentIds, {
      today: "2026-08-13",
      windowDays: 14,
    }) as ProblemEntity[];
    expect(result.some((p) => recentIds.includes(p.id))).toBe(false);
  });

  it("14일보다 이전에 출제된 문제는 다시 후보가 될 수 있다", () => {
    // excludeRecent는 "최근 출제 이력(problemId + testDate) 목록"을 받아 windowDays 이내인
    // 것만 제외한다 — 호출자(API 계층, T4.2)가 D-20 기준일 계산을 넘겨준다.
    const result = excludeRecent(
      MOCK_PROBLEMS,
      [{ problemId: MOCK_PROBLEMS[0]!.id, testDate: "2026-07-01" }],
      { today: "2026-08-13", windowDays: 14 },
    ) as ProblemEntity[];
    expect(result.some((p) => p.id === MOCK_PROBLEMS[0]!.id)).toBe(true);
  });
});

describe("[T4.1] 범위 계산 (resolveRange)", () => {
  it("daily는 현재 진도 소단원 하나만 범위로 결정한다", () => {
    const range = resolveRange({
      testType: "daily",
      currentProgressUnitId: MOCK_CURRENT_PROGRESS_UNIT.id,
      units: MOCK_UNITS,
    }) as ResolveRangeResult;
    expect(range.unitIds).toEqual([MOCK_CURRENT_PROGRESS_UNIT.id]);
  });

  it("review는 시작~끝 unit의 orderIndex 구간 전체를 범위로 결정한다", () => {
    const range = resolveRange({
      testType: "review",
      rangeStartUnitId: MOCK_REVIEW_RANGE_START_UNIT.id,
      rangeEndUnitId: MOCK_REVIEW_RANGE_END_UNIT.id,
      units: MOCK_UNITS,
    }) as ResolveRangeResult;
    expect(range.unitIds).toHaveLength(
      MOCK_REVIEW_RANGE_END_UNIT.orderIndex -
        MOCK_REVIEW_RANGE_START_UNIT.orderIndex +
        1,
    );
    expect(range.unitIds).toContain(MOCK_REVIEW_RANGE_START_UNIT.id);
    expect(range.unitIds).toContain(MOCK_REVIEW_RANGE_END_UNIT.id);
  });
});

describe("[T4.1] 문제 부족 판정 (INSUFFICIENT_PROBLEMS)", () => {
  it("가용 문제 수가 필요 수보다 적으면 unitId/available/required를 포함해 보고한다", () => {
    const tinyPool = MOCK_PROBLEMS.slice(0, 2);
    const result = selectProblems({
      pool: tinyPool,
      difficultyRatio: { easy: 3, mid: 4, hard: 1 },
      count: 8,
      recentProblemIds: [],
      seed: "test-seed-2",
    }) as SelectProblemsResult;
    expect(result.shortfall[0]).toMatchObject({
      unitId: expect.any(String),
      available: expect.any(Number),
      required: expect.any(Number),
    });
  });
});

describe("[T4.1] 결정론 — 같은 시드는 같은 결과를 반환한다", () => {
  it("같은 pool/정책/시드로 두 번 호출하면 완전히 같은 문제 목록을 반환한다", () => {
    const args = {
      pool: BALANCED_POOL,
      difficultyRatio: { easy: 3, mid: 4, hard: 1 },
      count: 8,
      recentProblemIds: [],
      seed: "deterministic-seed",
    };
    const first = selectProblems(args) as SelectProblemsResult;
    const second = selectProblems(args) as SelectProblemsResult;
    expect(second.problems.map((p) => p.id)).toEqual(
      first.problems.map((p) => p.id),
    );
  });

  it("다른 시드를 쓰면 결과가 달라질 수 있다(완전히 동일하지 않음을 확인)", () => {
    const base = {
      pool: BALANCED_POOL,
      difficultyRatio: { easy: 3, mid: 4, hard: 1 },
      count: 8,
      recentProblemIds: [],
    };
    const a = selectProblems({
      ...base,
      seed: "seed-a",
    }) as SelectProblemsResult;
    const b = selectProblems({
      ...base,
      seed: "seed-b",
    }) as SelectProblemsResult;
    expect(a.problems.map((p) => p.id)).not.toEqual(
      b.problems.map((p) => p.id),
    );
  });
});

describe("[D-26] RPM 원본 잠금 — directUseAllowed=false 문항 제외", () => {
  // ⚠️ Problem.directUseAllowed 필드는 T3.0(스키마 마이그레이션)에서 추가된다 — 현재
  // src/contracts/problem.contract.ts와 prisma/schema.prisma 어디에도 없다(problem.contract.ts
  // 상단 주석 참조). 그래서 여기서는 계약 스키마가 아닌 "픽스처 객체 레벨"(원시 객체 리터럴)로만
  // 케이스를 남기고, 실행 가능한 단언은 T3.0 완료 후 작성한다(it.todo).
  it.todo(
    "directUseAllowed=false인 문항(RPM 원본)은 출제 후보 풀에서 제외된다 — T3.0 스키마 보강 후 활성화",
  );
});
