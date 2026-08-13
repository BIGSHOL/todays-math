/**
 * Mock 진도(Progress) 픽스처 (T0.5.2) — 이력 누적(append-only) 구조를 그대로 재현한다.
 *
 * 대응 API 경로: POST/GET /api/progress, POST /api/progress/advance
 * (src/contracts/class.contract.ts §진도)
 *
 * 시나리오:
 *   - 반 A(CLASS_A_ID)는 4회에 걸쳐 진도가 나갔고 현재(최신) 진도는
 *     MOCK_CURRENT_PROGRESS_UNIT(orderIndex 416, "순환소수를 포함한 식의 계산")이다.
 *   - 반 B(CLASS_B_ID)는 2회만 진도가 나갔고 현재 진도는 orderIndex 414("순환소수")이다.
 *   - 반 A의 학생 3(MOCK_STUDENT_3, useIndividualProgress=true)은 반보다 앞서
 *     orderIndex 418("단항식의 곱셈과 나눗셈")까지 개별 진도가 나갔다 — 개별 진도 우선 적용
 *     (use_individual_progress) 테스트 전용.
 */
import type { ProgressEntity } from "@/contracts/class.contract";

import {
  CLASS_A_ID,
  CLASS_B_ID,
  CLASS_STARVED_ID,
  progressId,
  STUDENT_IDS,
} from "./ids";
import { MOCK_EMPTY_PROBLEM_UNIT, MOCK_UNITS } from "./units";

const STUDENT_3_ID = STUDENT_IDS[2]!;

// ── 반 A(CLASS_A_ID) — 반 전체 진도 이력 (studentId: null) ─────
export const MOCK_PROGRESS_CLASS_A: ProgressEntity[] = [
  {
    id: progressId(1),
    classId: CLASS_A_ID,
    studentId: null,
    unitId: MOCK_UNITS[0]!.id, // 413 유리수와 소수
    recordedAt: "2026-06-05",
    createdAt: "2026-06-05T09:00:00Z",
  },
  {
    id: progressId(2),
    classId: CLASS_A_ID,
    studentId: null,
    unitId: MOCK_UNITS[1]!.id, // 414 순환소수
    recordedAt: "2026-06-20",
    createdAt: "2026-06-20T09:00:00Z",
  },
  {
    id: progressId(3),
    classId: CLASS_A_ID,
    studentId: null,
    unitId: MOCK_UNITS[2]!.id, // 415 순환소수의 분수 표현
    recordedAt: "2026-07-10",
    createdAt: "2026-07-10T09:00:00Z",
  },
  {
    id: progressId(4),
    classId: CLASS_A_ID,
    studentId: null,
    unitId: MOCK_UNITS[3]!.id, // 416 순환소수를 포함한 식의 계산 (현재 진도)
    recordedAt: "2026-08-01",
    createdAt: "2026-08-01T09:00:00Z",
  },
];

// ── 반 A(CLASS_A_ID) — 학생 3 개별 진도 (반보다 앞서감) ─────────
export const MOCK_PROGRESS_STUDENT_3: ProgressEntity[] = [
  {
    id: progressId(5),
    classId: CLASS_A_ID,
    studentId: STUDENT_3_ID,
    unitId: MOCK_UNITS[5]!.id, // 418 단항식의 곱셈과 나눗셈 (반 진도보다 2차시 앞섬)
    recordedAt: "2026-07-20",
    createdAt: "2026-07-20T09:00:00Z",
  },
];

// ── 반 B(CLASS_B_ID) — 반 전체 진도 이력 ─────────────────────
export const MOCK_PROGRESS_CLASS_B: ProgressEntity[] = [
  {
    id: progressId(6),
    classId: CLASS_B_ID,
    studentId: null,
    unitId: MOCK_UNITS[0]!.id, // 413 유리수와 소수
    recordedAt: "2026-06-10",
    createdAt: "2026-06-10T09:00:00Z",
  },
  {
    id: progressId(7),
    classId: CLASS_B_ID,
    studentId: null,
    unitId: MOCK_UNITS[1]!.id, // 414 순환소수 (현재 진도)
    recordedAt: "2026-07-25",
    createdAt: "2026-07-25T09:00:00Z",
  },
];

// ── 반 문제부족(CLASS_STARVED_ID) — INSUFFICIENT_PROBLEMS 재현 전용 ─
export const MOCK_PROGRESS_CLASS_STARVED: ProgressEntity[] = [
  {
    id: progressId(8),
    classId: CLASS_STARVED_ID,
    studentId: null,
    unitId: MOCK_EMPTY_PROBLEM_UNIT.id, // 427 — 등록된 문제 0건
    recordedAt: "2026-08-01",
    createdAt: "2026-08-01T09:05:00Z",
  },
];

export const MOCK_PROGRESS: ProgressEntity[] = [
  ...MOCK_PROGRESS_CLASS_A,
  ...MOCK_PROGRESS_STUDENT_3,
  ...MOCK_PROGRESS_CLASS_B,
  ...MOCK_PROGRESS_CLASS_STARVED,
];

/** 최신 진도만(반/학생 별) — GET /api/progress 성공 응답 재현에 사용. */
export const MOCK_CURRENT_PROGRESS = {
  classA: MOCK_PROGRESS_CLASS_A[MOCK_PROGRESS_CLASS_A.length - 1]!,
  student3: MOCK_PROGRESS_STUDENT_3[0]!,
  classB: MOCK_PROGRESS_CLASS_B[MOCK_PROGRESS_CLASS_B.length - 1]!,
  classStarved: MOCK_PROGRESS_CLASS_STARVED[0]!,
};
