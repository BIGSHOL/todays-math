/**
 * Mock '오늘의 시험' 회차 픽스처 (T7.14).
 *
 * 대응 API 경로: GET /api/exam/rounds, GET /api/exam/rounds/{id}
 * (계약: src/components/exam/examScreen.contract.ts — predictor.contract.ts 를 조합)
 *
 * ⚠️ T7.7(예측 API)·T7.10(실측 저장)이 병렬로 실 API 를 만드는 중이라 화면은 이 Mock 으로
 *    먼저 선다. 값은 확정 시안(docs/design/mockups/hifi-t70-todays-exam.html)의 3행을 그대로
 *    옮기고, 잔차(D-42)를 검증할 수 있게 **끝난 과거 회차 1건**을 더했다.
 *
 * 네 회차가 각각 다른 상태를 대표한다 — 화면이 상태별로 다르게 말하는지 보려는 것이다.
 *   1. 정화중 25-2 중간 : 채점 진행 중, 시험 전(실측 없음)        · 신뢰도 보통
 *   2. 경명여중 25-2 중간: 문제지 만드는 중                        · 신뢰도 높음
 *   3. 대륜고 25-2 기말  : 근거 1회차 → **예측 불가**(숫자 없음)   · 신뢰도 낮음
 *   4. 정화중 26-1 기말  : 전 단계 완료, 예측 대비 실측 대조 가능  · 신뢰도 높음
 */
import type {
  ExamRoundDetail,
  ExamRoundSummary,
} from "@/components/exam/examScreen.contract";
import type {
  Blueprint,
  ExamPeriod,
  ExamSeriesKey,
  ScorePrediction,
} from "@/contracts/predictor.contract";

import { STUDENT_IDS, unitId } from "./ids";

export const ROUND_JEONGHWA_ID = "70000000-0000-4000-8000-000000000001";
export const ROUND_GYEONGMYEONG_ID = "70000000-0000-4000-8000-000000000002";
export const ROUND_DAERYUN_ID = "70000000-0000-4000-8000-000000000003";
export const ROUND_JEONGHWA_PAST_ID = "70000000-0000-4000-8000-000000000004";

const JEONGHWA: ExamSeriesKey = {
  school: "정화중",
  level: "중",
  grade: 3,
  subject: "중3",
};
const GYEONGMYEONG: ExamSeriesKey = {
  school: "경명여중",
  level: "중",
  grade: 2,
  subject: "중2",
};
const DAERYUN: ExamSeriesKey = {
  school: "대륜고",
  level: "고",
  grade: 1,
  subject: "공통수학1",
};

const P_25_2_MID: ExamPeriod = { year: 2025, semester: 2, round: "중간" };
const P_25_2_FINAL: ExamPeriod = { year: 2025, semester: 2, round: "기말" };
const P_26_1_FINAL: ExamPeriod = { year: 2026, semester: 1, round: "기말" };

/** 미완 단계 — 진행 수를 셀 수 없는 단계는 progress 가 null 이다. */
function stage(key: "blueprint" | "paper" | "grading" | "actual", done: boolean) {
  return { key, done, progress: null } as const;
}

// ─────────────────────────────────────────────
// 01. 정화중 3학년 · 25-2 중간 — 채점 진행 중 (Hi-fi 01행)
// ─────────────────────────────────────────────

