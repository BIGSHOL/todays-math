/**
 * T7.7 전용 인메모리 Prisma 대역 — `Exam`/`ExamQuestion`/`ExamScope`/`PredictionRun`.
 *
 * ## 왜 공용 `src/mocks/prismaTestDouble.ts` 를 안 쓰나
 *
 * 공용 대역에는 `predictionRun` 델리게이트가 아직 없다. 공용 파일은 다른 트랙이 함께 쓰는
 * 파일이라 T7.7 세션이 손대지 않는다(트랙 공통 규칙 9 — 남의 트랙 파일 수정 금지).
 * 그래서 이 태스크가 실제로 부르는 델리게이트만 담은 최소 대역을 여기 둔다.
 *
 * ## 대역이 지원하는 질의만 지원한다
 *
 * 서비스가 실제로 쓰는 형태만 구현한다 — 등호 비교, `{ in: [...] }`, `NOT: {...}`,
 * `orderBy: { createdAt: "desc" }`. 그 밖의 연산자가 들어오면 **조용히 통과시키지 않고
 * 던진다.** 대역이 진짜 Prisma 보다 관대하면 테스트가 초록인 채로 실전이 깨진다
 * (트랙 README: "합성 픽스처가 이관 결함을 통과시켰다").
 */
import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";

import type {
  DifficultyLabel,
  ExamLevel,
  ExamRound,
  QuestionType,
} from "@/contracts/predictor.contract";

export interface FakeExamQuestionRow {
  id: string;
  examId: string;
  number: number;
  score: number;
  qtype: QuestionType;
  difficultyLabel: DifficultyLabel | null;
  topicRaw: string | null;
  unitId: string | null;
  answer: string | null;
  hasFigure: boolean;
  problemId: string | null;
}

export interface FakeExamRow {
  id: string;
  externalExamId: string;
  school: string;
  level: ExamLevel;
  grade: number;
  subject: string;
  subjectRaw: string | null;
  year: number;
  semester: number;
  round: ExamRound;
  totalScore: number;
  questionCount: number;
  sourceFile: string | null;
  createdAt: Date;
  updatedAt: Date;
  questions: FakeExamQuestionRow[];
}

