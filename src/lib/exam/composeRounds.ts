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
 *    - 값이 NULL 이면 null 로 낸다 → 화면이 "일정 미정" 같은 사유를 적는다.
 *      다만 **있는 값을 없는 척하지도 않는다** — 그것도 거짓말이다(아래 examDate 이력 참조).
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

/**
 * `PredictionRun` 에서 이 화면이 읽는 필드만. 구조적 타입이라 Prisma 행이 그대로 들어간다.
 *
 * ⚠️ **여기 없는 컬럼은 픽스처에도 없게 된다.** 이 타입이 실제 테이블보다 좁으면 테스트가
 *    "코드가 읽는 모양"만 검증하게 되고, 컬럼을 안 읽는 버그를 통과시킨다
 *    (2026-08-16 실제 발생 — `examDate`·`userId` 참조).
 */
export type PredictionRunRow = {
  id: string;
  /** 이 예측을 만든 원장. 소유권 경계는 여기다 — 학생으로 되짚지 않는다. */
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
  /** 시행일(`@db.Date`). 학교가 아직 공지하지 않았으면 NULL. */
  examDate: Date | null;
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
 * 소유권 판정 — **fail closed**. 회차 소유자는 `PredictionRun.userId` 다.
 *
 * 📌 이력: 처음에는 이 자리가 `학생 → 반 → 반 소유자` 로 되짚는 우회로였다
 *    ("userId 컬럼이 아직 없다"는 전제). 그 전제는 이미 틀렸다 — migration
 *    `20260816160000_prediction_run_owner_and_interval` 이 `user_id`(NOT NULL, FK)를
 *    넣은 뒤였다. 우회로는 두 방향으로 틀렸다:
 *      - 내 회차인데 그 안에 내 학생 id 가 없으면 **안 보였다.** 엔진은 아직 학생별
 *        예상 점수를 내지 않으므로(`predictedScores: []`) 실제로는 내 회차가 전부
 *        사라졌다 — 계기판이 영구히 빈 목록이었다.
 *      - 반대로 남의 회차라도 내 학생 id 가 그 Json 에 있으면 **보였다.**
 *    이제는 소유자 한 값만 본다. 학생 유무는 소유권과 무관하다.
 *
 * ⚠️ 실제 걸러내기는 SQL(`where: { userId }`)이 한다. 이 함수는 조합 계층에서 같은
 *    규칙을 한 번 더 잠그는 안전망이다 — 목록 조회 경로가 늘어도 규칙이 갈라지지 않게.
 */
export function isRunOwnedBy(run: PredictionRunRow, userId: string): boolean {
  return Boolean(userId) && run.userId === userId;
}

/** `@db.Date` 컬럼 → `YYYY-MM-DD`. 값이 없으면 null 이다. */
function toIsoDate(value: Date | null | undefined): string | null {
  if (!value) return null;
  const time = value.getTime();
  if (Number.isNaN(time)) return null;
  return value.toISOString().slice(0, 10);
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
    // 원장님이 회차를 만들며 넣은 시행일(`prediction_run.exam_date`)을 그대로 낸다.
    // 🔴 없으면 null 이고 화면이 "일정 미정"을 적는다 — 대상 시점에서 날짜를 만들지 않는다.
    //    반대로 **있는 날짜를 null 로 내지도 않는다.** 그러면 화면이 D-day 를 못 세고
    //    `sortRounds` 가 통째로 무효가 된다(2026-08-16 실제 발생).
    examDate: toIsoDate(run.examDate),
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
  const studentIds = runStudentIds(run);
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
    // 🔴 이 회차가 학생별 예상 점수를 몇 명분 냈는가. 0이면 "반에 학생이 없다"가 아니라
    //    "엔진이 아직 개인 점수를 못 낸다"는 뜻이다. 표가 그 둘을 구분해 적어야 해서 낸다.
    predictedStudentCount: studentIds.length,
    predictedBlueprint: parseBlueprint(run.predictedBlueprint),
    // 🔴 실측 청사진을 담는 컬럼이 없다(T7.10 범위). 예측값을 실측인 척 복사하지 않는다.
    observedBlueprint: null,
    students,
  };
}
