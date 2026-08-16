/**
 * T7.7 — 예측 실행(`PredictionRun`) 저장 서비스.
 *
 * ## 이게 왜 뼈대인가
 *
 * 예측을 **기록으로 남기지 않으면 보정 자체가 불가능하다**(11 §3 L5-c). 나중에 실제 내신
 * 점수가 들어와도 무엇과 비교할지 알 수 없다. 그래서 이 서비스가 하는 일은 "잘 맞히는 것"이
 * 아니라 **입력 스냅샷 · 엔진 버전 · 파라미터 · 출력을 통째로, 감사 가능하게 남기는 것**이다.
 *
 * ## 지키는 규칙 4가지
 *
 * 1. **시간 분리(누출 금지)** — 컷오프 이후 자료는 어떤 경로로도 근거가 될 수 없다.
 *    자동 수집 경로에서 이미 걸러지지만, 저장 직전에 **한 번 더** 전수 검사한다.
 *    한쪽만 고치면 조용히 어긋나므로 판정은 `comparePeriod` 하나로 통일한다.
 *    컷오프가 대상 시점보다 뒤인 설정도 같은 사고라 함께 막는다.
 * 2. **근거가 없으면 지어내지 않는다** — `PredictorUnavailableError` 가 나면
 *    `predictedBlueprint` 를 NULL 로 저장한다. 0문항 0점짜리 청사진을 낸 적이 있다.
 * 3. **갱신하지 않는다** — 같은 시험을 두 번 예측하면 행이 2개 생긴다.
 *    엔진 버전별 비교가 목적이라 과거 run 을 덮어쓰면 비교 대상이 사라진다.
 * 4. **조용히 버리지 않는다** — 신뢰 가드(`paperTrust`)로 뺀 편 수를 `params` 에 센다.
 *
 * ## 소유권
 *
 * `PredictionRun.userId` 컬럼이 유일한 근거다. 조회·목록 필터를 전부 DB where 로 하므로
 * 목록 `total` 이 정확하고 `@@index([userId, createdAt desc])` 를 탄다.
 */
import { Prisma } from "@prisma/client";
import { z } from "zod";
import type {
  Exam as ExamRow,
  ExamQuestion as ExamQuestionRow,
  PredictionRun as PredictionRunRow,
} from "@prisma/client";

import {
  predictionRunParamsSchema,
  riskFlagSchema,
  RISK_FLAG_ORDER,
  type PredictionEvidenceStats,
  type PredictionLeakageDetail,
  type PredictionLeakageReason,
  type PredictionRunDetail,
  type PredictionRunParams,
  type PredictionRunSummary,
  type PredictorParamsSnapshot,
  type RiskFlag,
} from "@/contracts/predictionRun.contract";
import {
  comparePeriod,
  examPaperSchema,
  type Blueprint,
  type ExamLevel,
  type ExamPaper,
  type ExamPeriod,
  type ExamRound,
  type ExamSemester,
  type ExamSeriesKey,
  type ScorePrediction,
} from "@/contracts/predictor.contract";
import { forbiddenError, notFoundError } from "@/lib/apiResponse";
import { db } from "@/lib/db";
import type { OwnershipResult } from "@/lib/ownership";

import { observeBlueprint } from "./blueprint";
import { partitionTrusted } from "./paperTrust";
import {
  DEFAULT_PARAMS,
  predictBlueprint,
  PREDICTOR_ENGINE_VERSION,
  PredictorUnavailableError,
  type PredictorParams,
} from "./predictBlueprint";

/**
 * 엔진 버전은 엔진이 정의한다(`PREDICTOR_ENGINE_VERSION`). 여기서 다시 쓰지 않는다 —
 * 문자열이 두 곳에 있으면 한쪽만 올라가 backtest 지표와 실행 기록이 다른 축이 된다.
 */
export { PREDICTOR_ENGINE_VERSION } from "./predictBlueprint";

// ─────────────────────────────────────────────
// 에러 — 라우터가 상태 코드로 옮긴다
// ─────────────────────────────────────────────

/** 🔴 시간 분리 위반. 저장은 거부되고 행은 하나도 생기지 않는다. */
export class PredictionLeakageError extends Error {
  constructor(readonly detail: PredictionLeakageDetail) {
    super(leakageMessage(detail));
    this.name = "PredictionLeakageError";
  }
}

