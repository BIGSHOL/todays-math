/**
 * 🟢 GREEN — Phase 2, T2.2 (진도 해석 순수 함수)
 *
 * src/lib/progressResolver.ts는 DB/AI에 의존하지 않는다. T4.2 출제 API가 같은
 * getCurrentProgress()로 "현재 진도"를 판정하므로, 반/개별 이중 구조와 최신 판정
 * 규칙을 여기서 고정한다.
 */
import { describe, expect, it } from "vitest";

import {
  findLatestProgress,
  getCurrentProgress,
  nextOrderIndex,
  prevOrderIndex,
  type ProgressRecordLike,
} from "@/lib/progressResolver";
import {
  MOCK_CURRENT_PROGRESS,
  MOCK_PROGRESS_CLASS_A,
  MOCK_PROGRESS_STUDENT_3,
} from "@/mocks/data";

function record(
  overrides: Partial<ProgressRecordLike> & Pick<ProgressRecordLike, "id">,
): ProgressRecordLike {
  return {
    classId: "class-a",
    studentId: null,
    unitId: "unit-a",
    recordedAt: "2026-08-01",
    createdAt: "2026-08-01T09:00:00Z",
    ...overrides,
  };
}

describe("[T2.2] findLatestProgress", () => {
  it("빈 배열이면 null을 반환한다", () => {
    expect(findLatestProgress([])).toBeNull();
  });

  it("recordedAt이 더 늦은 행을 최신으로 고른다", () => {
    const latest = findLatestProgress(MOCK_PROGRESS_CLASS_A);
    expect(latest?.id).toBe(MOCK_CURRENT_PROGRESS.classA.id);
  });

  it("recordedAt이 같으면 createdAt이 더 늦은 행을 최신으로 고른다", () => {
    const older = record({
      id: "older",
      recordedAt: "2026-08-01",
      createdAt: "2026-08-01T09:00:00Z",
    });
    const newer = record({
      id: "newer",
      recordedAt: "2026-08-01",
      createdAt: "2026-08-01T18:00:00Z",
    });
    expect(findLatestProgress([older, newer])?.id).toBe("newer");
    expect(findLatestProgress([newer, older])?.id).toBe("newer");
  });
});

describe("[T2.2] getCurrentProgress — 반/개별 이중 구조", () => {
  it("이력이 없으면 null을 반환한다", () => {
    expect(
      getCurrentProgress({
        classProgress: [],
        studentProgress: [],
      }),
    ).toBeNull();
  });

  it("개별 진도를 쓰지 않으면 반 최신 진도를 반환한다", () => {
    const current = getCurrentProgress({
      classProgress: MOCK_PROGRESS_CLASS_A,
      studentProgress: MOCK_PROGRESS_STUDENT_3,
      useIndividualProgress: false,
    });
    expect(current?.id).toBe(MOCK_CURRENT_PROGRESS.classA.id);
  });

  it("useIndividualProgress=true이면 개별 진도가 반 진도보다 우선한다", () => {
    const current = getCurrentProgress({
      classProgress: MOCK_PROGRESS_CLASS_A,
      studentProgress: MOCK_PROGRESS_STUDENT_3,
      useIndividualProgress: true,
    });
    expect(current?.id).toBe(MOCK_CURRENT_PROGRESS.student3.id);
  });

  it("개별 진도 플래그가 켜져 있어도 개별 이력이 없으면 반 진도로 폴백한다", () => {
    const current = getCurrentProgress({
      classProgress: MOCK_PROGRESS_CLASS_A,
      studentProgress: [],
      useIndividualProgress: true,
    });
    expect(current?.id).toBe(MOCK_CURRENT_PROGRESS.classA.id);
  });
});

describe("[T2.2] nextOrderIndex — 1클릭 진행(D-19)", () => {
  it("전역 연속 orderIndex의 다음 값을 반환한다", () => {
    expect(nextOrderIndex(416)).toBe(417);
  });

  it("이전 orderIndex를 반환한다", () => {
    expect(prevOrderIndex(416)).toBe(415);
  });
});
