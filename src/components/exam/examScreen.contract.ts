/**
 * '오늘의 시험' 화면 조회 계약 (T7.14).
 *
 * ⚠️ 이 파일은 `src/contracts/predictor.contract.ts`(읽기 전용 SSOT)를 **조합만** 한다.
 *    엔진 계약을 재정의하지 않는다 — blueprint/scorePrediction 은 그대로 재사용한다.
 *
 * 왜 별도 계약이 필요한가:
 * `predictionRunSchema` 는 **엔진 실행 스냅샷**이라 화면이 필요한 것 셋이 없다.
 *   1. 시험 시행일 — 계기판의 D-day 기준 (05 §8.7 D-39)
 *   2. 4단계 파이프라인 진행 상태 — 청사진 → 문제지 → 채점 → 실점수
 *   3. 학생 이름과 실점수 — 예측 | 실측 좌우 대조 (D-40)
 * 셋 다 예측 엔진의 입출력이 아니라 화면 조합물이므로 여기서 정의한다.
 *
 * 🔴 배치 위치 주의: 원래는 `src/contracts/` 에 두는 것이 이 저장소 관례지만, T7.14 세션의
 *    소유 파일 목록에 전용 계약 파일이 지정되지 않았고 T7.7/T7.10 세션이 같은 디렉터리에서
 *    병렬로 예측 API 계약을 만들고 있다. 파일 충돌을 피하려고 소유 트리 안에 두었다.
 *    실 API 병합 시 `src/contracts/` 로 옮기는 것은 코디네이터 판단이다(REPORT.md 참조).
 */
import { z } from "zod";

import {
  dataResponseSchema,
  isoDateSchema,
  uuidSchema,
} from "@/contracts/common.contract";
import {
  blueprintSchema,
  examPeriodSchema,
  examSeriesKeySchema,
  scorePredictionSchema,
} from "@/contracts/predictor.contract";

/** 계기판 4단계 (05 §8.7 — §8.2 "같은 자리에서 라벨이 전진한다"와 같은 문법). */
export const examStageKeySchema = z.enum([
  "blueprint",
  "paper",
  "grading",
  "actual",
]);
export type ExamStageKey = z.infer<typeof examStageKeySchema>;

/**
 * 단계의 **원자료**. 색과 라벨은 여기 담지 않는다 —
 * 화면 파생 규칙(viewModel.ts)이 판정 가능 여부까지 보고 정한다.
 */
export const examStageStateSchema = z.strictObject({
  key: examStageKeySchema,
  done: z.boolean(),
  /** 부분 진행(예: 채점 3/12). 셀 수 없는 단계는 null. */
  progress: z
    .strictObject({
      current: z.int().min(0),
      total: z.int().min(1),
    })
    .nullable(),
});
export type ExamStageState = z.infer<typeof examStageStateSchema>;

export const examRoundSummarySchema = z.strictObject({
  id: uuidSchema,
  series: examSeriesKeySchema,
  period: examPeriodSchema,
  /** 시행일. 학교가 아직 공지하지 않았으면 null — D-day 를 지어내지 않는다. */
  examDate: isoDateSchema.nullable(),
  stages: z.array(examStageStateSchema).length(4),
  /** 근거로 쓴 과거 회차 수(blueprint.evidenceCount 와 같은 값). */
  evidenceCount: z.int().min(0),
  /** 0~1. 아직 청사진을 내지 않았으면 null — 0(=최저)과 "모름"은 다르다. */
  confidence: z.number().min(0).max(1).nullable(),
});
export type ExamRoundSummary = z.infer<typeof examRoundSummarySchema>;

export const examRoundListResponseSchema = dataResponseSchema(
  z.array(examRoundSummarySchema),
);
export type ExamRoundListResponse = z.infer<typeof examRoundListResponseSchema>;

export const examStudentRowSchema = z.strictObject({
  studentId: uuidSchema,
  studentName: z.string().min(1).max(30),
  /** 예측이 없으면 null. 위험 신호는 prediction.riskFlags 로 전달된다. */
  prediction: scorePredictionSchema.nullable(),
  /** 실제 시험 점수. 아직 안 들어왔으면 null. */
  actualScore: z.number().min(0).max(100).nullable(),
  /** 이 회차에 응시하지 않는 학생. */
  absent: z.boolean(),
});
export type ExamStudentRow = z.infer<typeof examStudentRowSchema>;

export const examRoundDetailSchema = z.strictObject({
  summary: examRoundSummarySchema,
  /** 예측을 낸 엔진 버전. 아직 안 돌렸으면 null. 지표를 섞어 비교하지 않으려고 노출한다. */
  engineVersion: z.string().min(1).max(40).nullable(),
  /**
   * 이 회차가 학생별 예상 점수를 낸 인원 수.
   *
   * 🔴 `students` 가 비었을 때 **이유가 둘**이라서 필요하다.
   *    0 이면 엔진이 아직 개인 점수를 못 내는 것이고(11 §3 L3·§2.7-3, T7.11 대기),
   *    0 이 아닌데 비었으면 그 학생들이 내 학생이 아니다. 표가 둘을 구분해 적어야
   *    "반에 학생이 없다"는 오해를 만들지 않는다.
   */
  predictedStudentCount: z.int().min(0),
  predictedBlueprint: blueprintSchema.nullable(),
  /** 시험 전에는 null 이 정상 상태다 (D-40). */
  observedBlueprint: blueprintSchema.nullable(),
  students: z.array(examStudentRowSchema),
});
export type ExamRoundDetail = z.infer<typeof examRoundDetailSchema>;

export const examRoundDetailResponseSchema =
  dataResponseSchema(examRoundDetailSchema);
export type ExamRoundDetailResponse = z.infer<
  typeof examRoundDetailResponseSchema
>;