export interface FakeExamScopeRow {
  id: string;
  school: string;
  level: string;
  grade: number;
  subject: string;
  year: number;
  semester: number;
  round: string;
  unitIds: string[];
  confirmedAt: Date | null;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FakePredictionRunRow {
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
  cutoffYear: number;
  cutoffSemester: number;
  cutoffRound: string;
  inputExamIds: string[];
  params: unknown;
  predictedBlueprint: unknown;
  predictedScores: unknown;
  actualSchoolMean: number | null;
  actualSchoolStdev: number | null;
  actualRecordedAt: Date | null;
}

let examRows: FakeExamRow[] = [];
let examScopeRows: FakeExamScopeRow[] = [];
let predictionRunRows: FakePredictionRunRow[] = [];
/** createdAt 을 결정적으로 증가시킨다 — 같은 밀리초에 두 행이 생기면 최신순 정렬이 흔들린다. */
let clockTick = 0;

const CLOCK_BASE = Date.UTC(2026, 7, 16, 0, 0, 0);

function nextCreatedAt(): Date {
  clockTick += 1;
  return new Date(CLOCK_BASE + clockTick * 1_000);
}

type WhereValue = unknown;

function matchesValue(actual: unknown, expected: WhereValue): boolean {
  if (expected !== null && typeof expected === "object") {
    const ops = expected as Record<string, unknown>;
    const keys = Object.keys(ops);
    const unsupported = keys.filter((k) => k !== "in");
    if (unsupported.length > 0) {
      throw new Error(
        `predictionRunTestDb: 지원하지 않는 where 연산자 ${unsupported.join(",")} — ` +
          "대역이 실제 Prisma 보다 관대해지지 않도록 일부러 던진다.",
      );
    }
    const list = ops.in;
    if (!Array.isArray(list)) {
      throw new Error("predictionRunTestDb: `in` 은 배열이어야 한다.");
    }
    return list.includes(actual as never);
  }
  return actual === expected;
}

function matchesWhere(row: Record<string, unknown>, where?: unknown): boolean {
  if (!where || typeof where !== "object") return true;
  for (const [key, expected] of Object.entries(
    where as Record<string, unknown>,
  )) {
    if (key === "NOT") {
      if (matchesWhere(row, expected)) return false;
      continue;
    }
    if (expected === undefined) continue;
    if (!matchesValue(row[key], expected)) return false;
  }
  return true;
}

/**
 * Json 컬럼 저장 흉내.
 *   - `Prisma.DbNull`/`Prisma.JsonNull` → null (조회하면 null 로 돌아온다)
 *   - 그 밖은 **JSON 왕복**시킨다. 객체 참조를 그대로 들고 있으면 `undefined` 필드나
 *     Date 객체가 살아남아, 실제 Postgres 에서는 사라질 값으로 테스트가 초록이 된다.
 */
function storeJson(value: unknown): unknown {
  if (value === Prisma.DbNull || value === Prisma.JsonNull) return null;
  return JSON.parse(JSON.stringify(value));
}

function cloneExam(row: FakeExamRow): FakeExamRow {
  return { ...row, questions: row.questions.map((q) => ({ ...q })) };
}

export const predictionTestDb = {
  exam: {
    async findMany(args?: {
      where?: unknown;
      include?: { questions?: boolean };
    }) {
      // 서비스는 항상 문항까지 함께 읽는다. 다른 형태가 들어오면 대역이 조용히
      // 관대해지지 않도록 던진다(파일 머리말 정책).
      if (args?.include?.questions !== true) {
        throw new Error(
          "predictionRunTestDb: exam.findMany 는 include:{questions:true} 만 지원한다.",
        );
      }
      return examRows
        .filter((row) =>
          matchesWhere(row as unknown as Record<string, unknown>, args?.where),
        )
        .map(cloneExam);
    },
  },
  examScope: {
    async findFirst(args?: { where?: unknown }) {
      const found = examScopeRows.find((row) =>
        matchesWhere(row as unknown as Record<string, unknown>, args?.where),
      );
      return found ? { ...found } : null;
    },
  },
  predictionRun: {
    async create(args: { data: Omit<FakePredictionRunRow, "id" | "createdAt"> }) {
      const data = args.data;
      const row: FakePredictionRunRow = {
        id: randomUUID(),
        createdAt: nextCreatedAt(),
        ...data,
        params: storeJson(data.params),
        predictedBlueprint: storeJson(data.predictedBlueprint),
        predictedScores: storeJson(data.predictedScores),
      };
      predictionRunRows.push(row);
      return { ...row };
    },
    async findUnique(args: { where: { id: string } }) {
      const found = predictionRunRows.find((row) => row.id === args.where.id);
      return found ? { ...found } : null;
    },
    async findMany(args?: {
      where?: unknown;
      orderBy?: { createdAt?: "asc" | "desc" };
    }) {
      const rows = predictionRunRows
        .filter((row) =>
          matchesWhere(row as unknown as Record<string, unknown>, args?.where),
        )
        .map((row) => ({ ...row }));
      const dir = args?.orderBy?.createdAt;
      if (dir) {
        rows.sort((a, b) =>
          dir === "desc"
            ? b.createdAt.getTime() - a.createdAt.getTime()
            : a.createdAt.getTime() - b.createdAt.getTime(),
        );
      }
      return rows;
    },
  },
};

// ─────────────────────────────────────────────
// 시드 헬퍼
// ─────────────────────────────────────────────

export interface SeedQuestion {
  number: number;
  score: number;
  qtype: QuestionType;
  difficultyLabel?: DifficultyLabel | null;
  topicRaw?: string | null;
  unitId?: string | null;
}

export interface SeedExamInput {
  externalExamId: string;
  school: string;
  level?: ExamLevel;
  grade?: number;
  subject?: string;
  year: number;
  semester: number;
  round: ExamRound;
  questions: SeedQuestion[];
  /** 생략하면 문항 배점 합. 잘린 시험지(만점 미달)를 재현할 때만 명시한다. */
  totalScore?: number;
}

/**
 * 정상 시험지 1편 — 만점 100 · 문항 20(배점 5). 신뢰 가드를 통과하는 최소 형태다.
 * `paperTrust` 기준(만점 95~105, 문항 10개 이상)을 만족해야 학습 근거로 잡힌다.
 */
export function standardQuestions(options?: {
  difficultyLabel?: DifficultyLabel | null;
  topicRaw?: string | null;
  count?: number;
}): SeedQuestion[] {
  const count = options?.count ?? 20;
  const score = 100 / count;
  return Array.from({ length: count }, (_, i) => ({
    number: i + 1,
    score,
    qtype: (i < count - 3 ? "객관식" : "서술형") as QuestionType,
    difficultyLabel:
      options?.difficultyLabel === undefined
        ? i % 3 === 0
          ? ("상" as DifficultyLabel)
          : i % 3 === 1
            ? ("중" as DifficultyLabel)
            : ("하" as DifficultyLabel)
        : options.difficultyLabel,
    topicRaw: options?.topicRaw === undefined ? "이차함수" : options.topicRaw,
  }));
}

export function seedExam(input: SeedExamInput): FakeExamRow {
  const examId = randomUUID();
  const questions: FakeExamQuestionRow[] = input.questions.map((q) => ({
    id: randomUUID(),
    examId,
    number: q.number,
    score: q.score,
    qtype: q.qtype,
    difficultyLabel: q.difficultyLabel ?? null,
    topicRaw: q.topicRaw ?? null,
    unitId: q.unitId ?? null,
    answer: null,
    hasFigure: false,
    problemId: null,
  }));
  const row: FakeExamRow = {
    id: examId,
    externalExamId: input.externalExamId,
    school: input.school,
    level: input.level ?? "중",
    grade: input.grade ?? 3,
    subject: input.subject ?? "중3",
    subjectRaw: null,
    year: input.year,
    semester: input.semester,
    round: input.round,
    totalScore:
      input.totalScore ?? questions.reduce((sum, q) => sum + q.score, 0),
    questionCount: questions.length,
    sourceFile: null,
    createdAt: nextCreatedAt(),
    updatedAt: nextCreatedAt(),
    questions,
  };
  examRows.push(row);
  return row;
}

export function seedExamScope(input: {
  school: string;
  level?: string;
  grade?: number;
  subject?: string;
  year: number;
  semester: number;
  round: string;
  unitIds: string[];
  confirmedAt: Date | null;
}): FakeExamScopeRow {
  const row: FakeExamScopeRow = {
    id: randomUUID(),
    school: input.school,
    level: input.level ?? "중",
    grade: input.grade ?? 3,
    subject: input.subject ?? "중3",
    year: input.year,
    semester: input.semester,
    round: input.round,
    unitIds: input.unitIds,
    confirmedAt: input.confirmedAt,
    note: null,
    createdAt: nextCreatedAt(),
    updatedAt: nextCreatedAt(),
  };
  examScopeRows.push(row);
  return row;
}

export function allPredictionRuns(): FakePredictionRunRow[] {
  return predictionRunRows.map((row) => ({ ...row }));
}

export function resetPredictionTestDb(): void {
  examRows = [];
  examScopeRows = [];
  predictionRunRows = [];
  clockTick = 0;
}