/** 요청이 지정한 근거 시험지가 DB 에 없다. */
export class PredictionInputNotFoundError extends Error {
  constructor(readonly missing: string[]) {
    super(`근거 시험지를 찾을 수 없습니다: ${missing.slice(0, 5).join(", ")}`);
    this.name = "PredictionInputNotFoundError";
  }
}

/** 요청이 지정한 근거 시험지가 계약을 위반한다(추출 결손 등). */
export class PredictionInputInvalidError extends Error {
  constructor(
    readonly issues: Array<{ externalExamId: string; reason: string }>,
  ) {
    super(
      `근거 시험지가 계약을 위반합니다: ${issues
        .slice(0, 3)
        .map((i) => `${i.externalExamId}(${i.reason})`)
        .join(", ")}`,
    );
    this.name = "PredictionInputInvalidError";
  }
}

function periodText(period: ExamPeriod): string {
  return `${period.year}-${period.semester}-${period.round}`;
}

function leakageMessage(detail: PredictionLeakageDetail): string {
  if (detail.reason === "컷오프_대상시점_역전") {
    return (
      `컷오프(${periodText(detail.cutoffPeriod)})가 대상 시점` +
      `(${periodText(detail.targetPeriod)})보다 뒤입니다. 누출을 막을 수 없어 저장하지 않았습니다.`
    );
  }
  const names = detail.offending
    .slice(0, 3)
    .map((o) => `${o.externalExamId}(${periodText(o.period)})`)
    .join(", ");
  return (
    `컷오프(${periodText(detail.cutoffPeriod)}) 이후 시험지가 근거에 섞였습니다: ` +
    `${names}${detail.offending.length > 3 ? ` 외 ${detail.offending.length - 3}편` : ""}. ` +
    "저장하지 않았습니다."
  );
}

// ─────────────────────────────────────────────
// DB 행 → ExamPaper
// ─────────────────────────────────────────────

type ExamWithQuestions = ExamRow & { questions: ExamQuestionRow[] };

type PaperConversion =
  | { ok: true; paper: ExamPaper }
  | { ok: false; externalExamId: string; reason: string };

/**
 * `Exam`+`ExamQuestion` 행을 계약(`examPaperSchema`)으로 검증해 `ExamPaper` 로 옮긴다.
 * 검증을 통과하지 못한 편은 **버리지 않고 세어서 보고한다** — 조용히 사라지면
 * "근거가 왜 이것뿐인가"를 나중에 설명할 수 없다.
 */
function toExamPaper(row: ExamWithQuestions): PaperConversion {
  const candidate = {
    externalExamId: row.externalExamId,
    series: {
      school: row.school,
      level: row.level,
      grade: row.grade,
      subject: row.subject,
    },
    period: {
      year: row.year,
      semester: row.semester,
      round: row.round,
    },
    subjectRaw: row.subjectRaw,
    totalScore: row.totalScore,
    questions: [...row.questions]
      .sort((a, b) => a.number - b.number)
      .map((q) => ({
        number: q.number,
        score: q.score,
        qtype: q.qtype,
        difficultyLabel: q.difficultyLabel,
        topicRaw: q.topicRaw,
        unitId: q.unitId,
        answer: q.answer,
        hasFigure: q.hasFigure,
        problemId: q.problemId,
      })),
    sourceFile: row.sourceFile,
  };

  const parsed = examPaperSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      ok: false,
      externalExamId: row.externalExamId,
      reason: parsed.error.issues
        .slice(0, 2)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    };
  }
  return { ok: true, paper: parsed.data };
}

// ─────────────────────────────────────────────
// 근거 수집
// ─────────────────────────────────────────────

interface Evidence {
  /** 출제 스타일 단위(학교·급·학년) — 문항 수·유형 배분·배점 눈금을 여기서 배운다. */
  history: ExamPaper[];
  /** 코호트(같은 급·학년·과목, 다른 학교). */
  cohort: ExamPaper[];
  /** 시험 범위 단위(학교·급·학년·**과목**) — 단원 배분 전용. */
  rangeHistory: ExamPaper[];
  rangeCohort: ExamPaper[];
  excludedByTrust: number;
  invalid: number;
  pinned: boolean;
}

