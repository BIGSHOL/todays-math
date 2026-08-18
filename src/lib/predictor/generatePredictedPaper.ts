/**
 * 예측 문제지 한 장을 만들어 적재하기까지의 DB 조립 — Route Handler 가 부르는 유일한 진입점.
 *
 * 순수 함수(`predictBlueprint` · `composePredictedPaper` · `scoreNormalizer`)는 전부 IO 를
 * 모르므로, 이 파일이 DB 에서 재료를 긁어 모아 넘기고 결과를 되쓴다.
 * `generateDraftTest.ts` 와 같은 구조다(엔진은 순수, 조립은 여기).
 *
 * ## 파이프라인
 *
 *   1. 반 소유권 확인            — 남의 반에 시험지를 만들지 않는다
 *   2. 그 학교 과거 회차 적재     — **대상 시점 이전만** (누출 차단)
 *   3. 코호트(같은 급·학년·과목의 다른 학교) 적재 — 역시 대상 시점 이전만
 *   4. 만점 100 신뢰 가드         — 잘린 시험지를 그 학교 관행으로 배우지 않는다(11 §11, D-45)
 *   5. 청사진 예측               — 근거가 0이면 만들지 않고 거절한다
 *   6. 문제은행 후보 조회         — 출제 자격(D-22·D-26·D-31)을 갖춘 문항만
 *   7. 문제지 조립 + 배점 보정    — 합계 100 (D-42)
 *   8. 적재                      — `TestProblem.score` 에만 쓴다
 *
 * ## 누출 차단을 서버가 강제한다 (11 §3 L5)
 *
 * 대상 시점 **이후** 회차가 근거에 한 톨이라도 섞이면 backtest 숫자만 좋아 보이고 실전에서
 * 무너진다. 클라이언트가 무엇을 보내든 **여기서** 컷오프를 적용한다 — 호출자가 근거 목록을
 * 고를 수 없게 아예 받지 않는 이유가 그것이다. `predictBlueprint` 안에도 같은 단언이 한 번 더
 * 있어(assertNoLeakage) 이 필터가 새면 거기서 터진다.
 *
 * ## 안 하는 것
 *
 * - `Problem` 테이블에 쓰지 않는다. 조정 배점은 `TestProblem.score` 에만 실린다(11 §10.2-4).
 * - `answer` · `figureUrls` · `figureSource` · `externalId` 는 읽지도 쓰지도 않는다.
 *   (후보 자격 판정에 필요한 `answer` 의 "정답 없음" 센티널 비교만 `findEligibleProblems` 와
 *   똑같은 규칙으로 쓴다 — 값을 읽어 나르지 않는다.)
 */
import type { Difficulty } from "@/contracts/common.contract";
import {
  comparePeriod,
  difficultyLabelSchema,
  examLevelSchema,
  examRoundSchema,
  examSemesterSchema,
  questionTypeSchema,
  type Blueprint,
  type ExamPaper,
  type ExamPeriod,
  type ExamSeriesKey,
} from "@/contracts/predictor.contract";
import type { PaperCandidate } from "@/contracts/scoreNormalizer.contract";
import { db } from "@/lib/db";
import { MISSING_ANSWER } from "@/lib/missingAnswer";
import { problemVisibleWhere } from "@/lib/problemPool";

import { observeBlueprint } from "./blueprint";
import { composePredictedPaper } from "./composePredictedPaper";
import { partitionTrusted } from "./paperTrust";
import { persistPredictedPaper } from "./persistPredictedPaper";
import {
  PredictorUnavailableError,
  predictBlueprint,
} from "./predictBlueprint";

export type GenerateRefusal =
  /** 그 반이 이 사용자 것이 아니다. */
  | "권한_없음"
  /** 반이 없다. */
  | "대상_없음"
  /** 청사진을 만들 근거(과거 회차·코호트)가 하나도 없다. 0문항 시험지를 내지 않는다. */
  | "근거_없음"
  /** 문제지를 만들지 못했다(눈금 없음 · 후보 없음 · 합계 100 불가 등). */
  | "판단_불가"
  /** 적재 직전 만점 재검산에서 걸렸다. */
  | "만점_불일치";

export type GeneratePredictedPaperResult =
  | {
      ok: true;
      testId: string;
      blueprint: Blueprint;
      paper: Extract<
        Awaited<ReturnType<typeof composePredictedPaper>>,
        { ok: true }
      >;
    }
  | { ok: false; refusal: GenerateRefusal; detail: string; reason?: string };

