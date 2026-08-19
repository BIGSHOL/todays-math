/**
 * 문항 원천 → `ExamPaper` 한 편. **순수 함수다** — DB·파일을 만지지 않는다.
 *
 * ## 총점을 100 으로 맞추지 않는다
 *
 * `Exam.totalScore` 는 **실은 우리가 가진 문항의 배점 합**이다. 원본 시험지의 만점이
 * 아니다. 이 둘을 섞으면 「그 학교는 62점 만점에 18문항을 낸다」를 학습한다.
 * 대신 그 값을 그대로 실어 두면 소비 쪽 신뢰 가드(`paperTrust`, 만점 95~105·문항 10 이상)가
 * **불완전한 편을 학습·채점·출제에서 자동으로 뺀다.** 그래서 여기서는 **메우지 않는 것이
 * 곧 안전장치**다 — 메우면 그 가드가 눈이 먼다.
 *
 * ## 실측 (2026-08-18, 기출 2,701편)
 *
 * 우리 DB 는 편 대부분이 **뚫려 있다.** 1,968편이 번호 1..max 를 못 채우고, 빠진 문항이
 * 10,605개다. 그리고 「구멍이 없다(가진 수 == 최대 번호)」는 **완비의 증거가 아니다** —
 * 색인이 덮는 357편으로 반증했더니 «구멍 없음» 87편 중 6편이 실제로는 뒤가 잘려 있었고,
 * 한 편은 1문항만 갖고도 «완비»로 읽혔다. 그래서 이 모듈은 완비 여부를 **판정하지 않고**,
 * 가진 것을 정직하게 실어 `paperTrust` 가 가르게 둔다.
 */
import {
  examPaperSchema,
  type ExamPaper,
  type ExamQuestion,
  type DifficultyLabel,
  type QuestionType,
} from "@/contracts/predictor.contract";
import { fillScore } from "@/lib/predictor/fillScore";
import { MISSING_ANSWER } from "@/lib/missingAnswer";

import type { ResolvedExam } from "./examIdentity";

// 문항 수 상한(60)은 **계약이 이미 막는다**(`examPaperSchema.questions.max(60)`,
// 사유 문구에 60 도 들어 있다). 여기서 한 번 더 세던 검사는 변이 시험에서 살아남았다 —
// 대수적으로 같은 말이라 아무것도 더 안 갈랐다. 지웠다(CLAUDE.md 2026-08-18).

/** 원본의 사람 난이도 표기. 3단계로 접되 **모르는 표기는 지어내지 않는다**. */
const DIFFICULTY: Record<string, DifficultyLabel> = {
  하: "하",
  중: "중",
  상: "상",
  중하: "중",
  중상: "중",
  킬러: "상",
};

export function normalizeDifficultyLabel(
  raw: string | null | undefined,
): DifficultyLabel | null {
  if (!raw) return null;
  return DIFFICULTY[raw.trim()] ?? null;
}

const QTYPE: Record<string, QuestionType> = {
  객관식: "객관식",
  단답형: "단답형",
  서술형: "서술형",
};

export function normalizeQuestionType(
  raw: string | null | undefined,
): QuestionType | null {
  if (!raw) return null;
  return QTYPE[raw.trim()] ?? null;
}

/**
 * ⚠️ **PostgreSQL 이 text 에 담지 못하는 글자를 걷어낸다.**
 *
 * 실측: 색인 원문 `topic` 에 NUL(0x00)이 섞인 편이 2개 있었고, 그 한 글자 때문에
 * `createMany` 가 「invalid byte sequence for encoding "UTF8": 0x00」 으로 터져
 * **그 편 전체**가 적재되지 않았다. 계약 검증은 이걸 못 잡는다 — 유효한 문자열이기 때문이다.
 * 값을 만들어 내는 것이 아니라 **저장 불가능한 글자만** 지우고, 남는 게 없으면 null 이다.
 */
const UNSTORABLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export function sanitizeStoredText(
  raw: string | null | undefined,
): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(UNSTORABLE, "").trim();
  return cleaned || null;
}

/** 정답 문자열. 센티널·공백은 **없는 것**이다(`hasRealAnswer` 와 같은 규칙). */
export function normalizeAnswer(raw: string | null | undefined): string | null {
  const t = sanitizeStoredText(raw);
  if (!t || t === MISSING_ANSWER) return null;
  return t.slice(0, 2_000);
}

export interface ExamQuestionSource {
  number: number;
  qtype: string | null;
  score: number | null;
  /** 문항 본문 — `[합 N점]` 표기를 읽는 데만 쓴다. 절대 저장하지 않는다. */
  text?: string | null;
  answer: string | null;
  topicRaw: string | null;
  difficultyLabel: string | null;
  hasFigure: boolean;
  problemId: string | null;
}

