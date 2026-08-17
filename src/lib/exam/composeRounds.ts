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
  /** 이 예측을 만든 원장. 소유권 판정의 **유일한 근거**다. */
  userId: string;
  /** 시험 시행일. 모르면 null — 화면이 D-day 를 세는 기준이다. */
  examDate: Date | null;
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

/** 회차에 연결된 예측 문제지 요약 — 파이프라인 문제지·채점 단계의 근거. */
export type LinkedTestRow = {
  id: string;
  predictionRunId: string | null;
  /** 이 시험지에 채점 결과(TestResult)가 하나라도 있는가. */
  graded: boolean;
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
/** `@db.Date` 컬럼을 화면 계약의 `YYYY-MM-DD` 로. 시간대에 흔들리지 않게 UTC 로 읽는다. */
function toDateOnly(value: Date | null): string | null {
  if (!value) return null;
  return value.toISOString().slice(0, 10);
}

export function runStudentIds(run: PredictionRunRow): string[] {
  return parsePredictedScores(run.predictedScores)
    .map((p) => p.studentId)
    .filter((id): id is string => id !== null);
}

/**
 * 소유권 판정 — 이 회차를 **내가 만들었는가**.
 *
 * 🔴 예전에는 "그 회차 예측에 내 학생이 하나라도 있는가"로 판정했다. `PredictionRun` 에
 *    소유자 컬럼이 없던 시절의 우회였는데, 실제로는 **기능을 통째로 죽였다.**
 *    `predictedScores` 는 지금 항상 빈 배열이라(학생 개인 점수는 능력 추정·환산 계수가
 *    없어 아직 못 낸다) 방금 만든 회차가 자기 자신에게도 안 보였다.
 *    원장이 예측을 실행해도 계기판이 빈 채로 남는다.
 *
 * 소유자 컬럼이 생겼으니 그걸로 곧장 판정한다. 학생 경로를 되짚지 않으므로
 * 학생이 반을 옮기거나 졸업해도 과거 회차가 사라지지 않는다 — 보정 이력이 남는다.
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
  predictedStudentCount: number,
  actualCount: number,
  linkedTests: readonly LinkedTestRow[],
): ExamStageState[] {
  // 예전에는 문제지·채점이 "데이터 원천이 없어 항상 미완"이었다. `Test.predictionRunId`
  // 가 생겨(15 §B) 실데이터로 판정한다 — "아마 됐을 것"으로 칠하지 않는 원칙은 그대로다.
  const paperDone = linkedTests.length > 0;
  const gradingDone = linkedTests.some((t) => t.graded);
  return [
    { key: "blueprint", done: blueprint !== null, progress: null },
    { key: "paper", done: paperDone, progress: null },
    { key: "grading", done: gradingDone, progress: null },
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
  linkedTests: readonly LinkedTestRow[] = [],
): ExamRoundSummary | null {
  return buildRoundSummary(
    run,
    actuals,
    linkedTests,
    parseBlueprint(run.predictedBlueprint),
    parsePredictedScores(run.predictedScores),
  );
}

/**
 * 요약 조립 본체 — **이미 파싱된** 청사진·예측 배열을 받는다.
 *
 * 🔴 예전에는 상세 응답 한 건이 같은 Json 을 두 번씩 zod 로 돌렸다:
 *    `toRoundDetail` 이 `toRoundSummary` 를 부르면서 청사진·예측을 파싱하고,
 *    돌아와서 자기가 또 파싱했다. 청사진 스키마는 히스토그램·단원 배분까지 든 큰 객체라
 *    회차당 2회는 그대로 두 배 비용이다. **검증을 없애지 않고** 파싱 결과를 나눠 쓴다.
 */
function buildRoundSummary(
  run: PredictionRunRow,
  actuals: ActualScoreRow[],
  linkedTests: readonly LinkedTestRow[],
  blueprint: Blueprint | null,
  predictions: ScorePrediction[],
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

  const studentIds = predictions
    .map((p) => p.studentId)
    .filter((id): id is string => id !== null);
  const actualCount = actuals.filter((a) => a.runId === run.id).length;

  return {
    id: run.id,
    series: series.data,
    period: period.data,
    // 원장님이 넣으신 시행일. 없으면 null — 그럴듯한 날짜를 만들지 않는다.
    examDate: toDateOnly(run.examDate),
    stages: buildStages(
      blueprint,
      studentIds.length,
      actualCount,
      linkedTests.filter((t) => t.predictionRunId === run.id),
    ),
    // 🔴 **그 학교 과거 편수**다. `inputExamIds` 를 세면 안 된다 — 그 목록에는
    //    코호트(다른 학교)가 함께 들어가 "근거 5회차"의 4편이 남의 학교가 된다.
    //    그러면 우리 학교 1편만 있어도 문턱(MIN_EVIDENCE_ROUNDS)을 넘어, 근거 없는
    //    확신을 막으려고 만든 장치가 통째로 무력해진다.
    evidenceCount: blueprint?.evidenceCount ?? 0,
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
  linkedTests: readonly LinkedTestRow[] = [],
): ExamRoundDetail | null {
  // Json 파싱은 회차당 **한 번씩**이다. 결과를 요약 조립과 학생 행 조립이 나눠 쓴다.
  const blueprint = parseBlueprint(run.predictedBlueprint);
  const predictions = parsePredictedScores(run.predictedScores);

  const summary = buildRoundSummary(
    run,
    actuals,
    linkedTests,
    blueprint,
    predictions,
  );
  if (!summary) return null;

  const nameById = new Map(ownedStudents.map((s) => [s.id, s.name]));
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
    predictedBlueprint: blueprint,
    // 🔴 실측 청사진을 담는 컬럼이 없다(T7.10 범위). 예측값을 실측인 척 복사하지 않는다.
    observedBlueprint: null,
    students,
  };
}
