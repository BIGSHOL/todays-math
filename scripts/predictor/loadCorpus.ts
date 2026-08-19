/**
 * 추출 산출물 → ExamPaper 코퍼스 로더 (IO 담당).
 *
 * 엔진(`src/lib/predictor/*`)은 파일을 읽지 않는다 — 순수 함수만 둔다.
 * 파일을 만지는 것은 이 파일과 `build-period-map.py` 뿐이다.
 *
 * ⚠️ `Problem` 테이블이 아니라 **추출 JSON 원본**을 읽는다.
 *    적재 과정에서 유형·소단원 원문이 사라지고 문항 일부가 탈락해
 *    시험지 통계가 이미 깨져 있기 때문이다(11 §2.4).
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { normalizeDifficultyLabel } from "../../src/lib/import/buildExamPaper";
import { fillScore } from "../../src/lib/predictor/fillScore";
import type {
  ExamLevel,
  ExamPaper,
  ExamQuestion,
  ExamRound,
  QuestionType,
} from "../../src/contracts/predictor.contract";

// 저장소 루트 — 스크립트는 저장소 루트에서 실행한다(`npx tsx scripts/predictor/...`).
// tsx 가 CJS 로 변환할 때 import.meta.dirname 이 없어서 cwd 를 쓴다.
const REPO = process.env.PREDICTOR_REPO_DIR ?? process.cwd();

const CORPUS_DIR =
  process.env.PREDICTOR_CORPUS_DIR ??
  resolve(REPO, "..", "handoff-a-index", "scripts", "qa", "reports");

const PERIOD_MAP = resolve(REPO, "scripts", "qa", "reports", "period-map.json");

const SUBDIRS = ["final-batch", "index-batch"];

const QTYPE: Record<string, QuestionType> = {
  객관식: "객관식",
  단답형: "단답형",
  서술형: "서술형",
};

// 난이도 라벨 정규화는 `src/lib/import/buildExamPaper.ts` 한 곳에만 둔다 —
// 규칙이 두 벌이 되면 한쪽만 고쳐도 아무도 모른다(CLAUDE.md 2026-08-18).

interface RawQuestion {
  number?: number;
  type?: string;
  score?: number;
  topic?: string | null;
  difficulty?: string | null;
  contents?: Array<{ type?: string; value?: string }>;
  choices?: unknown[];
}

interface RawDoc {
  meta?: {
    exam_id?: number | string;
    school?: string;
    grade?: string;
    subject?: string;
    level?: string;
    raw_grade?: number;
  };
  _sourceFile?: string;
  questions?: RawQuestion[];
  _answers?: Array<{
    number?: number;
    answer?: string;
    topic?: string | null;
    difficulty?: string | null;
  }>;
}

export interface LoadStats {
  files: number;
  papers: number;
  questions: number;
  droppedNoPeriod: number;
  droppedNoMeta: number;
  droppedTooFew: number;
  /** 배점이 없어 편 중앙값으로 채운 문항 수. 통계에 섞이는 유일한 추정치다. */
  scoreFilled: number;
}

/** 문항 본문 텍스트. 서술형 머리표의 `[합 N점]` 표기를 여기서 읽는다. */
function questionText(q: RawQuestion): string {
  return (q.contents ?? [])
    .map((c) => (typeof c.value === "string" ? c.value : ""))
    .join(" ");
}

