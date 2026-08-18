/**
 * 기출 메타데이터 — **실태 조사 + `Exam`/`ExamQuestion` 적재 후보 생성.**
 *
 * 읽기 전용이다. 적재는 `scripts/qa/load-exam-metadata.ts` 가 한다.
 *
 *   npx tsx scripts/qa/build-exam-metadata.ts
 *
 * ## 입력 넷 (앞의 셋은 먼저 만들어 둔다)
 *
 * | 입력 | 만드는 법 | 무엇을 주나 |
 * |---|---|---|
 * | `exam-groups.json` | `npx tsx scripts/qa/dump-exam-groups.ts` | 편 단위 묶음·단원 라벨 |
 * | `headers.jsonl` | `python scripts/qa/extract-exam-header.py` | **원본 문서 제목줄** |
 * | `index-batch/*.json` | `python scripts/qa/export-index-batch.py` | 색인이 가진 **전체 문항** |
 * | 공유 DB `problem` | — | 우리가 가진 문항 |
 *
 * ## 문항 원천이 둘이다 — 어느 쪽인지 **행마다 적는다**
 *
 * - **색인본**: 그 편의 문항이 **전부** 있다. 소단원·난이도 원문도 있다.
 * - **문제은행본**: `Problem` 에 들어온 것만. 실측 2,701편 중 1,968편이 뚫려 있고
 *   빠진 문항이 10,605개다. 소단원·난이도 원문은 `Problem` 에 **없어서 null 이다**
 *   (지어내지 않는다).
 *
 * 뚫린 편을 그대로 실어도 되는 이유는 소비 쪽 신뢰 가드(`paperTrust`)가 만점 95~105·
 * 문항 10 이상만 학습·출제에 쓰기 때문이다. 총점을 **메우지 않는 것이 곧 안전장치**다.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import type { ExamPaper } from "../../src/contracts/predictor.contract";
import {
  buildExamPaper,
  detectKeyCollisions,
  type ExamQuestionSource,
} from "../../src/lib/import/buildExamPaper";
import {
  decideExamIdentity,
  parseExamFileName,
  parseExamHeader,
  type ExamHeaderDegraded,
  type ExamHeaderParse,
} from "../../src/lib/import/examIdentity";
import { isDirectScript } from "../import/isDirectScript";

const DIR = "scripts/qa/reports/exam-metadata";
const GROUPS = `${DIR}/exam-groups.json`;
const HEADERS = `${DIR}/headers.jsonl`;
const INDEX_BATCH = "scripts/qa/reports/index-batch";

interface GroupRow {
  examId: string;
  sourceFile: string | null;
  school: string | null;
  subject: string | null;
  held: number;
  minNumber: number | null;
  maxNumber: number | null;
  withScore: number;
  withQuestionType: number;
  sumScore: number | null;
  unitGrades: Record<string, number>;
}

interface HeaderRow {
  examId: string;
  sourceFile: string;
  readFrom?: string | null;
  status: string;
  lines?: string[];
}

interface ProblemRow {
  id: string;
  examId: string;
  questionNumber: number | null;
  score: number | null;
  questionType: string | null;
  answer: string;
  content: string;
  hasFigure: boolean;
}

export interface ExamDecisionRecord {
  examId: string;
  sourceFile: string | null;
  status: "확정" | "제외" | "미분류" | "충돌";
  reason?: string;
  externalExamId?: string;
  periodSource?: "문서제목" | "파일명";
  filenameDisagreed?: boolean;
  headerDisagreed?: boolean;
  questionSource?: "색인본" | "문제은행본";
  questions?: number;
  totalScore?: number;
  linkedProblems?: number;
  trusted?: boolean;
}

export interface BuildSurvey {
  groups: number;
  exams: number;
  /** 파일명이 구조를 지킨 편 / 전체 */
  filenameParsed: number;
  /** 원본 문서 제목을 실제로 읽은 편 */
  headerRead: number;
  headerDegraded: number;
  headerMissing: number;
  /** 문서 제목이 이겨 파일명을 버린 편 */
  periodDisagreed: number;
  /** ⭐ 파일명이 이겨 **문서 제목을 버린** 편 — 제목도 틀린다 */
  headerWrong: number;
  decided: number;
  excludedPrep: number;
  unclassified: number;
  collided: number;
  /** 적재 후보 */
  papers: number;
  questions: number;
  fromIndex: number;
  fromProblems: number;
  linkedProblems: number;
  scoreFilled: number;
  droppedNoQtype: number;
  droppedNoScore: number;
  /** `paperTrust` 를 통과할 편 — 학습·출제에 실제로 쓰이는 몫이다 */
  trusted: number;
  unclassifiedReasons: Record<string, number>;
}

