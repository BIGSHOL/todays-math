/**
 * 트랙 F 2차 · 공용 — **트랙 G 판정을 받아 적재 후보 행을 만든다.**
 * `load2-dedupe-check.ts`(중복 대조)·`load2-dry-run.ts`(드라이런)가 같이 쓴다.
 *
 * ## 1차와 무엇이 다른가 — `unitId` 의 출처 하나뿐이다
 *
 * | | 1차 (`load-candidates.ts`) | 2차 (여기) |
 * |---|---|---|
 * | 대상 | 시험지가 **소단원명을 적어 준** 문항 | 시험지가 **아무것도 안 적어 준** 문항 |
 * | `unitId` | `mapUnitHint(topic)` | **트랙 G 판정 파일 그대로** |
 * | 위생·제외 규칙 | — | **1차 것을 그대로 부른다** |
 *
 * **판정을 다시 하지 않는다.** G 의 `unitId` 를 그대로 쓴다(코디네이터 조건 3).
 * 다만 그 `unitId` 가 `Unit` 에 실재하는지, 문항의 학년과 단원의 학년이 맞는지는
 * 여기서 확인하고 안 맞으면 **넣지 않고 센다.**
 *
 * **위생 규칙을 베끼지 않았다.** `sanitizeContent`·`contentDefect` 는 1차 파일에서
 * 그대로 부른다 — 베끼면 판정이 갈라져 재현이 재현이 아니게 된다(F 보고 §7 과 같은 이유).
 *
 * **그림을 넣지 않는다.** `figureUrls` 는 트랙 A 소유라 비운 채로 둔다(조건 4).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { mapDifficultyLabel } from "../../src/lib/import/mapDifficulty";
import { mapProblemType } from "../../src/lib/import/mapProblemType";
import type { UnitLike } from "../../src/lib/import/types";
import { cleanAnswer, unitGrade, type HwpQuestion, type Pair } from "./load-survey";
import { MISSING_ANSWER, TRACK_D, contentDefect, sanitizeContent } from "./load-candidates";

/** 트랙 G 판정 파일. **읽기 전용** — G 워크트리에는 한 바이트도 쓰지 않는다. */
export const PREDICTIONS =
  process.env.TRACK_G_PREDICTIONS ??
  "C:/Users/user/orca/workspaces/testautocreator/잔여-G-소단원분류/scripts/classify/reports/unit-predictions.jsonl";

/** 실체 판정 최소 길이 — 원장 §1.1 정의(지문 원문). 1차와 같은 값이어야 한다. */
const MIN_REAL = 40;
const YEAR_FLOOR = 2023;
/** `(완료)` 표기 — D-37. */
const FINAL_MARK = /[(（]\s*완\s*료\s*[)）]/;

/** 트랙 G 판정 한 줄. */
export interface Prediction {
  externalId: string;
  examId: string;
  questionNumber: number;
  unitId: string;
  confidence: number;
  근거: {
    방법?: string;
    문턱?: number;
    실측_소단원정확도?: number;
    학년?: string;
    학기?: number | null;
    회차?: string | null;
    학교?: string | null;
    연도?: number | null;
    후보수?: number;
    단원?: string;
    차점단원?: string;
  };
}

export interface Candidate2 {
  externalId: string;
  examId: string;
  questionNumber: number;
  unitId: string;
  /** G 가 판정에 쓴 확신. 되돌리기 목록에 같이 남긴다. */
  confidence: number;
  /** G 가 적은 학년. 시험지 메타에서 우리가 다시 푼 학년과 대조한다. */
  판정학년: string | null;
  gradeHint: string | null;
  content: string;
  answer: string;
  solution: string | null;
  difficulty: string;
  problemType: string;
  questionType: string | null;
  score: number | null;
  school: string | null;
  subject: string | null;
  sourceFile: string;
  year: number | null;
  semester: number | null;
  round: string | null;
  level: string | null;
  figureCount: number;
}

