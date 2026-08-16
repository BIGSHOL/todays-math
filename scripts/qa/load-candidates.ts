/**
 * 트랙 F 공용 — **적재 후보 행을 만든다.** F-2(중복 대조)·F-3(드라이런)이 같이 쓴다.
 *
 * 후보 = 완료본 2,950편 중
 *   · 트랙 D 추출물이 있고 (6편 제외 — HWP 원본이 없는 PDF 전용 편)
 *   · `examId` 가 아직 DB 에 없고 (1,193편 제외)
 *   · 2023년 이후이고 (161편 제외 — 브리프 §6-4)
 *   · 지문이 실체이고(40자) · 소단원이 있고 · `mapUnitHint` 가 붙은 문항.
 *
 * **원본을 다시 뽑지 않는다.** 트랙 D 산출물을 그대로 읽는다(재추출 약 10.5시간).
 * **분류 로직을 손대지 않는다.** `mapUnitHint` 는 공용이고 원장님 확인 영역이다(브리프 §6-1).
 * **그림을 넣지 않는다.** `figureUrls` 는 트랙 A 소유라 비운 채로 둔다(브리프 §6-2).
 */
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { mapDifficultyLabel } from "../../src/lib/import/mapDifficulty";
import { mapProblemType } from "../../src/lib/import/mapProblemType";
import { mapUnitHint } from "../../src/lib/import/mapUnit";
import type { UnitLike } from "../../src/lib/import/types";
import { cleanAnswer, unitGrade, type HwpQuestion, type Pair } from "./load-survey";

export const TRACK_D =
  process.env.TRACK_D_REPORTS ??
  "C:/Users/user/orca/workspaces/testautocreator/잔여-D-HWP/scripts/qa/reports";

/** 실체 판정 최소 길이 — 원장 §1.1 정의(지문 원문). `load-survey.ts` 주석 참조. */
const MIN_REAL = 40;
const YEAR_FLOOR = 2023;

/** 자동 출제에서 제외되는 센티널 (원장 §6). 비었다고 AI 로 채우지 않는다(브리프 §6-3). */
export const MISSING_ANSWER = "(정답 없음)";

/** `Problem.questionType` 이 받는 세 값. 그 밖(`기타`)은 null 로 둔다. */
const QUESTION_TYPES = new Set(["객관식", "단답형", "서술형"]);

export interface Candidate {
  externalId: string;
  examId: string;
  questionNumber: number;
  unitId: string;
  unitHint: string;
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
  /**
   * 원본 HWPX 에 박힌 그림 장수. 트랙 A 에 넘길 목록을 만들려고 센다.
   *
   * ⚠️ 본문의 `[그림]` 자리표시로는 못 센다 — 그건 옛 PDF 파이프라인이 넣던 표기고,
   * 트랙 D 의 HWP 추출본에는 **한 건도 없다**(실측 0). 그림이 없는 게 아니라
   * 표시가 없는 것이다. 그래서 트랙 D `hwpx-figures.json`(편→문항번호→장수)을 쓴다.
   */
  figureCount: number;
}

export interface BuildResult {
  candidates: Candidate[];
  /** 후보 편 (2023+ · 미적재 · 추출물 있음). */
  papers: Pair[];
  skipped: {
    추출물없음: string[];
    이미적재: number;
    연도제외: number;
    비완료본: string[];
  };
  counted: {
    전체문항: number;
    실체: number;
    소단원있음: number;
    매핑성공: number;
    미분류: number;
    /** 본문 결함으로 뺀 행. 편 단위로 뭉개지 않고 행 단위로 뺀다. */
    결함제외: number;
    /** 결함 사유별 행 수. */
    결함: Record<string, number>;
  };
  /** 결함 행이 나온 편 → 행수. 코디네이터·트랙 D 에 넘길 목록이다. */
  결함편: Record<string, number>;
}