function splitEvidence(
  papers: ExamPaper[],
  series: ExamSeriesKey,
  extras: { excludedByTrust: number; invalid: number; pinned: boolean },
): Evidence {
  const history = papers.filter((p) => p.series.school === series.school);
  const cohort = papers.filter((p) => p.series.school !== series.school);
  return {
    history,
    cohort,
    // 단원은 과목이 다르면 섞으면 안 된다(11 §3 L1).
    rangeHistory: history.filter((p) => p.series.subject === series.subject),
    rangeCohort: cohort.filter((p) => p.series.subject === series.subject),
    ...extras,
  };
}

/** 컷오프 **이전**만 남긴다. 같은 시점도 뺀다 — 그 시점 자료가 곧 정답지다. */
function beforeCutoff(papers: ExamPaper[], cutoff: ExamPeriod): ExamPaper[] {
  return papers.filter((p) => comparePeriod(p.period, cutoff) < 0);
}

async function gatherAutoEvidence(
  series: ExamSeriesKey,
  cutoff: ExamPeriod,
): Promise<Evidence> {
  const [ownRows, cohortRows] = await Promise.all([
    // 출제 스타일 단위는 **과목을 뺀다** — 고1은 학기마다 과목이 바뀌지만 관행은 이어진다.
    db.exam.findMany({
      where: {
        school: series.school,
        level: series.level,
        grade: series.grade,
      },
      include: { questions: true },
    }),
    db.exam.findMany({
      where: {
        level: series.level,
        grade: series.grade,
        subject: series.subject,
        NOT: { school: series.school },
      },
      include: { questions: true },
    }),
  ]);

  let invalid = 0;
  const converted: ExamPaper[] = [];
  for (const row of [...ownRows, ...cohortRows]) {
    const result = toExamPaper(row as ExamWithQuestions);
    if (result.ok) converted.push(result.paper);
    else invalid += 1;
  }

  // 만점이 100 이 아닌 편은 원본이 잘린 것이다 — 학습에 넣으면 그 학교가
  // "문항을 12개만 낸다"고 배운다. 결손이 아니라 **편향**이 된다.
  const { trusted, excluded } = partitionTrusted(
    beforeCutoff(converted, cutoff),
  );

  return splitEvidence(trusted, series, {
    excludedByTrust: excluded.length,
    invalid,
    pinned: false,
  });
}

/**
 * 요청이 근거를 직접 지정한 경우.
 *
 * ⚠️ 신뢰 가드를 적용하지 않는다 — 이 경로의 목적은 "과거 run 을 새 엔진 버전으로 그대로
 *    재실행해 비교"이고(11 §3 L5-c), 가드 기준이 바뀌면 같은 입력이 아니게 된다.
 *    **누출 검사는 예외 없이 적용된다.**
 */
async function gatherPinnedEvidence(
  series: ExamSeriesKey,
  externalExamIds: string[],
): Promise<Evidence> {
  const wanted = [...new Set(externalExamIds)];
  const rows = (await db.exam.findMany({
    where: { externalExamId: { in: wanted } },
    include: { questions: true },
  })) as ExamWithQuestions[];

  const found = new Set(rows.map((r) => r.externalExamId));
  const missing = wanted.filter((id) => !found.has(id));
  if (missing.length > 0) throw new PredictionInputNotFoundError(missing);

  const papers: ExamPaper[] = [];
  const issues: Array<{ externalExamId: string; reason: string }> = [];
  for (const row of rows) {
    const result = toExamPaper(row);
    if (result.ok) papers.push(result.paper);
    else
      issues.push({
        externalExamId: result.externalExamId,
        reason: result.reason,
      });
  }
  if (issues.length > 0) throw new PredictionInputInvalidError(issues);

  return splitEvidence(papers, series, {
    excludedByTrust: 0,
    invalid: 0,
    pinned: true,
  });
}

// ─────────────────────────────────────────────
// 🔴 누출 검사 — 저장 직전 전수
// ─────────────────────────────────────────────