export interface BuildResult2 {
  candidates: Candidate2[];
  /** 후보 행이 하나라도 남은 편. */
  papers: Map<string, Pair>;
  판정행: number;
  /** 어느 관문에서 몇 행이 떨어졌나. 합 + 후보 = 판정행 이어야 한다. */
  제외: Record<string, number>;
  /** 제외 행의 externalId 전량. 보고에는 수만 싣는다(tracks/README 공통규칙 4). */
  제외목록: Record<string, string[]>;
  /** 결함 행이 나온 편 → 행수. */
  결함편: Record<string, number>;
  /** 결함 사유별 행 수. */
  결함: Record<string, number>;
  /** 학년이 어긋난 행의 상세 — 넣지 않고 수를 보고한다(조건 3). */
  학년어긋남: Array<{
    externalId: string;
    시험지학년: string | null;
    단원학년: string;
    단원: string;
    G판정학년: string | null;
  }>;
}

const QUESTION_TYPES = new Set(["객관식", "단답형", "서술형"]);

function bump(record: Record<string, number>, key: string): void {
  record[key] = (record[key] ?? 0) + 1;
}

export async function readPredictions(): Promise<Prediction[]> {
  const text = await readFile(PREDICTIONS, "utf8");
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Prediction);
}

/**
 * @param units        DB `Unit` 전량 — 판정 `unitId` 가 실재하는지 여기서 본다.
 * @param loadedIds    DB 에 이미 있는 `externalId` 전량.
 * @param excludeExams 편 단위 중복으로 뺄 편.
 */