function readHeaders(): Map<
  string,
  ExamHeaderParse | ExamHeaderDegraded | null
> {
  const out = new Map<string, ExamHeaderParse | ExamHeaderDegraded | null>();
  if (!existsSync(HEADERS)) return out;
  for (const line of readFileSync(HEADERS, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as HeaderRow;
    // 같은 편이 여러 번 있으면 **줄을 실제로 읽은 것**이 이긴다(재시도 이력).
    if (!row.lines) {
      if (!out.has(row.examId)) out.set(row.examId, null);
      continue;
    }
    out.set(row.examId, parseExamHeader(row.lines));
  }
  return out;
}

/** 색인 내보내기(`index-batch/*.json`)에서 편별 전체 문항을 읽는다. 없으면 빈 지도. */
function readIndexBatch(): Map<string, ExamQuestionSource[]> {
  const out = new Map<string, ExamQuestionSource[]>();
  if (!existsSync(INDEX_BATCH)) return out;
  for (const name of readdirSync(INDEX_BATCH)) {
    if (!name.endsWith(".json")) continue;
    let doc: {
      meta?: { exam_id?: number | string };
      questions?: Array<{
        number?: number;
        type?: string;
        score?: number;
        topic?: string | null;
        difficulty?: string | null;
        contents?: Array<{ type?: string; value?: string }>;
      }>;
      _answers?: Array<{
        number?: number;
        answer?: string;
        topic?: string | null;
        difficulty?: string | null;
      }>;
    };
    try {
      doc = JSON.parse(readFileSync(join(INDEX_BATCH, name), "utf-8"));
    } catch {
      continue;
    }
    const examId = String(doc.meta?.exam_id ?? name.replace(/\.json$/, ""));
    const answers = new Map<
      number,
      { answer?: string; topic?: string | null; difficulty?: string | null }
    >();
    for (const a of doc._answers ?? []) {
      if (typeof a.number === "number") answers.set(a.number, a);
    }
    const rows: ExamQuestionSource[] = [];
    for (const q of doc.questions ?? []) {
      if (typeof q.number !== "number") continue;
      const merged = answers.get(q.number);
      rows.push({
        number: q.number,
        qtype: q.type ?? null,
        score: typeof q.score === "number" && q.score > 0 ? q.score : null,
        text: (q.contents ?? [])
          .map((c) => (typeof c.value === "string" ? c.value : ""))
          .join(" "),
        answer: merged?.answer ?? null,
        topicRaw: q.topic ?? merged?.topic ?? null,
        difficultyLabel: q.difficulty ?? merged?.difficulty ?? null,
        hasFigure: (q.contents ?? []).some((c) => c.type === "figure"),
        problemId: null,
      });
    }
    if (rows.length > 0) out.set(examId, rows);
  }
  return out;
}

async function readProblems(): Promise<Map<string, ProblemRow[]>> {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.$queryRaw<
      Array<{
        id: string;
        exam_id: string;
        question_number: number | null;
        score: number | null;
        question_type: string | null;
        answer: string;
        content: string;
        has_figure: boolean;
      }>
    >`
      select id, exam_id, question_number, score, question_type, answer, content,
             (coalesce(array_length(figure_urls, 1), 0) > 0 or figure_svg is not null) as has_figure
      from problem
      where source = 'past_exam' and exam_id is not null`;
    const out = new Map<string, ProblemRow[]>();
    for (const r of rows) {
      const list = out.get(r.exam_id) ?? [];
      list.push({
        id: r.id,
        examId: r.exam_id,
        questionNumber: r.question_number,
        score: r.score,
        questionType: r.question_type,
        answer: r.answer,
        content: r.content,
        hasFigure: r.has_figure,
      });
      out.set(r.exam_id, list);
    }
    return out;
  } finally {
    await prisma.$disconnect();
  }
}

/** 신뢰 가드와 **같은 함수**를 쓴다 — 여기서 규칙을 옮겨 적지 않는다. */
async function trustOf(paper: ExamPaper): Promise<boolean> {
  const { isTrustworthyPaper } =
    await import("../../src/lib/predictor/paperTrust");
  return isTrustworthyPaper(paper);
}