function assertNoLeakage(
  papers: ExamPaper[],
  cutoff: ExamPeriod,
  target: ExamPeriod,
): void {
  const offending = papers
    .filter((p) => comparePeriod(p.period, cutoff) >= 0)
    .map((p) => ({ externalExamId: p.externalExamId, period: p.period }));
  if (offending.length === 0) return;
  throw new PredictionLeakageError({
    reason: "근거_컷오프_이후" satisfies PredictionLeakageReason,
    cutoffPeriod: cutoff,
    targetPeriod: target,
    offending,
  });
}

function assertCutoffNotAfterTarget(
  cutoff: ExamPeriod,
  target: ExamPeriod,
): void {
  if (comparePeriod(cutoff, target) <= 0) return;
  throw new PredictionLeakageError({
    reason: "컷오프_대상시점_역전" satisfies PredictionLeakageReason,
    cutoffPeriod: cutoff,
    targetPeriod: target,
    offending: [],
  });
}

// ─────────────────────────────────────────────
// 위험 표시
// ─────────────────────────────────────────────

function labeledQuestionCount(blueprints: Blueprint[]): number {
  let total = 0;
  for (const bp of blueprints) {
    for (const key of ["하", "중", "상"] as const) {
      total += bp.difficultyMix[key]?.count ?? 0;
    }
  }
  return total;
}

function sortRiskFlags(flags: Iterable<RiskFlag>): RiskFlag[] {
  const set = new Set(flags);
  return RISK_FLAG_ORDER.filter((flag) => set.has(flag));
}

/** 시험범위가 원장 확정 상태인가. 미확정이면 신뢰도를 깎는다(11 §5 `ExamScope`). */
async function isScopeConfirmed(
  series: ExamSeriesKey,
  target: ExamPeriod,
): Promise<boolean> {
  const scope = await db.examScope.findFirst({
    where: {
      school: series.school,
      level: series.level,
      grade: series.grade,
      subject: series.subject,
      year: target.year,
      semester: target.semester,
      round: target.round,
    },
  });
  return Boolean(scope && scope.confirmedAt && scope.unitIds.length > 0);
}

// ─────────────────────────────────────────────
// 실행
// ─────────────────────────────────────────────

export interface RunPredictionInput {
  userId: string;
  series: ExamSeriesKey;
  targetPeriod: ExamPeriod;
  /** 생략하면 대상 시점과 같다. */
  cutoffPeriod?: ExamPeriod;
  inputExamIds?: string[];
  /** 실제 시행일(YYYY-MM-DD). 모르면 주지 않는다 — NULL 로 저장한다. */
  examDate?: string;
  params?: Partial<PredictorParams>;
}

