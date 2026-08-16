/**
 * DB 행 → '오늘의 시험' 화면 계약 조합 (T7.14, 순수 함수).
 *
 * Route Handler 를 얇게 두려고 조합 규칙을 전부 여기 모았다. 여기에는 DB 접근도
 * 세션도 없다 — 그래야 "무엇을 낼 수 없는가"를 단위 테스트로 잠글 수 있다.
 *
 * ⚠️ import 방향 주의: 계약(`examScreen.contract.ts`)이 `src/components/exam/` 에 있어
 *    lib → components 로 올라간다. 코디네이터가 "화면 조합물이니 그 자리에 그대로 둔다"고
 *    확정한 결과다(2026-08-16). 계약이 `src/contracts/` 로 옮겨지면 이 import 만 바뀐다.
 *
 * 🔴 이 파일의 규칙은 하나다: **없는 것을 지어내지 않는다.**
 *    - 계약 검증에 실패한 Json 은 버린다(숫자를 못 믿으면 안 낸다).
 *    - 스키마에 없는 값(`examDate`)은 null 로 낸다 → 화면이 "일정 미정"을 적는다.
 *    - 근거가 없는 단계는 미완으로 둔다. 진행한 것처럼 칠하지 않는다.
 */
import type {
  ExamRoundDetail,
  ExamRoundSummary,
  ExamStageState,
  ExamStudentRow,
} from "@/components/exam/examScreen.contract";
import {
  blueprintSchema,
  examPeriodSchema,
  examSeriesKeySchema,
  scorePredictionSchema,
  type Blueprint,
  type ScorePrediction,
} from "@/contracts/predictor.contract";

/** `PredictionRun` 에서 이 화면이 읽는 필드만. 구조적 타입이라 Prisma 행이 그대로 들어간다. */
export type PredictionRunRow = {
  id: string;
  createdAt: Date;
  engineVersion: string;
  school: string;
  level: string;
  grade: number;
  subject: string;
  targetYear: number;
  targetSemester: number;
  targetRound: string;
  inputExamIds: string[];
  predictedBlueprint: unknown;
  predictedScores: unknown;
};

export type ActualScoreRow = {
  runId: string;
  studentId: string;
  actualScore: number;
};

/** 이 사용자가 소유한 학생(반 소유자까지 확인된 것만 넘어온다). */
export type OwnedStudent = { id: string; name: string };

/**
 * `predictedScores` Json → ScorePrediction[].
 *
 * 원소 단위로 검증하고 **계약에 안 맞는 원소만 버린다.** 하나가 깨졌다고 회차 전체를
 * 못 보게 하면 화면이 통째로 사라지고, 반대로 통과시키면 검증 안 된 숫자가 원장님께 간다.
 */