export interface BuildExamPaperResult {
  paper: ExamPaper | null;
  /** 편을 못 지은 사유. `paper` 가 있으면 undefined. */
  reason?: string;
  /** 싣지 못한 문항을 **세어서** 돌려준다 — 조용히 버리지 않는다. */
  dropped: { noQtype: number; noScore: number };
  /** 배점을 메운 문항 수. 통계에 섞이는 유일한 추정치다. */
  scoreFilled: number;
  /** 문제은행과 이어진 문항 수. */
  linkedProblems: number;
}

export function buildExamPaper(
  exam: ResolvedExam,
  sources: readonly ExamQuestionSource[],
): BuildExamPaperResult {
  const dropped = { noQtype: 0, noScore: 0 };
  let scoreFilled = 0;
  let linkedProblems = 0;

  const numbers = new Set<number>();
  for (const s of sources) {
    if (numbers.has(s.number)) {
      return {
        paper: null,
        reason: `같은 문항 번호(${s.number})가 둘 이상이다 — 어느 쪽이 맞는지 알 수 없다`,
        dropped,
        scoreFilled,
        linkedProblems,
      };
    }
    numbers.add(s.number);
  }

  // 배점 메우기의 근거는 **같은 유형**이 먼저다(fillScore 머리주석).
  const typed = sources
    .map((s) => ({ qtype: normalizeQuestionType(s.qtype), score: s.score }))
    .filter(
      (s): s is { qtype: QuestionType; score: number | null } =>
        s.qtype !== null,
    );

  const questions: ExamQuestion[] = [];
  for (const s of sources) {
    const qtype = normalizeQuestionType(s.qtype);
    if (!qtype) {
      dropped.noQtype += 1;
      continue;
    }
    const filled = fillScore({ qtype, score: s.score, text: s.text }, typed);
    if (filled.score === null) {
      dropped.noScore += 1;
      continue;
    }
    if (filled.basis !== "없음") scoreFilled += 1;
    if (s.problemId) linkedProblems += 1;

    questions.push({
      number: s.number,
      score: filled.score,
      qtype,
      difficultyLabel: normalizeDifficultyLabel(s.difficultyLabel),
      topicRaw: sanitizeStoredText(s.topicRaw)?.slice(0, 100) ?? null,
      // 우리 트리 단원은 이 적재기의 범위 밖이다 — 별도 태스크가 붙인다(11 §5).
      unitId: null,
      answer: normalizeAnswer(s.answer),
      hasFigure: s.hasFigure,
      problemId: s.problemId,
    });
  }

  if (questions.length === 0) {
    return {
      paper: null,
      reason: "실을 수 있는 문항이 하나도 없다",
      dropped,
      scoreFilled,
      linkedProblems,
    };
  }
  questions.sort((a, b) => a.number - b.number);

  const paper: ExamPaper = {
    externalExamId: exam.externalExamId,
    series: {
      school: exam.school,
      level: exam.level,
      grade: exam.grade,
      subject: exam.subject,
    },
    period: {
      year: exam.year,
      semester: exam.semester,
      round: exam.round,
    },
    subjectRaw: exam.subjectRaw,
    // 실제 합이다. 100 으로 맞추지 않는다 — 머리주석 참조.
    totalScore: Number(questions.reduce((s, q) => s + q.score, 0).toFixed(4)),
    questions,
    sourceFile: exam.sourceFile.slice(0, 500),
  };

  const parsed = examPaperSchema.safeParse(paper);
  if (!parsed.success) {
    return {
      paper: null,
      reason: parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
      dropped,
      scoreFilled,
      linkedProblems,
    };
  }

  return { paper: parsed.data, dropped, scoreFilled, linkedProblems };
}

export interface KeyCollision {
  key: string;
  examIds: string[];
}

/**
 * 자연키가 겹치면 **양쪽 다** 막는다.
 *
 * `externalExamId` 는 `@unique` 라 upsert 로 넣으면 나중 편이 앞 편을 **조용히 덮는다.**
 * 그건 「오류 없이 데이터가 사라지는」 부류다(brief-index-rebuild §3 ②와 같은 성질).
 * 그래서 겹치면 넣지 않고 세어서 보고한다.
 *
 * 같은 원본 편(`examId`)이 파일 둘(hwp/PDF 짝, 실측 2편)로 들어오는 것은 **충돌이 아니다** —
 * 그건 한 시험지다. 그래서 `examId` 가 다른 경우만 충돌로 본다.
 */
export function detectKeyCollisions(
  rows: ReadonlyArray<{ examId: string; key: string }>,
): { collided: Set<string>; groups: KeyCollision[] } {
  const byKey = new Map<string, Set<string>>();
  for (const r of rows) {
    const set = byKey.get(r.key) ?? new Set<string>();
    set.add(r.examId);
    byKey.set(r.key, set);
  }
  const groups: KeyCollision[] = [];
  const collided = new Set<string>();
  for (const [key, ids] of byKey) {
    if (ids.size < 2) continue;
    groups.push({ key, examIds: [...ids].sort() });
    for (const id of ids) collided.add(id);
  }
  return { collided, groups };
}