function refuse(
  refusal: GenerateRefusal,
  detail: string,
  reason?: string,
): GeneratePredictedPaperResult {
  return { ok: false, refusal, detail, reason };
}

/**
 * DB 행 → 계약상의 `ExamPaper`.
 * 표기가 계약과 다른 행(급/회차/학기 값이 깨진 것)은 **버린다** — 억지로 고쳐 넣지 않는다.
 */
function toExamPaper(
  exam: {
    id: string;
    externalExamId: string;
    school: string;
    level: string;
    grade: number;
    subject: string;
    subjectRaw: string | null;
    year: number;
    semester: number;
    round: string;
    totalScore: number;
    sourceFile: string | null;
  },
  questions: Array<{
    number: number;
    score: number;
    qtype: string;
    difficultyLabel: string | null;
    topicRaw: string | null;
    unitId: string | null;
    answer: string | null;
    hasFigure: boolean;
    problemId: string | null;
  }>,
): ExamPaper | null {
  const level = examLevelSchema.safeParse(exam.level);
  const round = examRoundSchema.safeParse(exam.round);
  const semester = examSemesterSchema.safeParse(exam.semester);
  if (!level.success || !round.success || !semester.success) return null;
  if (questions.length === 0) return null;

  const mapped = questions
    .map((q) => {
      const qtype = questionTypeSchema.safeParse(q.qtype);
      if (!qtype.success) return null;
      const label = q.difficultyLabel
        ? difficultyLabelSchema.safeParse(q.difficultyLabel)
        : null;
      return {
        number: q.number,
        score: q.score,
        qtype: qtype.data,
        difficultyLabel: label?.success ? label.data : null,
        topicRaw: q.topicRaw,
        unitId: q.unitId,
        answer: q.answer,
        hasFigure: q.hasFigure,
        problemId: q.problemId,
      };
    })
    .filter((q): q is NonNullable<typeof q> => q !== null)
    .sort((a, b) => a.number - b.number);

  if (mapped.length === 0) return null;

  return {
    externalExamId: exam.externalExamId,
    series: {
      school: exam.school,
      level: level.data,
      grade: exam.grade,
      subject: exam.subject,
    },
    period: {
      year: exam.year,
      semester: semester.data,
      round: round.data,
    },
    subjectRaw: exam.subjectRaw,
    totalScore: exam.totalScore,
    questions: mapped,
    sourceFile: exam.sourceFile,
  };
}

/** 조건에 맞는 시험지를 읽어 **대상 시점 이전만** 남긴다. */
async function loadPapersBefore(
  where: Record<string, unknown>,
  target: ExamPeriod,
): Promise<ExamPaper[]> {
  const exams = await db.exam.findMany({ where });
  if (exams.length === 0) return [];

  const questions = await db.examQuestion.findMany({
    where: { examId: { in: exams.map((e) => e.id) } },
  });
  const byExam = new Map<string, typeof questions>();
  for (const q of questions) {
    const list = byExam.get(q.examId);
    if (list) list.push(q);
    else byExam.set(q.examId, [q]);
  }

  const papers: ExamPaper[] = [];
  for (const exam of exams) {
    const paper = toExamPaper(exam, byExam.get(exam.id) ?? []);
    // 🔴 누출 차단 — 대상 시점 이후(또는 같은 시점)는 어떤 경로로도 들어가면 안 된다.
    if (paper && comparePeriod(paper.period, target) < 0) papers.push(paper);
  }
  return papers;
}

function toCandidate(row: {
  id: string;
  unitId: string;
  difficulty: Difficulty;
  questionType: string | null;
  source: PaperCandidate["source"];
  originProblemId: string | null;
  score: number | null;
}): PaperCandidate {
  const qtype = row.questionType
    ? questionTypeSchema.safeParse(row.questionType)
    : null;
  return {
    problemId: row.id,
    unitId: row.unitId,
    difficulty: row.difficulty,
    // 백필 전이면 NULL 이다. 모르는 것을 안다고 하지 않는다.
    questionType: qtype?.success ? qtype.data : null,
    source: row.source,
    // RPM 교재본과 AI 변형본을 가르는 유일한 값 — 재료 우선순위(11 §3 L6)가 이걸로 선다.
    originProblemId: row.originProblemId,
    score: row.score ?? null,
  };
}

export interface GeneratePredictedPaperInput {
  userId: string;
  classId: string;
  studentId?: string | null;
  testDate: string;
  rangeStartUnitId?: string | null;
  rangeEndUnitId: string;
  /** 문제은행에서 재료를 뽑을 단원 범위. */
  unitIds: string[];
  series: ExamSeriesKey;
  target: ExamPeriod;
  /** '오늘의 시험' 회차에서 만드는 문제지면 그 회차 id. */
  predictionRunId?: string | null;
}