function toPaper(
  doc: RawDoc,
  fallbackId: string,
  periods: Record<string, { year: number; semester: number; round: string }>,
  stats: LoadStats,
): ExamPaper | null {
  const meta = doc.meta;
  const examId = String(meta?.exam_id ?? fallbackId);
  const period = periods[examId];
  if (!period) {
    stats.droppedNoPeriod += 1;
    return null;
  }
  const level =
    meta?.level === "중" || meta?.level === "고"
      ? (meta.level as ExamLevel)
      : null;
  const grade = meta?.raw_grade;
  const subject = meta?.grade;
  if (!meta?.school || !level || !grade || !subject) {
    stats.droppedNoMeta += 1;
    return null;
  }
  if (period.round !== "중간" && period.round !== "기말") {
    stats.droppedNoPeriod += 1;
    return null;
  }
  if (period.semester !== 1 && period.semester !== 2) {
    stats.droppedNoPeriod += 1;
    return null;
  }

  const answers = new Map<
    number,
    { answer?: string; topic?: string | null; difficulty?: string | null }
  >();
  for (const a of doc._answers ?? []) {
    if (typeof a.number === "number") answers.set(a.number, a);
  }

  const raw = (doc.questions ?? []).filter((q) => typeof q.number === "number");

  // 배점 채움의 근거는 **같은 유형**이 먼저다. 편 전체 중앙값으로 메우면 서술형
  // (10점) 자리에 객관식이 지배하는 중앙값(3~4점)이 들어가 총점이 모자라고,
  // 그 시험지가 만점 100 가드에 걸려 통째로 버려진다(`fillScore.ts` 머리주석).
  const scored = raw
    .map((q) => ({
      qtype: QTYPE[q.type ?? ""] ?? null,
      score: typeof q.score === "number" && q.score > 0 ? q.score : null,
    }))
    .filter(
      (q): q is { qtype: QuestionType; score: number | null } =>
        q.qtype !== null,
    );

  const questions: ExamQuestion[] = [];
  for (const q of raw) {
    const merged = answers.get(q.number as number);
    const qtype = QTYPE[q.type ?? ""] ?? null;
    if (!qtype) continue;

    // 배점이 있어도 fillScore 를 태운다 — 본문에 `[합/총 N점]` 표기가 남아 있고
    // 기록 배점이 그보다 작으면 하위 소문항 오집이라 표기로 **정정**된다(15 §A.1).
    const raw0 = typeof q.score === "number" && q.score > 0 ? q.score : null;
    const filled = fillScore(
      { qtype, score: raw0, text: questionText(q) },
      scored,
    );
    if (filled.score === null) continue;
    const score = filled.score;
    if (filled.basis !== "없음") stats.scoreFilled += 1;

    const label = q.difficulty ?? merged?.difficulty ?? null;
    const topic = q.topic ?? merged?.topic ?? null;
    const hasFigure = (q.contents ?? []).some((c) => c.type === "figure");

    questions.push({
      number: q.number as number,
      score,
      qtype,
      difficultyLabel: normalizeDifficultyLabel(label),
      topicRaw: topic ? String(topic).slice(0, 100) : null,
      // 추출 산출물에는 우리 트리 단원이 없다 — 원문 표기로만 다룬다(11 §2.4).
      unitId: null,
      answer: merged?.answer ? String(merged.answer).slice(0, 2000) : null,
      hasFigure,
      problemId: null,
    });
  }

  if (questions.length < 5) {
    stats.droppedTooFew += 1;
    return null;
  }
  questions.sort((a, b) => a.number - b.number);

  return {
    externalExamId: examId,
    series: { school: meta.school, level, grade, subject },
    period: {
      year: period.year,
      semester: period.semester as 1 | 2,
      round: period.round as ExamRound,
    },
    subjectRaw: meta.subject ?? null,
    totalScore: Number(questions.reduce((s, q) => s + q.score, 0).toFixed(4)),
    questions,
    sourceFile: doc._sourceFile ? String(doc._sourceFile).slice(0, 500) : null,
  };
}

export function loadCorpus(): { papers: ExamPaper[]; stats: LoadStats } {
  if (!existsSync(PERIOD_MAP)) {
    throw new Error(
      `period-map.json 이 없다. 먼저 실행하라:\n` +
        `  PYTHONIOENCODING=utf-8 python scripts/predictor/build-period-map.py`,
    );
  }
  const periods = JSON.parse(readFileSync(PERIOD_MAP, "utf-8")) as Record<
    string,
    { year: number; semester: number; round: string }
  >;

  const stats: LoadStats = {
    files: 0,
    papers: 0,
    questions: 0,
    droppedNoPeriod: 0,
    droppedNoMeta: 0,
    droppedTooFew: 0,
    scoreFilled: 0,
  };
  const papers: ExamPaper[] = [];
  const seen = new Set<string>();

  for (const sub of SUBDIRS) {
    const dir = join(CORPUS_DIR, sub);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".json")) continue;
      stats.files += 1;
      let doc: RawDoc;
      try {
        doc = JSON.parse(readFileSync(join(dir, name), "utf-8")) as RawDoc;
      } catch {
        continue;
      }
      const paper = toPaper(doc, name.replace(/\.json$/, ""), periods, stats);
      if (!paper) continue;
      // 같은 exam_id 가 두 디렉토리에 있으면 먼저 읽은 쪽(final-batch)을 쓴다.
      if (seen.has(paper.externalExamId)) continue;
      seen.add(paper.externalExamId);
      papers.push(paper);
      stats.papers += 1;
      stats.questions += paper.questions.length;
    }
  }

  return { papers, stats };
}

export const CORPUS_PATHS = { CORPUS_DIR, PERIOD_MAP };