export async function runPrediction(
  input: RunPredictionInput,
): Promise<PredictionRunDetail> {
  const { userId, series, targetPeriod, examDate } = input;
  const cutoffPeriod = input.cutoffPeriod ?? targetPeriod;

  // 🔴 DB 를 읽기 전에 설정부터 막는다 — 컷오프가 대상 뒤면 무엇을 모아도 누출이다.
  assertCutoffNotAfterTarget(cutoffPeriod, targetPeriod);

  const evidence = input.inputExamIds
    ? await gatherPinnedEvidence(series, input.inputExamIds)
    : await gatherAutoEvidence(series, cutoffPeriod);

  const used = [...evidence.history, ...evidence.cohort];
  // 🔴 자동 경로에서 이미 걸렀더라도 저장 직전에 전수로 다시 본다.
  //    한쪽만 고쳐지면 조용히 어긋나는 자리라 이중으로 막는다.
  assertNoLeakage(used, cutoffPeriod, targetPeriod);

  const predictorParams: PredictorParamsSnapshot = {
    ...DEFAULT_PARAMS,
    ...input.params,
  };

  const observed = {
    history: evidence.history.map(observeBlueprint),
    cohort: evidence.cohort.map(observeBlueprint),
    rangeHistory: evidence.rangeHistory.map(observeBlueprint),
    rangeCohort: evidence.rangeCohort.map(observeBlueprint),
  };

  let predictedBlueprint: Blueprint | null = null;
  let unavailableReason: string | null = null;
  try {
    predictedBlueprint = predictBlueprint({
      series,
      target: targetPeriod,
      history: observed.history,
      cohort: observed.cohort,
      rangeHistory: observed.rangeHistory,
      rangeCohort: observed.rangeCohort,
      params: predictorParams,
    });
  } catch (error) {
    // 🔴 근거가 없으면 청사진을 지어내지 않는다. NULL 로 저장하고 이유를 남긴다.
    if (!(error instanceof PredictorUnavailableError)) throw error;
    predictedBlueprint = null;
    unavailableReason = error.message.slice(0, 300);
  }

  /**
   * 학생 개인 예상 점수는 아직 낼 수 없다 — 능력 추정(11 §3 L3)이 없고
   * 난이도 → 점수 환산 계수도 아직 없다(§2.7-3, T7.11 이 구한다).
   * 그래서 **빈 배열**을 저장하고 `학생응답_부족` 을 남긴다. 지어내지 않는다.
   */
  const predictedScores: ScorePrediction[] = [];

  const scopeConfirmed = await isScopeConfirmed(series, targetPeriod);
  const labeled = labeledQuestionCount([
    ...observed.history,
    ...observed.cohort,
  ]);

  const flags = new Set<RiskFlag>();
  if (!predictedBlueprint || observed.history.length === 0) {
    flags.add("적은_과거회차");
  }
  if (!scopeConfirmed) flags.add("시험범위_미확정");
  if (used.length > 0 && labeled === 0) flags.add("난이도라벨_결손");
  if (predictedScores.length === 0) flags.add("학생응답_부족");
  const riskFlags = sortRiskFlags(flags);

  const evidenceStats: PredictionEvidenceStats = {
    history: evidence.history.length,
    cohort: evidence.cohort.length,
    rangeHistory: evidence.rangeHistory.length,
    rangeCohort: evidence.rangeCohort.length,
    excludedByTrust: evidence.excludedByTrust,
    pinned: evidence.pinned,
  };

  const params: PredictionRunParams = predictionRunParamsSchema.parse({
    predictor: predictorParams,
    evidence: evidenceStats,
    unavailableReason,
  });

  // 근거로 **실제로 쓴** 시험지 전부. 감사 가능해야 하므로 코호트도 포함한다.
  const inputExamIds = used.map((p) => p.externalExamId);

  // 갱신이 아니라 항상 새 행이다 — 엔진 버전별 비교가 목적이다.
  const row = await db.predictionRun.create({
    data: {
      userId,
      riskFlags,
      // 모르면 NULL 이다. 대상 시점에서 날짜를 만들어 채우지 않는다.
      examDate: examDate === undefined ? null : new Date(`${examDate}T00:00:00Z`),
      engineVersion: PREDICTOR_ENGINE_VERSION,
      school: series.school,
      level: series.level,
      grade: series.grade,
      subject: series.subject,
      targetYear: targetPeriod.year,
      targetSemester: targetPeriod.semester,
      targetRound: targetPeriod.round,
      cutoffYear: cutoffPeriod.year,
      cutoffSemester: cutoffPeriod.semester,
      cutoffRound: cutoffPeriod.round,
      inputExamIds,
      params: params as unknown as Prisma.InputJsonValue,
      predictedBlueprint:
        predictedBlueprint === null
          ? Prisma.DbNull
          : (predictedBlueprint as unknown as Prisma.InputJsonValue),
      predictedScores: predictedScores as unknown as Prisma.InputJsonValue,
    },
  });

  return serializePredictionRunDetail(row);
}

// ─────────────────────────────────────────────
// 조회 · 소유권
// ─────────────────────────────────────────────

/** 존재하지 않으면 404, 존재하지만 남의 것이면 403 — 다른 라우트와 같은 패턴. */
export async function requireOwnedPredictionRun(
  runId: string,
  userId: string,
): Promise<OwnershipResult<PredictionRunRow>> {
  const run = await db.predictionRun.findUnique({ where: { id: runId } });
  if (!run) return { ok: false, response: notFoundError("예측 회차") };
  if (run.userId !== userId) {
    return { ok: false, response: forbiddenError() };
  }
  return { ok: true, data: run };
}

export interface ListPredictionRunsInput {
  userId: string;
  school: string;
  grade: number;
  level?: ExamLevel;
  subject?: string;
  page: number;
  pageSize: number;
}

/**
 * 계기판 목록. **소유자 필터를 DB where 가 한다** — `@@index([userId, createdAt desc])`
 * 를 타고, 걸러진 뒤의 건수를 DB 가 세므로 `total` 이 정확하다.
 * (소유자가 `params` JSON 에 있던 시절에는 메모리에서 걸러야 해서 페이지네이션을
 *  붙일 수 없었다.)
 */