export function parsePredictedScores(json: unknown): ScorePrediction[] {
  if (!Array.isArray(json)) return [];
  const out: ScorePrediction[] = [];
  for (const item of json) {
    const parsed = scorePredictionSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/**
 * `predictedBlueprint` Json → Blueprint.
 * 검증에 실패하면 **null** 이다 — 화면은 그 회차를 "예측 불가"로 그린다.
 */
export function parseBlueprint(json: unknown): Blueprint | null {
  if (json === null || json === undefined) return null;
  const parsed = blueprintSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

/** 이 회차가 예측 대상으로 삼은 학생 id 들. studentId 가 null 인 항목은 시험지 평균 예측이다. */
export function runStudentIds(run: PredictionRunRow): string[] {
  return parsePredictedScores(run.predictedScores)
    .map((p) => p.studentId)
    .filter((id): id is string => id !== null);
}

/**
 * 소유권 판정 — **fail closed**.
 *
 * 🔴 `PredictionRun` 에 `userId` 컬럼이 아직 없다(2026-08-16 확인). 그래서 소유권을
 *    `학생 → 반 → 반 소유자` 경로로 되짚는다. 이 회차가 다루는 학생 중 **하나라도**
 *    내 학생이면 내 회차로 본다. 하나도 없으면 보이지 않는다(없는 쪽으로 닫는다).
 *    `PredictionRun.userId` 가 생기면 이 함수 하나만 갈아끼우면 된다.
 */
export function isRunVisibleTo(
  run: PredictionRunRow,
  actuals: ActualScoreRow[],
  ownedStudentIds: ReadonlySet<string>,
): boolean {
  if (runStudentIds(run).some((id) => ownedStudentIds.has(id))) return true;
  return actuals.some(
    (a) => a.runId === run.id && ownedStudentIds.has(a.studentId),
  );
}

/**
 * 4단계 파이프라인.
 *
 * 🔴 `문제지`·`채점` 은 **데이터 원천이 아직 없다**(예측 문제지는 T7.9, 채점은 T7.10).
 *    스키마에 그 상태를 담는 테이블도 컬럼도 없으므로 항상 미완으로 둔다.
 *    "아마 됐을 것"으로 칠하면 원장님이 안 만든 문제지를 만든 줄 안다.
 */
function buildStages(
  blueprint: Blueprint | null,
  predictedStudentCount: number,
  actualCount: number,
): ExamStageState[] {
  return [
    { key: "blueprint", done: blueprint !== null, progress: null },
    { key: "paper", done: false, progress: null },
    { key: "grading", done: false, progress: null },
    {
      key: "actual",
      done: predictedStudentCount > 0 && actualCount >= predictedStudentCount,
      progress:
        predictedStudentCount > 0
          ? {
              current: Math.min(actualCount, predictedStudentCount),
              total: predictedStudentCount,
            }
          : null,
    },
  ];
}

/**
 * 회차 요약. 시리즈/시점이 계약을 통과하지 못하면 **null** 이다 —
 * 학교급이 "중"/"고" 가 아닌 행을 화면에 억지로 밀어 넣지 않는다.
 */
export function toRoundSummary(
  run: PredictionRunRow,
  actuals: ActualScoreRow[],
): ExamRoundSummary | null {
  const series = examSeriesKeySchema.safeParse({
    school: run.school,
    level: run.level,
    grade: run.grade,
    subject: run.subject,
  });
  const period = examPeriodSchema.safeParse({
    year: run.targetYear,
    semester: run.targetSemester,
    round: run.targetRound,
  });
  if (!series.success || !period.success) return null;

  const blueprint = parseBlueprint(run.predictedBlueprint);
  const studentIds = runStudentIds(run);
  const actualCount = actuals.filter((a) => a.runId === run.id).length;

  return {
    id: run.id,
    series: series.data,
    period: period.data,
    // 🔴 `PredictionRun.examDate` 컬럼이 아직 없다 — D-day 를 지어내지 않는다.
    examDate: null,
    stages: buildStages(blueprint, studentIds.length, actualCount),
    evidenceCount: run.inputExamIds.length,
    confidence: blueprint?.confidence ?? null,
  };
}

/**
 * 회차 상세. 학생 행은 **내 학생만** 싣는다 — 같은 회차에 남의 학생이 섞여 있어도
 * 이름이 새지 않는다.
 */
export function toRoundDetail(
  run: PredictionRunRow,
  actuals: ActualScoreRow[],
  ownedStudents: OwnedStudent[],
): ExamRoundDetail | null {
  const summary = toRoundSummary(run, actuals);
  if (!summary) return null;

  const nameById = new Map(ownedStudents.map((s) => [s.id, s.name]));
  const predictions = parsePredictedScores(run.predictedScores);
  const actualByStudent = new Map(
    actuals
      .filter((a) => a.runId === run.id)
      .map((a) => [a.studentId, a.actualScore]),
  );

  const students: ExamStudentRow[] = [];
  const seen = new Set<string>();

  for (const prediction of predictions) {
    const id = prediction.studentId;
    if (id === null || !nameById.has(id) || seen.has(id)) continue;
    seen.add(id);
    students.push({
      studentId: id,
      studentName: nameById.get(id)!,
      prediction,
      actualScore: actualByStudent.get(id) ?? null,
      // 🔴 응시 여부를 담는 컬럼이 없다. 모르는 것을 "미응시"로 단정하지 않는다.
      absent: false,
    });
  }

  // 예측에는 없는데 실점수만 들어온 학생 — 버리지 않고 실측만 싣는다.
  for (const [studentId, actualScore] of actualByStudent) {
    if (seen.has(studentId) || !nameById.has(studentId)) continue;
    seen.add(studentId);
    students.push({
      studentId,
      studentName: nameById.get(studentId)!,
      prediction: null,
      actualScore,
      absent: false,
    });
  }

  students.sort((a, b) => a.studentName.localeCompare(b.studentName, "ko"));

  return {
    summary,
    engineVersion: run.engineVersion,
    predictedBlueprint: parseBlueprint(run.predictedBlueprint),
    // 🔴 실측 청사진을 담는 컬럼이 없다(T7.10 범위). 예측값을 실측인 척 복사하지 않는다.
    observedBlueprint: null,
    students,
  };
}