const JEONGHWA_PREDICTED: Blueprint = {
  kind: "predicted",
  series: JEONGHWA,
  period: P_25_2_MID,
  questionCount: 24,
  totalScore: 100,
  typeMix: {
    객관식: { count: 18, score: 66 },
    단답형: { count: 2, score: 8 },
    서술형: { count: 4, score: 26 },
  },
  difficultyMix: {
    하: { count: 9, score: 30 },
    중: { count: 11, score: 44 },
    상: { count: 4, score: 26 },
    미표기: { count: 0, score: 0 },
  },
  // Hi-fi 배점 보정기 화면의 "이 학교가 쓰는 배점 눈금" 과 같은 집합이다.
  scoreHistogram: [
    { score: 3.2, count: 5 },
    { score: 3.4, count: 5 },
    { score: 3.6, count: 5 },
    { score: 4.0, count: 3 },
    { score: 4.5, count: 2 },
    { score: 6.0, count: 2 },
    { score: 8.0, count: 2 },
  ],
  // v0.1 엔진은 번호별 난이도 곡선을 내지 않는다(11 §3 L1) — 빈 배열이 정직한 값이다.
  positionCurve: [],
  unitMix: [
    { unitId: unitId(11), topicRaw: "이차방정식", count: 8, score: 34 },
    { unitId: unitId(12), topicRaw: "이차함수의 그래프", count: 5, score: 22 },
    { unitId: unitId(13), topicRaw: "제곱근과 실수", count: 4, score: 16 },
    { unitId: null, topicRaw: "삼각비", count: 7, score: 28 },
  ],
  expectedMean: 68.4,
  expectedMeanInterval: { lower: 61, upper: 76, coverage: 0.8 },
  evidenceCount: 4,
  confidence: 0.62,
};

export const MOCK_ROUND_JEONGHWA: ExamRoundSummary = {
  id: ROUND_JEONGHWA_ID,
  series: JEONGHWA,
  period: P_25_2_MID,
  examDate: "2026-08-29",
  stages: [
    stage("blueprint", true),
    stage("paper", true),
    { key: "grading", done: false, progress: { current: 2, total: 4 } },
    stage("actual", false),
  ],
  evidenceCount: 4,
  confidence: 0.62,
};

function prediction(
  studentIdx: number,
  series: ExamSeriesKey,
  period: ExamPeriod,
  expectedScore: number,
  lower: number,
  upper: number,
  riskFlags: ScorePrediction["riskFlags"] = [],
): ScorePrediction {
  return {
    studentId: STUDENT_IDS[studentIdx]!,
    series,
    period,
    expectedScore,
    interval: { lower, upper, coverage: 0.8 },
    byUnit: [
      {
        unitId: unitId(11),
        topicRaw: "이차방정식",
        availableScore: 34,
        expectedScore: Math.round(expectedScore * 0.34 * 10) / 10,
      },
      {
        unitId: null,
        topicRaw: "삼각비",
        availableScore: 28,
        expectedScore: Math.round(expectedScore * 0.28 * 10) / 10,
      },
    ],
    riskFlags,
  };
}

const JEONGHWA_STUDENTS: ExamRoundDetail["students"] = [
  {
    studentId: STUDENT_IDS[0]!,
    studentName: "이서준",
    prediction: prediction(0, JEONGHWA, P_25_2_MID, 88, 80, 93),
    actualScore: null,
    absent: false,
  },
  {
    studentId: STUDENT_IDS[1]!,
    studentName: "김하윤",
    prediction: prediction(1, JEONGHWA, P_25_2_MID, 74, 66, 82),
    actualScore: null,
    absent: false,
  },
  {
    studentId: STUDENT_IDS[2]!,
    studentName: "박지호",
    prediction: null,
    actualScore: null,
    absent: true,
  },
  {
    // 개인 응답 표본이 없어 θ 추정이 안 되는 학생 — 회차 신뢰도와 무관하게 숫자를 못 낸다.
    studentId: STUDENT_IDS[3]!,
    studentName: "최수아",
    prediction: prediction(3, JEONGHWA, P_25_2_MID, 70, 52, 88, [
      "학생응답_부족",
    ]),
    actualScore: null,
    absent: false,
  },
];

export const MOCK_DETAIL_JEONGHWA: ExamRoundDetail = {
  summary: MOCK_ROUND_JEONGHWA,
  engineVersion: "v0.4",
  predictedBlueprint: JEONGHWA_PREDICTED,
  // 시험 전이라 비어 있다 — 이것이 정상 상태다(D-40).
  observedBlueprint: null,
  students: JEONGHWA_STUDENTS,
};

// ─────────────────────────────────────────────
// 02. 경명여중 2학년 · 25-2 중간 — 문제지 만드는 중 (Hi-fi 02행)
// ─────────────────────────────────────────────