export async function listPredictionRuns(
  input: ListPredictionRunsInput,
): Promise<{ runs: PredictionRunSummary[]; total: number }> {
  const where = {
    userId: input.userId,
    school: input.school,
    grade: input.grade,
    ...(input.level ? { level: input.level } : {}),
    ...(input.subject ? { subject: input.subject } : {}),
  };

  const [rows, total] = await Promise.all([
    db.predictionRun.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
    db.predictionRun.count({ where }),
  ]);

  return { runs: rows.map(serializePredictionRunSummary), total };
}

// ─────────────────────────────────────────────
// 직렬화
// ─────────────────────────────────────────────

function seriesOf(row: PredictionRunRow): ExamSeriesKey {
  return {
    school: row.school,
    level: row.level as ExamLevel,
    grade: row.grade,
    subject: row.subject,
  };
}

function targetOf(row: PredictionRunRow): ExamPeriod {
  return {
    year: row.targetYear,
    semester: row.targetSemester as ExamSemester,
    round: row.targetRound as ExamRound,
  };
}

function cutoffOf(row: PredictionRunRow): ExamPeriod {
  return {
    year: row.cutoffYear,
    semester: row.cutoffSemester as ExamSemester,
    round: row.cutoffRound as ExamRound,
  };
}

/** 저장된 `params` 를 계약 형태로 읽는다. 형태가 어긋나면 null(호출부가 드러낸다). */
function readParams(row: PredictionRunRow): PredictionRunParams | null {
  const parsed = predictionRunParamsSchema.safeParse(row.params);
  return parsed.success ? parsed.data : null;
}

/**
 * `riskFlags` 는 `String[]` 컬럼이라 DB 는 값을 검사하지 않는다.
 * 계약 열거값으로 좁히되 **모르는 값을 조용히 버리지 않는다** — 던져서 드러낸다.
 */
function riskFlagsOf(row: PredictionRunRow): RiskFlag[] {
  const parsed = z.array(riskFlagSchema).safeParse(row.riskFlags);
  if (!parsed.success) {
    throw new Error(
      `PredictionRun ${row.id}: riskFlags 에 계약에 없는 값이 있다 — ${row.riskFlags.join(", ")}`,
    );
  }
  return parsed.data;
}

/** `@db.Date` 컬럼 → YYYY-MM-DD. 다른 라우트(`Test.testDate`)와 같은 방식. */
function examDateOf(row: PredictionRunRow): string | null {
  return row.examDate ? row.examDate.toISOString().slice(0, 10) : null;
}

function blueprintOf(row: PredictionRunRow): Blueprint | null {
  return row.predictedBlueprint === null
    ? null
    : (row.predictedBlueprint as unknown as Blueprint);
}

export function serializePredictionRunDetail(
  row: PredictionRunRow,
): PredictionRunDetail {
  const params = readParams(row);
  if (!params) {
    throw new Error(
      `PredictionRun ${row.id}: params 가 계약 형태가 아니다 — 엔진 버전 간 형태 표류.`,
    );
  }
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    engineVersion: row.engineVersion,
    series: seriesOf(row),
    targetPeriod: targetOf(row),
    cutoffPeriod: cutoffOf(row),
    inputExamIds: row.inputExamIds,
    params,
    predictedBlueprint: blueprintOf(row),
    predictedScores: row.predictedScores as unknown as ScorePrediction[],
    riskFlags: riskFlagsOf(row),
    unavailableReason: params.unavailableReason,
    examDate: examDateOf(row),
  };
}

export function serializePredictionRunSummary(
  row: PredictionRunRow,
): PredictionRunSummary {
  const blueprint = blueprintOf(row);
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    engineVersion: row.engineVersion,
    series: seriesOf(row),
    targetPeriod: targetOf(row),
    cutoffPeriod: cutoffOf(row),
    examDate: examDateOf(row),
    evidenceCount: row.inputExamIds.length,
    riskFlags: riskFlagsOf(row),
    blueprint: blueprint
      ? {
          questionCount: blueprint.questionCount,
          totalScore: blueprint.totalScore,
          confidence: blueprint.confidence,
        }
      : null,
  };
}
