/**
 * 기출 문항을 **편(시험지) 단위로 묶어** 내보낸다 — 기출 메타데이터 조사·적재의 입력.
 *
 * `Problem.examId` 는 testchanger 색인의 rowid 이고 재구축되면 다시 매겨진다
 * (docs/planning/tracks/brief-index-rebuild.md). 그래서 이 산출물은 **조사용 입력**일 뿐,
 * `Exam.externalExamId` 로 쓰지 않는다 — 그 키는 자연키로 만든다(buildExamKey).
 *
 * 읽기 전용이다. 공유 DB(D-31)에 쓰지 않는다.
 *
 *   npx tsx scripts/qa/dump-exam-groups.ts
 *   → scripts/qa/reports/exam-metadata/exam-groups.json
 */
import { mkdirSync, writeFileSync } from "node:fs";

import { isDirectScript } from "../import/isDirectScript";

const OUT_DIR = "scripts/qa/reports/exam-metadata";

export interface ExamGroupRow {
  examId: string;
  sourceFile: string | null;
  school: string | null;
  subject: string | null;
  /** 이 편에서 우리가 가진 문항 수 — 원본 시험지의 문항 수가 아니다. */
  held: number;
  minNumber: number | null;
  maxNumber: number | null;
  withScore: number;
  withQuestionType: number;
  sumScore: number | null;
  /** 문항들이 속한 우리 교육과정 라벨(Unit.grade)과 그 건수 — 과목 판정의 독립 근거. */
  unitGrades: Record<string, number>;
}

export async function dumpExamGroups(): Promise<ExamGroupRow[]> {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const groups = await prisma.$queryRaw<
      Array<{
        exam_id: string;
        source_file: string | null;
        school: string | null;
        subject: string | null;
        held: number;
        minq: number | null;
        maxq: number | null;
        with_score: number;
        with_qtype: number;
        sum_score: number | null;
      }>
    >`
      select exam_id, source_file, school, subject,
             count(*)::int as held,
             min(question_number)::int as minq,
             max(question_number)::int as maxq,
             count(score)::int as with_score,
             count(question_type)::int as with_qtype,
             sum(score)::float as sum_score
      from problem
      where source = 'past_exam' and exam_id is not null
      group by exam_id, source_file, school, subject
      order by exam_id`;

    const units = await prisma.$queryRaw<
      Array<{ exam_id: string; grade: string; n: number }>
    >`
      select pr.exam_id, u.grade, count(*)::int as n
      from problem pr join unit u on u.id = pr.unit_id
      where pr.source = 'past_exam' and pr.exam_id is not null
      group by pr.exam_id, u.grade`;

    const byExam = new Map<string, Record<string, number>>();
    for (const u of units) {
      const m = byExam.get(u.exam_id) ?? {};
      m[u.grade] = u.n;
      byExam.set(u.exam_id, m);
    }

    return groups.map((g) => ({
      examId: g.exam_id,
      sourceFile: g.source_file,
      school: g.school,
      subject: g.subject,
      held: g.held,
      minNumber: g.minq,
      maxNumber: g.maxq,
      withScore: g.with_score,
      withQuestionType: g.with_qtype,
      sumScore: g.sum_score,
      unitGrades: byExam.get(g.exam_id) ?? {},
    }));
  } finally {
    await prisma.$disconnect();
  }
}

if (isDirectScript(import.meta.url)) {
  dumpExamGroups()
    .then((rows) => {
      mkdirSync(OUT_DIR, { recursive: true });
      writeFileSync(
        `${OUT_DIR}/exam-groups.json`,
        JSON.stringify(rows),
        "utf-8",
      );
      const exams = new Set(rows.map((r) => r.examId));
      console.log(
        `[dump-exam-groups] 행 ${rows.length} · 편 ${exams.size} · ${OUT_DIR}/exam-groups.json`,
      );
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