/** `(완료)` 표기 — D-37. 후보 원본이 정말 완료본인지 여기서도 확인한다. */
const FINAL_MARK = /[(（]\s*완\s*료\s*[)）]/;

/**
 * 본문에 박혀 나온 **base64 덩어리**. 공백 없는 40자 이상에 대·소문자·숫자가 다 섞인 토큰.
 * LaTeX 는 백슬래시·중괄호가 끼어 이 모양이 안 나온다.
 *
 * 2026-08-16 실측: 후보 6,174행 중 **239행(15편)** 이 이렇게 나왔다. 지문이
 * `닫힌구간 7HmWZvKIj4Fgqftip7R/ReOniozAZ/0Z…== $\le` 꼴이라 그대로 적재하면
 * 학생 시험지에 난수가 찍힌다. 100자 단위로 끊겨 있어 원본 문서에 박힌 인코딩
 * 덩어리로 보이며, **PDF·HWP 두 경로 모두에서 나온다**(같은 편의 기존 DB 행도
 * 원본 경로가 PDF 인데 오염돼 있다). 그래서 추출기를 의심하기 전에 원본을 봐야 한다.
 *
 * 지표는 초록인데 실물이 틀린 자리다 — F-1 표는 한 칸도 안 틀리고 맞았는데
 * 본문은 이랬다(tracks/README "되풀이 금지" 5번).
 */
const BASE64_BLOB = /[A-Za-z0-9+/]{40,}={0,2}/g;

export function hasBinaryBlob(text: string): boolean {
  for (const match of (text ?? "").matchAll(BASE64_BLOB)) {
    const token = match[0];
    if (/[a-z]/.test(token) && /[A-Z]/.test(token) && /[0-9]/.test(token)) {
      return true;
    }
  }
  return false;
}

/**
 * 지면 워터마크 — **줄 가운데에 박힌 것까지** 지운다.
 *
 * 트랙 D `stripWatermark` 는 줄 전체가 워터마크일 때만 지운다. 그런데 정규분포표처럼
 * 표가 있는 문항에서는 `$\mathrm{P}(0\le Z\le z)$대구광역시 내신 수학 연구회` 꼴로
 * 셀에 붙어 나와 줄 규칙을 빠져나간다 — 후보 5,935행 중 **186행**이 그랬다.
 * 문구가 한 종류뿐이라 지우는 게 맞다(트랙 D 가 실측으로 확인한 사실).
 */
const WATERMARK_INLINE = /대구광역시\s*내신\s*수학\s*연구회/g;

/**
 * 완료본 검수 이력(`오검:권 보선t`). 트랙 D 규칙은 이름을 `\S{0,20}` 으로 봐서
 * **이름에 공백이 있으면 놓친다.** 안 지우면 학생 시험지에 사람 이름이 찍힌다.
 */
const WORKER_SIGN_LINE =
  /^[ \t]*(?:워드|오검|완료|검수|교정|작업)[ \t]*[:：][ \t]*[^\n]{0,20}$/gm;