export async function buildCandidates2(
  units: UnitLike[],
  loadedIds: Set<string>,
  excludeExams: Set<string> = new Set(),
): Promise<BuildResult2> {
  const { buildHwpContent, stripWatermark } = (await import(
    pathToFileURL(path.join(TRACK_D, "../hwpJudgeRules.ts")).href
  )) as {
    buildHwpContent: (q: HwpQuestion) => string;
    stripWatermark: (s: string) => string;
  };

  const pairs = (
    JSON.parse(await readFile(path.join(TRACK_D, "final-pairs.json"), "utf8")) as {
      pairs: Pair[];
    }
  ).pairs;
  const pairById = new Map(pairs.map((p) => [String(p.examId), p]));

  let figureMap: Record<string, Record<string, number>> = {};
  try {
    figureMap = JSON.parse(
      await readFile(path.join(TRACK_D, "hwpx-figures.json"), "utf8"),
    ) as Record<string, Record<string, number>>;
  } catch {
    figureMap = {};
  }

  const unitById = new Map(units.map((u) => [u.id, u]));
  const predictions = await readPredictions();

  const result: BuildResult2 = {
    candidates: [],
    papers: new Map(),
    판정행: predictions.length,
    제외: {},
    제외목록: {},
    결함편: {},
    결함: {},
    학년어긋남: [],
  };
  const drop = (reason: string, externalId: string): void => {
    bump(result.제외, reason);
    (result.제외목록[reason] ??= []).push(externalId);
  };

  // 편별 문항 캐시 — 판정마다 파일을 다시 읽으면 4,566번 읽는다.
  const questionCache = new Map<string, Map<number, HwpQuestion> | null>();
  const loadQuestions = async (examId: string): Promise<Map<number, HwpQuestion> | null> => {
    const cached = questionCache.get(examId);
    if (cached !== undefined) return cached;
    let byNumber: Map<number, HwpQuestion> | null = null;
    try {
      const paper = JSON.parse(
        await readFile(path.join(TRACK_D, "hwp-latex", `${examId}.json`), "utf8"),
      ) as { questions?: HwpQuestion[] };
      byNumber = new Map((paper.questions ?? []).map((q) => [Number(q.number), q]));
    } catch {
      byNumber = null;
    }
    questionCache.set(examId, byNumber);
    return byNumber;
  };

  // 판정 파일 자체의 자기 중복. G 는 0 이라고 했지만 우리가 다시 센다.
  const seen = new Set<string>();

  for (const pred of predictions) {
    const externalId = pred.externalId;
    const examId = String(pred.examId);

    if (seen.has(externalId)) {
      drop("판정파일_자기중복", externalId);
      continue;
    }
    seen.add(externalId);

    // externalId 가 `{examId}-{번호}` 와 어긋나면 열쇠를 믿을 수 없다.
    if (externalId !== `${examId}-${pred.questionNumber}`) {
      drop("externalId_형식어긋남", externalId);
      continue;
    }
    if (loadedIds.has(externalId)) {
      drop("이미적재", externalId);
      continue;
    }

    const pair = pairById.get(examId);
    if (!pair) {
      drop("완료본목록에없는편", externalId);
      continue;
    }
    if ((pair.year ?? 0) < YEAR_FLOOR) {
      drop("연도제외_2022이전", externalId);
      continue;
    }
    const sourceFile = pair.hwp ?? pair.pdf;
    if (!sourceFile || !FINAL_MARK.test(sourceFile)) {
      drop("비완료본_D37", externalId);
      continue;
    }
    if (excludeExams.has(examId)) {
      drop("편단위중복", externalId);
      continue;
    }

    const byNumber = await loadQuestions(examId);
    if (!byNumber) {
      drop("추출물없음", externalId);
      continue;
    }
    const q = byNumber.get(pred.questionNumber);
    if (!q) {
      drop("문항번호없음", externalId);
      continue;
    }
    if ((q.stem ?? "").trim().length < MIN_REAL) {
      drop("실체아님_지문40자미만", externalId);
      continue;
    }
    // G 의 대상은 "힌트 없는 문항" 이다. 지금 힌트가 보이면 입력이 발밑에서 바뀐 것이다.
    if ((q.topic ?? "").trim().length > 0) {
      drop("힌트가생김_입력변경의심", externalId);
      continue;
    }

    const unit = unitById.get(pred.unitId);
    if (!unit) {
      drop("unitId가Unit에없음", externalId);
      continue;
    }

    // 조건 3 — 문항의 학년(시험지 메타)과 단원의 학년이 맞는가.
    const gradeHint = unitGrade(pair.level, pair.grade, pair.subject);
    if (gradeHint !== unit.grade) {
      result.학년어긋남.push({
        externalId,
        시험지학년: gradeHint,
        단원학년: unit.grade,
        단원: `${unit.grade} / ${unit.chapter} / ${unit.section}`,
        G판정학년: pred.근거?.학년 ?? null,
      });
      drop("학년어긋남", externalId);
      continue;
    }

    const content = sanitizeContent(buildHwpContent(q));
    const defect = contentDefect(content);
    if (defect) {
      bump(result.결함, defect);
      bump(result.결함편, examId);
      drop("본문결함", externalId);
      continue;
    }

    const type = (q.type ?? "").trim();
    const solution = sanitizeContent(stripWatermark((q.solution ?? "").trim()));

    result.papers.set(examId, pair);
    result.candidates.push({
      externalId,
      examId,
      questionNumber: pred.questionNumber,
      unitId: pred.unitId,
      confidence: pred.confidence,
      판정학년: pred.근거?.학년 ?? null,
      gradeHint,
      content,
      answer: cleanAnswer(q.answer) || MISSING_ANSWER,
      solution: solution || null,
      difficulty: mapDifficultyLabel(q.difficulty ?? undefined, q.score ?? undefined),
      problemType: mapProblemType(type || undefined),
      questionType: QUESTION_TYPES.has(type) ? type : null,
      score: typeof q.score === "number" ? q.score : null,
      school: pair.school,
      subject: pair.subject,
      sourceFile,
      year: pair.year,
      semester: pair.semester,
      round: pair.round,
      level: pair.level,
      figureCount: figureMap[examId]?.[String(pred.questionNumber)] ?? 0,
    });
  }

  return result;
}
