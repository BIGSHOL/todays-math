/**
 * Mock 학생(Student) 픽스처 (T0.5.2) — 5명, 반 A(3명)/반 B(2명) 배정.
 *
 * 대응 API 경로: POST/GET /api/students, PATCH/DELETE /api/students/{id}
 * (src/contracts/class.contract.ts)
 */
import type { StudentEntity } from "@/contracts/class.contract";

import { CLASS_A_ID, CLASS_B_ID, STUDENT_IDS } from "./ids";

export const MOCK_STUDENT_1: StudentEntity = {
  id: STUDENT_IDS[0]!,
  classId: CLASS_A_ID,
  name: "이서준",
  useIndividualProgress: false,
  createdAt: "2026-06-01T09:10:00Z",
  updatedAt: "2026-06-01T09:10:00Z",
};

export const MOCK_STUDENT_2: StudentEntity = {
  id: STUDENT_IDS[1]!,
  classId: CLASS_A_ID,
  name: "김하윤",
  useIndividualProgress: false,
  createdAt: "2026-06-01T09:11:00Z",
  updatedAt: "2026-06-01T09:11:00Z",
};

/** 반 진도보다 앞서가는 개별 진도 사용 학생 — useIndividualProgress 우선 적용 테스트용. */
export const MOCK_STUDENT_3: StudentEntity = {
  id: STUDENT_IDS[2]!,
  classId: CLASS_A_ID,
  name: "박지호",
  useIndividualProgress: true,
  createdAt: "2026-06-01T09:12:00Z",
  updatedAt: "2026-07-20T09:00:00Z",
};

export const MOCK_STUDENT_4: StudentEntity = {
  id: STUDENT_IDS[3]!,
  classId: CLASS_B_ID,
  name: "최수아",
  useIndividualProgress: false,
  createdAt: "2026-06-02T09:10:00Z",
  updatedAt: "2026-06-02T09:10:00Z",
};

export const MOCK_STUDENT_5: StudentEntity = {
  id: STUDENT_IDS[4]!,
  classId: CLASS_B_ID,
  name: "정도윤",
  useIndividualProgress: false,
  createdAt: "2026-06-02T09:11:00Z",
  updatedAt: "2026-06-02T09:11:00Z",
};

export const MOCK_STUDENTS: StudentEntity[] = [
  MOCK_STUDENT_1,
  MOCK_STUDENT_2,
  MOCK_STUDENT_3,
  MOCK_STUDENT_4,
  MOCK_STUDENT_5,
];

export const MOCK_STUDENTS_BY_CLASS: Record<string, StudentEntity[]> = {
  [CLASS_A_ID]: [MOCK_STUDENT_1, MOCK_STUDENT_2, MOCK_STUDENT_3],
  [CLASS_B_ID]: [MOCK_STUDENT_4, MOCK_STUDENT_5],
};
