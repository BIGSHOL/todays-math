/**
 * **적재 경로 배선** — 기출 문항이 들어오면 그 시험지의 `Exam`/`ExamQuestion` 도 함께 선다.
 *
 * 이게 없으면 「오늘 넣은 데이터에만 유효한 수리」가 된다. 이 저장소는 같은 사고를
 * 이미 한 번 겪었다 — 그림 치수를 채우는 코드가 적재 경로에 없어서 수리가 그날치에만
 * 유효했다(`toLoadRows` 의 `figureDims` 주석).
 *
 * ## 어디서 부르나
 *
 * - `scripts/import/load-classified.ts` — 이관 적재 직후, 건드린 `examId` 만.
 * - `scripts/qa/load-exam-metadata.ts` — 전량 소급 적재(원본 문서 제목까지 본다).
 *
 * ## 왜 «다시 짓는가»
 *
 * 넣은 행만 보지 않고 **그 편의 현재 문항 전부**를 다시 읽어 편을 짓는다. 편이 여러 번에
 * 걸쳐 들어오거나(트랙 F 는 실제로 두 번에 나눠 넣었다) 나중에 정답·배점이 백필돼도
 * 같은 결과가 나온다 — 멱등이 «두 번 돌려도 같다»만이 아니라 «언제 돌려도 그때의 진실»
 * 이어야 하기 때문이다.
 *
 * ## 문서 제목을 안 볼 때의 한계 (알고 쓴다)
 *
 * 이관 경로는 원본 PDF 를 열지 않으므로 시점 근거가 파일명뿐이다. 파일명이 실제와 다른
 * 부류가 있어서(머리말을 집어 온 144편) **파일명에 「대비」가 있으면 세우지 않는다**
 * (`decideExamIdentity`). 그 편들은 `unclassified` 로 세어 돌려주고, 나중에
 * `scripts/qa/extract-exam-header.py` → `build-exam-metadata` → `load-exam-metadata`
 * 를 돌리면 문서 제목을 근거로 채워진다. 이 함수는 멱등이라 그때 덮어써도 안전하다.
 */
import { buildExamPaper, type ExamQuestionSource } from "./buildExamPaper";
import {
  decideExamIdentity,
  type ExamHeaderDegraded,
  type ExamHeaderParse,
} from "./examIdentity";
import { detectKeyCollisions } from "./buildExamPaper";

/** `loadExamPaper` 가 필요한 최소 형태만 받는다 — 테스트 대역을 그대로 쓸 수 있게. */
type ExamCapableClient = Parameters<
  typeof import("../../../scripts/predictor/load-exams").loadExamPaper
>[0];

export interface SyncExamResult {
  inserted: number;
  updated: number;
  invalid: number;
  unclassified: Array<{ examId: string; reason: string }>;
  excluded: Array<{ examId: string; reason: string }>;
  collided: Array<{ examId: string; key: string }>;
}

export interface SyncExamOptions {
  /**
   * 편별 원본 문서 제목 파싱 결과. 없으면 파일명만 본다.
   * (이관 경로는 PDF 를 못 열어서 넘기지 않는다 — 머리주석의 한계 참조.)
   */
  headers?: Map<string, ExamHeaderParse | ExamHeaderDegraded | null>;
  /** 진행 보고. 전량 적재에서만 쓴다. */
  onProgress?: (done: number, total: number) => void;
}

interface ProblemLike {
  id: string;
  examId: string | null;
  sourceFile: string | null;
  questionNumber: number | null;
  score: number | null;
  questionType: string | null;
  answer: string;
  content: string;
  figureUrls: string[];
  figureSvg: string | null;
  unitId: string;
}