export async function buildExamMetadata(): Promise<{
  survey: BuildSurvey;
  papers: ExamPaper[];
  decisions: ExamDecisionRecord[];
}> {
  const groups = JSON.parse(readFileSync(GROUPS, "utf-8")) as GroupRow[];
  const headers = readHeaders();
  const indexQuestions = readIndexBatch();
  const problems = await readProblems();

  // 편 하나에 파일이 둘일 수 있다(hwp/PDF 짝) — 문항을 많이 가진 쪽의 경로를 대표로 쓴다.
  const byExam = new Map<string, GroupRow>();
  for (const g of groups) {
    const prev = byExam.get(g.examId);
    if (!prev || g.held > prev.held) byExam.set(g.examId, g);
  }

  const survey: BuildSurvey = {
    groups: groups.length,
    exams: byExam.size,
    filenameParsed: 0,
    headerRead: 0,
    headerDegraded: 0,
    headerMissing: 0,
    periodDisagreed: 0,
    headerWrong: 0,
    decided: 0,
    excludedPrep: 0,
    unclassified: 0,
    collided: 0,
    papers: 0,
    questions: 0,
    fromIndex: 0,
    fromProblems: 0,
    linkedProblems: 0,
    scoreFilled: 0,
    droppedNoQtype: 0,
    droppedNoScore: 0,
    trusted: 0,
    unclassifiedReasons: {},
  };

  const decisions: ExamDecisionRecord[] = [];
  const staged: Array<{
    examId: string;
    record: ExamDecisionRecord;
    paper: ExamPaper;
  }> = [];

  for (const [examId, g] of byExam) {
    if (g.sourceFile && parseExamFileName(g.sourceFile))
      survey.filenameParsed += 1;
    const header = headers.get(examId) ?? null;
    if (header && "degraded" in header) survey.headerDegraded += 1;
    else if (header) survey.headerRead += 1;
    else survey.headerMissing += 1;

    const decision = decideExamIdentity({
      group: {
        examId,
        sourceFile: g.sourceFile,
        unitGrades: g.unitGrades,
      },
      header,
    });

    if (decision.status === "제외") {
      survey.excludedPrep += 1;
      decisions.push({
        examId,
        sourceFile: g.sourceFile,
        status: "제외",
        reason: decision.detail,
      });
      continue;
    }
    if (decision.status === "미분류") {
      survey.unclassified += 1;
      survey.unclassifiedReasons[decision.reason] =
        (survey.unclassifiedReasons[decision.reason] ?? 0) + 1;
      decisions.push({
        examId,
        sourceFile: g.sourceFile,
        status: "미분류",
        reason: decision.reason,
      });
      continue;
    }

    survey.decided += 1;
    if (decision.filenameDisagreed) survey.periodDisagreed += 1;
    if (decision.headerDisagreed) survey.headerWrong += 1;

    const held = problems.get(examId) ?? [];
    const byNumber = new Map<number, ProblemRow>();
    for (const p of held) {
      if (typeof p.questionNumber === "number")
        byNumber.set(p.questionNumber, p);
    }

    const fromIndex = indexQuestions.get(examId);
    let sources: ExamQuestionSource[];
    let questionSource: "색인본" | "문제은행본";
    if (fromIndex && fromIndex.length >= held.length) {
      questionSource = "색인본";
      sources = fromIndex.map((q) => ({
        ...q,
        problemId: byNumber.get(q.number)?.id ?? null,
      }));
    } else {
      questionSource = "문제은행본";
      sources = held
        .filter(
          (p): p is ProblemRow & { questionNumber: number } =>
            typeof p.questionNumber === "number",
        )
        .map((p) => ({
          number: p.questionNumber,
          qtype: p.questionType,
          score: p.score,
          text: p.content,
          answer: p.answer,
          // ⚠️ `Problem` 에는 시험지 원문 소단원·난이도 표기가 **없다.** 지어내지 않는다.
          topicRaw: null,
          difficultyLabel: null,
          hasFigure: p.hasFigure,
          problemId: p.id,
        }));
    }

    const built = buildExamPaper(decision.exam, sources);
    survey.droppedNoQtype += built.dropped.noQtype;
    survey.droppedNoScore += built.dropped.noScore;

    if (!built.paper) {
      survey.decided -= 1;
      survey.unclassified += 1;
      const reason = `편을 짓지 못했다 — ${built.reason ?? "사유 미상"}`;
      survey.unclassifiedReasons[reason] =
        (survey.unclassifiedReasons[reason] ?? 0) + 1;
      decisions.push({
        examId,
        sourceFile: g.sourceFile,
        status: "미분류",
        reason,
      });
      continue;
    }

    survey.scoreFilled += built.scoreFilled;
    survey.linkedProblems += built.linkedProblems;
    if (questionSource === "색인본") survey.fromIndex += 1;
    else survey.fromProblems += 1;

    staged.push({
      examId,
      paper: built.paper,
      record: {
        examId,
        sourceFile: g.sourceFile,
        status: "확정",
        externalExamId: built.paper.externalExamId,
        periodSource: decision.periodSource,
        filenameDisagreed: decision.filenameDisagreed,
        headerDisagreed: decision.headerDisagreed,
        questionSource,
        questions: built.paper.questions.length,
        totalScore: built.paper.totalScore,
        linkedProblems: built.linkedProblems,
      },
    });
  }

  // 자연키 충돌은 **양쪽 다** 막는다 — upsert 로 넣으면 나중 편이 앞 편을 조용히 덮는다.
  const { collided, groups: collisionGroups } = detectKeyCollisions(
    staged.map((s) => ({ examId: s.examId, key: s.paper.externalExamId })),
  );
  const papers: ExamPaper[] = [];
  for (const s of staged) {
    if (collided.has(s.examId)) {
      survey.decided -= 1;
      survey.collided += 1;
      const group = collisionGroups.find((g) => g.examIds.includes(s.examId));
      decisions.push({
        ...s.record,
        status: "충돌",
        reason: `자연키가 겹친다 — 원본 편 ${group?.examIds.join(", ")}`,
      });
      continue;
    }
    const trusted = await trustOf(s.paper);
    if (trusted) survey.trusted += 1;
    papers.push(s.paper);
    survey.papers += 1;
    survey.questions += s.paper.questions.length;
    decisions.push({ ...s.record, trusted });
  }

  return { survey, papers, decisions };
}