export async function generatePredictedPaper(
  input: GeneratePredictedPaperInput,
): Promise<GeneratePredictedPaperResult> {
  // 1. 무거운 조회를 하기 전에 권한부터 본다.
  const owner = await db.class.findUnique({ where: { id: input.classId } });
  if (!owner) return refuse("대상_없음", "반을 찾을 수 없습니다.");

  // 회차를 지정했으면 **내 회차·같은 시리즈**인지 먼저 본다. 남의 회차에 문제지를
  // 붙이거나, 정화중 회차에 경북고 문제지를 붙이면 계기판 파이프라인이 거짓말을 한다.
  if (input.predictionRunId) {
    const run = await db.predictionRun.findUnique({
      where: { id: input.predictionRunId },
    });
    if (!run || run.userId !== input.userId) {
      return refuse("대상_없음", "회차를 찾을 수 없습니다.");
    }
    if (
      run.school !== input.series.school ||
      run.level !== input.series.level ||
      run.grade !== input.series.grade
    ) {
      return refuse(
        "권한_없음",
        "회차와 시험지의 학교·학년이 다릅니다. 같은 회차의 문제지만 연결할 수 있습니다.",
      );
    }
  }
  if (owner.userId !== input.userId) {
    return refuse("권한_없음", "이 반에 시험지를 만들 권한이 없습니다.");
  }

  // 2~3. 근거 적재 — 그 학교 과거 회차 + 코호트. 둘 다 대상 시점 이전만.
  const { series, target } = input;
  const [ownPapers, cohortPapers] = await Promise.all([
    loadPapersBefore(
      {
        school: series.school,
        level: series.level,
        grade: series.grade,
        subject: series.subject,
      },
      target,
    ),
    loadPapersBefore(
      {
        school: { not: series.school },
        level: series.level,
        grade: series.grade,
        subject: series.subject,
      },
      target,
    ),
  ]);

  // 4. 만점 100 가드 — 잘린 시험지를 그 학교 관행으로 배우지 않는다.
  const own = partitionTrusted(ownPapers);
  const cohort = partitionTrusted(cohortPapers);

  // 5. 청사진 예측. 근거가 0이면 0문항 0점 시험지를 내지 않고 거절한다.
  let blueprint: Blueprint;
  try {
    blueprint = predictBlueprint({
      series,
      target,
      history: own.trusted.map(observeBlueprint),
      cohort: cohort.trusted.map(observeBlueprint),
    });
  } catch (error) {
    if (error instanceof PredictorUnavailableError) {
      return refuse("근거_없음", error.message);
    }
    throw error;
  }

  // 6. 문제은행 후보 — findEligibleProblems 와 같은 자격 규칙(D-22·D-26·D-31)을 쓴다.
  //    배점·유형이 필요해 계약 직렬화(ProblemEntity)를 거치지 않고 행에서 직접 읽는다.
  const rows =
    input.unitIds.length === 0
      ? []
      : await db.problem.findMany({
          where: {
            AND: [
              problemVisibleWhere(input.userId),
              {
                unitId: { in: input.unitIds },
                reviewStatus: "approved",
                directUseAllowed: true,
                answer: { not: MISSING_ANSWER },
              },
            ],
          },
        });

  // 7. 조립 + 배점 보정.
  const paper = composePredictedPaper({
    blueprint,
    candidates: rows.map(toCandidate),
    referencePapers: own.trusted,
  });
  if (!paper.ok) {
    return refuse("판단_불가", paper.detail, paper.reason);
  }

  // 8. 적재 — TestProblem.score 에만 쓴다.
  const saved = await persistPredictedPaper({
    predictionRunId: input.predictionRunId ?? null,
    userId: input.userId,
    classId: input.classId,
    studentId: input.studentId ?? null,
    testDate: input.testDate,
    rangeStartUnitId: input.rangeStartUnitId ?? null,
    rangeEndUnitId: input.rangeEndUnitId,
    paper,
  });
  if (!saved.ok) {
    const refusal: GenerateRefusal =
      saved.reason === "권한_없음"
        ? "권한_없음"
        : saved.reason === "대상_없음"
          ? "대상_없음"
          : saved.reason === "만점_불일치"
            ? "만점_불일치"
            : "판단_불가";
    return refuse(refusal, saved.detail);
  }

  return { ok: true, testId: saved.testId, blueprint, paper };
}