export async function syncExamMetadata(
  prisma: ExamCapableClient,
  examIds: readonly string[],
  options: SyncExamOptions = {},
): Promise<SyncExamResult> {
  const result: SyncExamResult = {
    inserted: 0,
    updated: 0,
    invalid: 0,
    unclassified: [],
    excluded: [],
    collided: [],
  };
  const ids = [...new Set(examIds.filter(Boolean))];
  if (ids.length === 0) return result;

  const client = prisma as unknown as {
    problem: {
      findMany: (args: unknown) => Promise<ProblemLike[]>;
    };
    unit: {
      findMany: (
        args: unknown,
      ) => Promise<Array<{ id: string; grade: string }>>;
    };
  };

  const problems = await client.problem.findMany({
    where: { source: "past_exam", examId: { in: ids } },
    select: {
      id: true,
      examId: true,
      sourceFile: true,
      questionNumber: true,
      score: true,
      questionType: true,
      answer: true,
      content: true,
      figureUrls: true,
      figureSvg: true,
      unitId: true,
    },
  });

  const unitIds = [...new Set(problems.map((p) => p.unitId))];
  const units = await client.unit.findMany({
    where: { id: { in: unitIds } },
    select: { id: true, grade: true },
  });
  const gradeOf = new Map(units.map((u) => [u.id, u.grade]));

  const byExam = new Map<string, ProblemLike[]>();
  for (const p of problems) {
    if (!p.examId) continue;
    const list = byExam.get(p.examId) ?? [];
    list.push(p);
    byExam.set(p.examId, list);
  }

  const { loadExamPaper } =
    await import("../../../scripts/predictor/load-exams");

  const staged: Array<{
    examId: string;
    paper: Awaited<ReturnType<typeof buildExamPaper>>["paper"];
  }> = [];

  for (const examId of ids) {
    const rows = byExam.get(examId) ?? [];
    if (rows.length === 0) {
      result.unclassified.push({
        examId,
        reason: "그 편의 기출 문항이 하나도 없다",
      });
      continue;
    }

    const unitGrades: Record<string, number> = {};
    for (const p of rows) {
      const grade = gradeOf.get(p.unitId);
      if (!grade) continue;
      unitGrades[grade] = (unitGrades[grade] ?? 0) + 1;
    }

    // 편 하나에 파일 경로가 둘일 수 있다(hwp/PDF 짝) — 가장 흔한 경로를 대표로 쓴다.
    const fileCount = new Map<string, number>();
    for (const p of rows) {
      if (p.sourceFile)
        fileCount.set(p.sourceFile, (fileCount.get(p.sourceFile) ?? 0) + 1);
    }
    const sourceFile =
      [...fileCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    const decision = decideExamIdentity({
      group: { examId, sourceFile, unitGrades },
      header: options.headers?.get(examId) ?? null,
    });
    if (decision.status === "제외") {
      result.excluded.push({ examId, reason: decision.detail });
      continue;
    }
    if (decision.status === "미분류") {
      result.unclassified.push({ examId, reason: decision.reason });
      continue;
    }

    const sources: ExamQuestionSource[] = rows
      .filter(
        (p): p is ProblemLike & { questionNumber: number } =>
          typeof p.questionNumber === "number",
      )
      .map((p) => ({
        number: p.questionNumber,
        qtype: p.questionType,
        score: p.score,
        text: p.content,
        answer: p.answer,
        // ⚠️ `Problem` 에 시험지 원문 소단원·난이도 표기는 **없다**. 지어내지 않는다.
        topicRaw: null,
        difficultyLabel: null,
        hasFigure: (p.figureUrls?.length ?? 0) > 0 || p.figureSvg !== null,
        problemId: p.id,
      }));

    const built = buildExamPaper(decision.exam, sources);
    if (!built.paper) {
      result.unclassified.push({
        examId,
        reason: `편을 짓지 못했다 — ${built.reason ?? "사유 미상"}`,
      });
      continue;
    }
    staged.push({ examId, paper: built.paper });
  }

  // 자연키가 겹치면 **양쪽 다** 막는다 — upsert 면 나중 편이 앞 편을 조용히 덮는다.
  const { collided, groups } = detectKeyCollisions(
    staged
      .filter((s) => s.paper)
      .map((s) => ({ examId: s.examId, key: s.paper!.externalExamId })),
  );

  let done = 0;
  for (const s of staged) {
    if (!s.paper) continue;
    if (collided.has(s.examId)) {
      result.collided.push({ examId: s.examId, key: s.paper.externalExamId });
      continue;
    }
    const r = await loadExamPaper(prisma, s.paper);
    if (r.status === "inserted") result.inserted += 1;
    else if (r.status === "updated") result.updated += 1;
    else if (r.status === "invalid") result.invalid += 1;
    done += 1;
    options.onProgress?.(done, staged.length);
  }
  void groups;

  return result;
}