function printSurvey(s: BuildSurvey): void {
  const pct = (n: number, d: number) =>
    d ? ((n / d) * 100).toFixed(1) : "0.0";
  console.log(`[exam-metadata] 편 ${s.exams} (그룹행 ${s.groups})`);
  console.log(
    `  파일명 파싱 ${s.filenameParsed} (${pct(s.filenameParsed, s.exams)}%)` +
      ` · 문서제목 읽음 ${s.headerRead} · 훼손 ${s.headerDegraded} · 못읽음 ${s.headerMissing}`,
  );
  console.log(
    `  판정: 확정 ${s.decided} · 제외(대비) ${s.excludedPrep} · 미분류 ${s.unclassified} · 충돌 ${s.collided}`,
  );
  console.log(
    `  ⭐ 시점 불일치 — 문서제목이 이김 ${s.periodDisagreed} · **파일명이 이김 ${s.headerWrong}**`,
  );
  console.log(
    `  후보: 편 ${s.papers} · 문항 ${s.questions}` +
      ` (색인본 ${s.fromIndex}편 · 문제은행본 ${s.fromProblems}편)`,
  );
  console.log(
    `  문제은행 연결 ${s.linkedProblems} · 배점 메움 ${s.scoreFilled}` +
      ` · 못 실은 문항: 유형없음 ${s.droppedNoQtype} · 배점없음 ${s.droppedNoScore}`,
  );
  console.log(
    `  신뢰 가드(paperTrust) 통과 ${s.trusted}/${s.papers} (${pct(s.trusted, s.papers)}%)`,
  );
  const reasons = Object.entries(s.unclassifiedReasons).sort(
    (a, b) => b[1] - a[1],
  );
  if (reasons.length) {
    console.log("  미분류 사유:");
    for (const [reason, n] of reasons)
      console.log(`    ${n.toString().padStart(5)}  ${reason}`);
  }
}

if (isDirectScript(import.meta.url)) {
  buildExamMetadata()
    .then(({ survey, papers, decisions }) => {
      mkdirSync(DIR, { recursive: true });
      writeFileSync(`${DIR}/candidates.json`, JSON.stringify(papers), "utf-8");
      writeFileSync(
        `${DIR}/decisions.json`,
        JSON.stringify(decisions, null, 1),
        "utf-8",
      );
      writeFileSync(
        `${DIR}/survey.json`,
        JSON.stringify(survey, null, 1),
        "utf-8",
      );
      printSurvey(survey);
      console.log(`  → ${DIR}/{candidates,decisions,survey}.json`);
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