export function sanitizeContent(text: string): string {
  return (text ?? "")
    .replace(WATERMARK_INLINE, "")
    .replace(WORKER_SIGN_LINE, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * 깨끗이 지울 수 없어 **행째로 빼야 하는** 결함. 사유를 돌려준다(없으면 null).
 *
 * 지우기와 빼기를 가르는 기준은 하나다 — **경계를 확실히 자를 수 있는가.**
 * 워터마크·작업자 서명은 문구가 고정이라 지운다. 아래 것들은 못 자른다.
 */
const DEFECTS: Array<[string, RegExp]> = [
  // 지면 머리말 다섯 줄 덩어리(`2025년 1학기 기말고사 / … / 경덕여고 2학년 수학1 /
  // 학원로고 / 강민구`)가 지문에 통째로 섞였다. 트랙 D 도 경계를 못 잘라 지우는 대신
  // 막았다(H12). 사람 이름이 들어 있어 그냥 적재하면 학생 시험지에 찍힌다.
  ["지면머리말", /학원\s*로고/],
  // 수식 기호가 사용자영역 글리프로 남았다 — `P(B^c∩A^c)` 가 `P(B^cA^c)` 로 보인다.
  ["PUA잔재", new RegExp("[\uE000-\uF8FF\uFFFD]")],
  ["연산자뭉갬", /[∈∉⊂⊃∩∪]{2,}/],
  ["중괄호뭉갬", /[\^_]\{[∩∪]\}/],
  ["출처표기", /무단전재|저작권|복제를 금|출제자\s*[:：]|www\.|https?:/],
];

/** `buildHwpContent` 가 만든 `N. …` 보기 줄. */
function choiceLines(content: string): string[] {
  const out: string[] = [];
  for (const line of content.split("\n")) {
    const m = /^(\d+)\.\s?(.*)$/.exec(line);
    if (m) out.push(m[2].trim());
  }
  return out;
}

/**
 * 같은 보기가 두 번 나오는 객관식 — 추출 결함이다. 실제 시험지에 같은 선택지가
 * 둘 있을 수 없다. 실측 표본 `30 / 32 / 34 / 34 / 34`, `ㄱ / ㄱ / ㄱ,ㄷ / …`.
 * 원본 `hwp-latex` 에서 이미 이렇게 나오므로 조립 과정의 문제가 아니다.
 *
 * 후보에서는 9행(0.2%)뿐이다. 참고로 **기존 DB 는 같은 결함이 846행(3.5%)** 이라
 * 이 몫은 지금 들어가는 쪽이 훨씬 깨끗하다.
 */
function hasDuplicateChoices(content: string): boolean {
  const choices = choiceLines(content).filter((c) => c.length > 0);
  if (choices.length < 2) return false;
  return new Set(choices).size < choices.length;
}

export function contentDefect(text: string): string | null {
  if (hasBinaryBlob(text)) return "본문오염";
  for (const [name, re] of DEFECTS) if (re.test(text)) return name;
  if (hasDuplicateChoices(text)) return "보기중복";
  return null;
}

/**
 * 입력 corpus 지문 — **트랙 D 산출물이 바뀌었는지 본다.**
 *
 * 2026-08-16 실제 사고: 코디네이터가 5,816행을 승인한 뒤 트랙 D 가 추출기를 고쳐
 * `hwp-latex/` 3,302편을 통째로 다시 썼다(10:00:23). 같은 규칙으로 다시 세니 6,042행이
 * 나왔다 — base64 오염 239행이 원본에서 고쳐져 후보로 돌아온 것이다. **승인은 숫자에
 * 붙는데 입력이 남의 워크트리라 조용히 움직인다.** 그래서 지문을 산출물에 박아 두고,
 * 적재기가 다르면 멈춘다.
 *
 * 파일 내용 기반이다 — 같은 내용으로 다시 써도 지문은 안 바뀐다.
 */
export async function corpusFingerprint(): Promise<{
  fingerprint: string;
  files: number;
  bytes: number;
}> {
  const latexDir = path.join(TRACK_D, "hwp-latex");
  const names = (await readdir(latexDir)).filter((f) => f.endsWith(".json")).sort();
  const hash = createHash("sha1");
  let bytes = 0;
  for (const name of [...names, "../final-pairs.json", "../hwpx-figures.json"]) {
    let buf: Buffer;
    try {
      buf = await readFile(path.join(latexDir, name));
    } catch {
      continue;
    }
    bytes += buf.length;
    hash.update(name);
    hash.update(createHash("sha1").update(buf).digest());
  }
  return { fingerprint: hash.digest("hex").slice(0, 16), files: names.length, bytes };
}

export async function buildCandidates(
  units: UnitLike[],
  inDbExamIds: Set<string>,
): Promise<BuildResult> {
  const { buildHwpContent, stripWatermark } = (await import(
    pathToFileURL(path.join(TRACK_D, "../hwpJudgeRules.ts")).href
  )) as {
    buildHwpContent: (q: HwpQuestion) => string;
    stripWatermark: (s: string) => string;
  };

  const pairs = (
    JSON.parse(
      await readFile(path.join(TRACK_D, "final-pairs.json"), "utf8"),
    ) as { pairs: Pair[] }
  ).pairs;

  // 편 → 문항번호 → 그림 장수. 없으면 빈 지도로 두고 그림 인계 목록만 비어 나간다.
  let figureMap: Record<string, Record<string, number>> = {};
  try {
    figureMap = JSON.parse(
      await readFile(path.join(TRACK_D, "hwpx-figures.json"), "utf8"),
    ) as Record<string, Record<string, number>>;
  } catch {
    figureMap = {};
  }

  const latexDir = path.join(TRACK_D, "hwp-latex");
  const extracted = new Set(
    (await readdir(latexDir))
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, "")),
  );

  const result: BuildResult = {
    candidates: [],
    papers: [],
    skipped: { 추출물없음: [], 이미적재: 0, 연도제외: 0, 비완료본: [] },
    counted: {
      전체문항: 0,
      실체: 0,
      소단원있음: 0,
      매핑성공: 0,
      미분류: 0,
      결함제외: 0,
      결함: {},
    },
    결함편: {},
  };

  for (const pair of pairs) {
    const examId = String(pair.examId);
    if (!extracted.has(examId)) {
      result.skipped.추출물없음.push(examId);
      continue;
    }
    if (inDbExamIds.has(examId)) {
      result.skipped.이미적재 += 1;
      continue;
    }
    if ((pair.year ?? 0) < YEAR_FLOOR) {
      result.skipped.연도제외 += 1;
      continue;
    }

    // 본문의 원본은 HWP 다 — 이 편들은 PDF 가 아예 없거나 쓰지 않았다(원장 §5.1.2).
    const sourceFile = pair.hwp ?? pair.pdf;
    if (!sourceFile || !FINAL_MARK.test(sourceFile)) {
      result.skipped.비완료본.push(examId);
      continue;
    }

    result.papers.push(pair);
    const gradeHint = unitGrade(pair.level, pair.grade, pair.subject);
    const paper = JSON.parse(
      await readFile(path.join(latexDir, `${examId}.json`), "utf8"),
    ) as { questions?: HwpQuestion[] };

    for (const q of paper.questions ?? []) {
      result.counted.전체문항 += 1;
      if ((q.stem ?? "").trim().length < MIN_REAL) continue;
      result.counted.실체 += 1;

      const unitHint = (q.topic ?? "").trim();
      if (!unitHint) continue;
      result.counted.소단원있음 += 1;

      const mapped = mapUnitHint(unitHint, units, gradeHint ?? undefined);
      if (mapped.status !== "mapped") {
        result.counted.미분류 += 1;
        continue;
      }
      result.counted.매핑성공 += 1;

      // 지울 수 있는 것(워터마크·작업자 서명)은 지우고, 못 자르는 결함은 행째로 뺀다.
      const content = sanitizeContent(buildHwpContent(q));
      const defect = contentDefect(content);
      if (defect) {
        result.counted.결함[defect] = (result.counted.결함[defect] ?? 0) + 1;
        result.counted.결함제외 += 1;
        result.결함편[examId] = (result.결함편[examId] ?? 0) + 1;
        continue;
      }
      const type = (q.type ?? "").trim();
      const solution = sanitizeContent(stripWatermark((q.solution ?? "").trim()));

      result.candidates.push({
        externalId: `${examId}-${q.number}`,
        examId,
        questionNumber: q.number,
        unitId: mapped.unitId,
        unitHint,
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
        figureCount: figureMap[examId]?.[String(q.number)] ?? 0,
      });
    }
  }

  return result;
}