const GYEONGMYEONG_PREDICTED: Blueprint = {
  kind: "predicted",
  series: GYEONGMYEONG,
  period: P_25_2_MID,
  questionCount: 20,
  totalScore: 100,
  typeMix: {
    객관식: { count: 14, score: 56 },
    단답형: { count: 3, score: 12 },
    서술형: { count: 3, score: 32 },
  },
  difficultyMix: {
    하: { count: 6, score: 24 },
    중: { count: 10, score: 44 },
    상: { count: 4, score: 32 },
    미표기: { count: 0, score: 0 },
  },
  scoreHistogram: [
    { score: 4.0, count: 17 },
    { score: 10.0, count: 2 },
    { score: 12.0, count: 1 },
  ],
  positionCurve: [],
  unitMix: [
    { unitId: unitId(21), topicRaw: "연립방정식", count: 8, score: 40 },
    { unitId: unitId(22), topicRaw: "일차함수", count: 6, score: 30 },
    { unitId: null, topicRaw: "확률", count: 6, score: 30 },
  ],
  expectedMean: 71.2,
  expectedMeanInterval: { lower: 66, upper: 77, coverage: 0.8 },
  evidenceCount: 6,
  confidence: 0.81,
};

export const MOCK_ROUND_GYEONGMYEONG: ExamRoundSummary = {
  id: ROUND_GYEONGMYEONG_ID,
  series: GYEONGMYEONG,
  period: P_25_2_MID,
  examDate: "2026-09-05",
  stages: [
    stage("blueprint", true),
    stage("paper", false),
    stage("grading", false),
    stage("actual", false),
  ],
  evidenceCount: 6,
  confidence: 0.81,
};

export const MOCK_DETAIL_GYEONGMYEONG: ExamRoundDetail = {
  summary: MOCK_ROUND_GYEONGMYEONG,
  engineVersion: "v0.4",
  predictedBlueprint: GYEONGMYEONG_PREDICTED,
  observedBlueprint: null,
  students: [
    {
      studentId: STUDENT_IDS[3]!,
      studentName: "최수아",
      prediction: prediction(3, GYEONGMYEONG, P_25_2_MID, 82, 75, 89),
      actualScore: null,
      absent: false,
    },
    {
      studentId: STUDENT_IDS[4]!,
      studentName: "정도윤",
      prediction: prediction(4, GYEONGMYEONG, P_25_2_MID, 66, 57, 75),
      actualScore: null,
      absent: false,
    },
  ],
};

// ─────────────────────────────────────────────
// 03. 대륜고 1학년 · 25-2 기말 — 근거 1회차, 예측 불가 (Hi-fi 03행)
// ─────────────────────────────────────────────

export const MOCK_ROUND_DAERYUN: ExamRoundSummary = {
  id: ROUND_DAERYUN_ID,
  series: DAERYUN,
  period: P_25_2_FINAL,
  examDate: "2026-10-02",
  stages: [
    stage("blueprint", false),
    stage("paper", false),
    stage("grading", false),
    stage("actual", false),
  ],
  evidenceCount: 1,
  confidence: 0.18,
};

export const MOCK_DETAIL_DAERYUN: ExamRoundDetail = {
  summary: MOCK_ROUND_DAERYUN,
  // 아직 엔진을 돌리지 않았다 — 버전을 지어내지 않는다.
  engineVersion: null,
  predictedBlueprint: null,
  observedBlueprint: null,
  students: [],
};

// ─────────────────────────────────────────────
// 04. 정화중 3학년 · 26-1 기말 — 끝난 회차, 예측 대비 실측 (보정 루프)
// ─────────────────────────────────────────────

const JEONGHWA_PAST_PREDICTED: Blueprint = {
  ...JEONGHWA_PREDICTED,
  period: P_26_1_FINAL,
  evidenceCount: 3,
  confidence: 0.71,
};

