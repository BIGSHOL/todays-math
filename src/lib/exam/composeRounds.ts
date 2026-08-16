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
import { takesExam } from "@/lib/predictor/examRoster";

/** `PredictionRun` 에서 이 화면이 읽는 필드만. 구조적 타입이라 Prisma 행이 그대로 들어간다. */
export type PredictionRunRow = {
  id: string;
  /** 이 회차를 만든 원장. 소유권 판정의 유일한 근거다. */
  userId: string;
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

/**
 * 이 사용자가 소유한 학생(반 소유자까지 확인된 것만 넘어온다).
 * 재학 정보는 응시 명단을 가르는 데 쓴다 — 모르면 null 이고, 그 상태가 정상이다.
 */
export type OwnedStudent = {
  id: string;
  name: string;
  schoolName: string | null;
  schoolLevel: string | null;
  schoolGrade: number | null;
};

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
 * 소유권 판정 — `PredictionRun.userId` **컬럼 하나**가 근거다.
 *
 * 예전에는 이 컬럼이 없어 `학생 → 반 → 반 소유자` 경로로 되짚었다. 그런데 그 경로가
 * `predictedScores` 를 거치는데 그 Json 이 항상 비어 있어, **원장 본인의 새 회차가
 * 자기 계기판에 뜨지 않았다**(adv-보정루프.md 🔴1). 컬럼은 마이그레이션
 * `20260816160000_prediction_run_owner_and_interval` 로 이미 생겼다.
 */
export function isRunVisibleTo(run: PredictionRunRow, userId: string): boolean {
  return run.userId === userId;
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
  rosterCount: number,
  actualCount: number,
): ExamStageState[] {
  return [
    { key: "blueprint", done: blueprint !== null, progress: null },
    { key: "paper", done: false, progress: null },
    { key: "grading", done: false, progress: null },
    {
      key: "actual",
      done: rosterCount > 0 && actualCount >= rosterCount,
      progress:
        rosterCount > 0
          ? {
              current: Math.min(actualCount, rosterCount),
              total: rosterCount,
            }
          : null,
    },
  ];
}

/**
 * 이 회차의 응시 명단 — 내 학생 중 이 시험을 보는 학생.
 *
 * 판정은 `examRoster.takesExam` 하나뿐이고 서버 저장 경로가 같은 함수를 쓴다.
 * 두 벌로 나뉘면 화면은 입력칸을 내주는데 서버가 422 로 거절하는 어긋남이 조용히 생긴다.
 */
function rosterOf(
  run: PredictionRunRow,
  ownedStudents: OwnedStudent[],
): OwnedStudent[] {
  const series = { school: run.school, level: run.level, grade: run.grade };
  return ownedStudents.filter((s) => takesExam(series, s));
}

/**
 * 회차 요약. 시리즈/시점이 계약을 통과하지 못하면 **null** 이다 —
 * 학교급이 "중"/"고" 가 아닌 행을 화면에 억지로 밀어 넣지 않는다.
 */
export function toRoundSummary(
  run: PredictionRunRow,
  actuals: ActualScoreRow[],
  ownedStudents: OwnedStudent[],
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
  const actualCount = actuals.filter((a) => a.runId === run.id).length;

  return {
    id: run.id,
    series: series.data,
    period: period.data,
    // 🔴 `PredictionRun.examDate` 컬럼이 아직 없다 — D-day 를 지어내지 않는다.
    examDate: null,
    stages: buildStages(
      blueprint,
      rosterOf(run, ownedStudents).length,
      actualCount,
    ),
    evidenceCount: run.inputExamIds.length,
    confidence: blueprint?.confidence ?? null,
  };
}

/**
 * 회차 상세. 학생 행은 **내 학생만** 싣는다 — 같은 회차에 남의 학생이 섞여 있어도
 * 이름이 새지 않는다.
 *
 * 명단은 세 갈래를 합친 것이다.
 *   ① 이 시험을 보는 내 학생 (`takesExam`) — 예측이 없어도 실점수를 넣을 자리를 준다.
 *   ② 회차가 예측한 학생 — 예측값을 함께 싣는다.
 *   ③ 이미 실점수가 들어온 학생 — 명단 규칙이 나중에 좁아져도 **넣은 점수를 감추지 않는다.**
 *
 * ①이 없으면 화면에 학생이 한 명도 안 뜬다. 예전에 ②만 보다가 그 Json 이 늘 비어 있어
 * 실제로 그렇게 됐다(adv-보정루프.md 🔴1).
 */
export function toRoundDetail(
  run: PredictionRunRow,
  actuals: ActualScoreRow[],
  ownedStudents: OwnedStudent[],
): ExamRoundDetail | null {
  const summary = toRoundSummary(run, actuals, ownedStudents);
  if (!summary) return null;

  const nameById = new Map(ownedStudents.map((s) => [s.id, s.name]));
  // 같은 학생이 두 번 들어 있으면 **앞엣것**을 쓴다. `new Map(...)` 은 뒤엣것으로 덮으므로
  // 쓰지 않는다 — 엔진이 같은 학생을 두 번 낸 것은 이상 신호이고, 그럴 때 조용히
  // 뒤엣값으로 바뀌면 어느 값이 쓰였는지 설명할 수 없다.
  const predictionByStudent = new Map<string, ScorePrediction>();
  for (const p of parsePredictedScores(run.predictedScores)) {
    if (p.studentId === null || predictionByStudent.has(p.studentId)) continue;
    predictionByStudent.set(p.studentId, p);
  }
  const actualByStudent = new Map(
    actuals
      .filter((a) => a.runId === run.id)
      .map((a) => [a.studentId, a.actualScore]),
  );

  const students: ExamStudentRow[] = [];
  const seen = new Set<string>();

  const push = (studentId: string) => {
    if (seen.has(studentId) || !nameById.has(studentId)) return;
    seen.add(studentId);
    students.push({
      studentId,
      studentName: nameById.get(studentId)!,
      prediction: predictionByStudent.get(studentId) ?? null,
      actualScore: actualByStudent.get(studentId) ?? null,
      // 🔴 응시 여부를 담는 컬럼이 없다. 모르는 것을 "미응시"로 단정하지 않는다.
      absent: false,
    });
  };

  for (const student of rosterOf(run, ownedStudents)) push(student.id);
  for (const studentId of predictionByStudent.keys()) push(studentId);
  // 예측에도 명단에도 없는데 실점수만 들어온 학생 — 버리지 않고 실측만 싣는다.
  for (const studentId of actualByStudent.keys()) push(studentId);

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
