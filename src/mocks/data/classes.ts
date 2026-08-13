/**
 * Mock 반(Class) 픽스처 (T0.5.2) — 수준이 다른 반 2개 + 소유권 테스트용 타 사용자 반 1개.
 *
 * 대응 API 경로: POST/GET /api/classes, GET/PATCH/DELETE /api/classes/{id}
 * (src/contracts/class.contract.ts)
 */
import type { ClassEntity } from "@/contracts/class.contract";

import {
  CLASS_A_ID,
  CLASS_B_ID,
  CLASS_OTHER_ID,
  CLASS_STARVED_ID,
  USER_OTHER_ID,
  USER_TEACHER_ID,
} from "./ids";

/** 수준 높은 반(심화) — easy 비중 낮고 hard 비중 높은 난이도 배분. */
export const MOCK_CLASS_A: ClassEntity = {
  id: CLASS_A_ID,
  userId: USER_TEACHER_ID,
  name: "중2 심화반",
  grade: "중2",
  defaultProblemCount: 8,
  difficultyRatio: { easy: 2, mid: 4, hard: 2 },
  createdAt: "2026-06-01T09:00:00Z",
  updatedAt: "2026-06-01T09:00:00Z",
};

/** 수준 낮은 반(기초) — easy 비중 높고 hard는 배분하지 않음. */
export const MOCK_CLASS_B: ClassEntity = {
  id: CLASS_B_ID,
  userId: USER_TEACHER_ID,
  name: "중2 기초반",
  grade: "중2",
  defaultProblemCount: 6,
  difficultyRatio: { easy: 4, mid: 2, hard: 0 },
  createdAt: "2026-06-02T09:00:00Z",
  updatedAt: "2026-07-15T09:00:00Z",
};

/** USER_OTHER_ID 소유 — MOCK_TEACHER(로그인 사용자)가 접근 시 403 FORBIDDEN을 검증하는 픽스처. */
export const MOCK_CLASS_OTHER_USER: ClassEntity = {
  id: CLASS_OTHER_ID,
  userId: USER_OTHER_ID,
  name: "박강사의 반",
  grade: "중3",
  defaultProblemCount: 8,
  difficultyRatio: { easy: 3, mid: 4, hard: 1 },
  createdAt: "2026-05-01T09:00:00Z",
  updatedAt: "2026-05-01T09:00:00Z",
};

/**
 * 로그인 사용자(MOCK_TEACHER) 소유이지만 현재 진도가 MOCK_EMPTY_PROBLEM_UNIT(등록 문제 0건)인
 * 반 — POST /api/tests/generate의 INSUFFICIENT_PROBLEMS 실패 경로를 결정적으로 재현하기 위한
 * 전용 픽스처(src/mocks/data/progress.ts의 대응 진도 기록, src/mocks/handlers/test.ts 참조).
 */
export const MOCK_CLASS_STARVED: ClassEntity = {
  id: CLASS_STARVED_ID,
  userId: USER_TEACHER_ID,
  name: "중2 문제부족반(테스트용)",
  grade: "중2",
  defaultProblemCount: 8,
  difficultyRatio: { easy: 3, mid: 4, hard: 1 },
  createdAt: "2026-08-01T09:00:00Z",
  updatedAt: "2026-08-01T09:00:00Z",
};

/** 로그인 사용자(MOCK_TEACHER) 소유 반 목록 — GET /api/classes 성공 응답에 사용. */
export const MOCK_CLASSES: ClassEntity[] = [
  MOCK_CLASS_A,
  MOCK_CLASS_B,
  MOCK_CLASS_STARVED,
];