const JEONGHWA_PAST_OBSERVED: Blueprint = {
  kind: "observed",
  series: JEONGHWA,
  period: P_26_1_FINAL,
  questionCount: 25,
  totalScore: 100,
  typeMix: {
    객관식: { count: 18, score: 63 },
    단답형: { count: 1, score: 4 },
    서술형: { count: 6, score: 33 },
  },
  difficultyMix: {
    하: { count: 7, score: 24 },
    중: { count: 12, score: 45 },
    상: { count: 6, score: 31 },
    미표기: { count: 0, score: 0 },
  },
  scoreHistogram: [
    { score: 3.0, count: 10 },
    { score: 4.0, count: 10 },
    { score: 5.0, count: 2 },
    { score: 6.0, count: 2 },
    { score: 8.0, count: 1 },
  ],
  positionCurve: [],
  unitMix: [
    { unitId: unitId(11), topicRaw: "이차방정식", count: 8, score: 33 },
    { unitId: unitId(12), topicRaw: "이차함수의 그래프", count: 7, score: 30 },
    { unitId: unitId(13), topicRaw: "제곱근과 실수", count: 3, score: 12 },
    { unitId: null, topicRaw: "삼각비", count: 7, score: 25 },
  ],
  expectedMean: 63.2,
  // 실측 청사진에는 불확실 구간이 없다 — 관측값이기 때문이다.
  expectedMeanInterval: null,
  evidenceCount: 1,
  confidence: 1,
};

export const MOCK_ROUND_JEONGHWA_PAST: ExamRoundSummary = {
  id: ROUND_JEONGHWA_PAST_ID,
  series: JEONGHWA,
  period: P_26_1_FINAL,
  examDate: "2026-07-08",
  stages: [
    stage("blueprint", true),
    stage("paper", true),
    { key: "grading", done: true, progress: { current: 4, total: 4 } },
    stage("actual", true),
  ],
  evidenceCount: 3,
  confidence: 0.71,
};

export const MOCK_DETAIL_JEONGHWA_PAST: ExamRoundDetail = {
  summary: MOCK_ROUND_JEONGHWA_PAST,
  engineVersion: "v0.4",
  predictedBlueprint: JEONGHWA_PAST_PREDICTED,
  observedBlueprint: JEONGHWA_PAST_OBSERVED,
  students: [
    {
      studentId: STUDENT_IDS[0]!,
      studentName: "이서준",
      prediction: prediction(0, JEONGHWA, P_26_1_FINAL, 88, 80, 93),
      actualScore: 91, // 구간 안 → +3 적중
      absent: false,
    },
    {
      studentId: STUDENT_IDS[1]!,
      studentName: "김하윤",
      prediction: prediction(1, JEONGHWA, P_26_1_FINAL, 74, 66, 82),
      actualScore: 61, // 구간 밖 → −13 빗나감
      absent: false,
    },
    {
      studentId: STUDENT_IDS[2]!,
      studentName: "박지호",
      prediction: null,
      actualScore: null,
      absent: true,
    },
    {
      studentId: STUDENT_IDS[3]!,
      studentName: "최수아",
      prediction: prediction(3, JEONGHWA, P_26_1_FINAL, 70, 52, 88, [
        "학생응답_부족",
      ]),
      actualScore: null,
      absent: false,
    },
  ],
};

export const MOCK_EXAM_ROUNDS: ExamRoundSummary[] = [
  MOCK_ROUND_JEONGHWA,
  MOCK_ROUND_GYEONGMYEONG,
  MOCK_ROUND_DAERYUN,
  MOCK_ROUND_JEONGHWA_PAST,
];

export const MOCK_EXAM_ROUND_DETAILS: Record<string, ExamRoundDetail> = {
  [ROUND_JEONGHWA_ID]: MOCK_DETAIL_JEONGHWA,
  [ROUND_GYEONGMYEONG_ID]: MOCK_DETAIL_GYEONGMYEONG,
  [ROUND_DAERYUN_ID]: MOCK_DETAIL_DAERYUN,
  [ROUND_JEONGHWA_PAST_ID]: MOCK_DETAIL_JEONGHWA_PAST,
};
