/**
 * **「정답과 보기가 안 맞는」 문항을 가르는 규칙 한 곳** (읽기 전용).
 *
 * 세는 쪽(`census-choice-answer.ts`)·보고하는 쪽(`report-unusable-problems.ts`)·
 * 수리 흉내(`simulate-choice-repairs.ts`)·테스트가 **이 파일 하나**를 본다.
 * 목록을 두 벌 쓰면 양쪽이 같이 눈이 먼다
 * (CLAUDE.md 2026-08-18 «목록을 손으로 쓰면 세는 쪽과 고치는 쪽이 같이 눈이 먼다»).
 *
 * ## 왜 「정답 번호 > 보기 칸 수」로는 부족한가
 *
 * 지면은 보기 번호를 본문에서 읽지 않는다. `ProblemContent.tsx` 가
 * `CHOICE_MARKS[index]` — 즉 **파서가 본 순서대로 ①②③④⑤ 를 다시 매긴다.**
 * 그래서 본문이 `① ③ ④ ⑤`(②가 유실)면 지면에는 `① ② ③ ④` 가 찍히고,
 * 기록된 정답 `⑤` 는 **④ 자리에 있는 원래 ⑤** 를 가리키게 된다.
 * 개수만 보면 「보기 4개 < 정답 5」로 잡히지만, 개수가 같아도(예: 라벨이
 * `[1,3,5,2,4]`) 자리는 어긋난다. **«수가 맞는다»는 «짝이 맞는다»가 아니다.**
 *
 * 그래서 이 규칙은 **자리**를 본다 —
 *   「기록된 정답 번호 a 가, 지면에서도 a 번으로 찍히는가」.
 * 반증 가능한 형태다: 성한 문항에 대면 반드시 «정상» 이 나와야 한다.
 *
 * ## 「참」이 어디서 오는가
 *
 * - 보기 목록: **제품 파서**(`parseProblemContent`)를 그대로 부른다.
 * - 보기의 **원래 번호**: 제품 파이프라인을 다시 밟아 얻되, 결과 본문이 제품의
 *   `choices` 와 **글자 그대로 같을 때만** 판정을 낸다. 다르면 `미분류` —
 *   옮겨 적기가 어긋나면 침묵하지 않는다(실제로 이 가드가 개발 중 내 버그를 잡았다).
 * - 정답 표기 정규화: `answer-notation.ts`(이 저장소의 정본)를 그대로 쓴다.
 * - **못 정하겠으면 안 정한다**: 값으로도 번호로도 읽히고 답이 갈리면 `모호` 를 낸다.
 */
import { tokenizeMath } from "../../src/lib/math/segments";
import { parseProblemContentLabeled } from "../../src/lib/problem/parseProblemContent";

import { canon, repairGlyphs } from "./answer-notation";
import {
  BODY_CHOICE_CLASS,
  circledValueRaw,
} from "../../src/lib/math/circledNumber";

/* ────────────────────────────────────────────────────────────────────────────
 * 1. 원문자 — **손으로 나열하지 않는다.** 유니코드의 «둘러싼 숫자» 계열은
 *    블록마다 «1 의 자리»가 정해져 있고 그 뒤로 1씩 늘어난다. 그래서 계열의
 *    시작 코드포인트만 적고 번호는 **계산**한다. 계열을 빠뜨렸는지는
 *    `census-choice-answer.ts` 가 「규칙이 못 읽는 첫 글자」로 드러낸다.
 * ──────────────────────────────────────────────────────────────────────────── */
/**
 * 이 문자가 «둘러싼 숫자»면 그 번호, 아니면 0. PUA 잔재는 정본 규칙이 먼저 편다.
 *
 * 계열표는 `src/lib/math/circledNumber.ts` **한 곳**에 있다 — 2026-08-19 이전에는
 * 이 파일과 `answer-notation.ts` 가 각자 들고 있었고, 그래서 한쪽만 고치면
 * 판정기와 대조기가 서로 다른 것을 원문자로 봤다.
 */
export function circledValue(ch: string): number {
  return circledValueRaw(repairGlyphs(ch));
}

// 규칙이 아는 원문자 전체 — 한 곳에서 그대로 내보낸다.
export { knownCircledGlyphs } from "../../src/lib/math/circledNumber";

/* ────────────────────────────────────────────────────────────────────────────
 * 2. 살아남은 보기의 «원래 번호» — 제품 파이프라인을 다시 밟는다.
 * ──────────────────────────────────────────────────────────────────────────── */

// 자리표시자는 제품과 달라도 된다(내부용이고 공백·마커 어느 정규식에도 안 걸린다).
// 같은지는 아래 «본문 대조»가 문항마다 확인한다.
const MASK_OPEN = String.fromCharCode(0xe000);
const MASK_CLOSE = String.fromCharCode(0xe001);
const UNMASK = new RegExp(MASK_OPEN + "(\\d+)" + MASK_CLOSE, "g");

/** 제품 `parseProblemContent` 의 `CHOICE_AT_LINE_START` 와 같은 규칙. */
const CHOICE_AT_LINE_START = new RegExp(
  // 본문 마커라 **일부러 좁다** — `circledNumber.ts` 머리 주석의 실측 참조.
  String.raw`\n[ \t]*(?:(?:[1-9][0-9]?)[.)][ \t]+|[${BODY_CHOICE_CLASS}][ \t]*)`,
  "g",
);

function maskMath(text: string): { masked: string; formulas: string[] } {
  const formulas: string[] = [];
  const masked = tokenizeMath(text)
    .map((seg) => {
      if (seg.type === "text") return seg.value;
      const literal =
        seg.type === "display" ? `$$${seg.value}$$` : `$${seg.value}$`;
      formulas.push(literal);
      return `${MASK_OPEN}${formulas.length - 1}${MASK_CLOSE}`;
    })
    .join("");
  return { masked, formulas };
}

function unmask(masked: string, formulas: string[]): string {
  return masked.replace(UNMASK, (_m, i: string) => formulas[Number(i)] ?? "");
}

function collapseWhitespace(masked: string): string {
  return masked
    .replace(/\n+/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([,)\]?!。，、])/g, "$1")
    .trim();
}

function dedupeRepeatedBlock<T extends { body: string }>(items: T[]): T[] {
  if (items.length < 4 || items.length % 2 !== 0) return items;
  const half = items.length / 2;
  const first = items.slice(0, half);
  return first.every((v, i) => v.body === items[half + i]!.body)
    ? first
    : items;
}

export interface ChoiceLabels {
  /** 지면에 실제로 그려지는 보기의 **원래 번호**, 그려지는 순서대로. */
  labels: number[];
  /** 지면에 그려지는 보기 본문 (제품 파서의 `choices` 와 같아야 한다). */
  bodies: string[];
  /** 마커는 잡혔으나 본문이 비어 **버려진** 보기의 원래 번호. */
  dropped: number[];
  /** 제품의 중복 블록 제거가 실제로 잘라 냈는가. */
  deduped: boolean;
}

/**
 * 제품 파서의 `choices` 와 **글자 그대로 같을 때만** 라벨을 낸다. 아니면 `null`.
 *
 * `null` 은 「보기가 없다」가 아니라 **「이 자로는 판정할 수 없다」**이다.
 * 부르는 쪽은 반드시 `미분류` 로 세야 한다 — 0으로 뭉개면 규칙이 새는 줄 모른다.
 */
export function choiceLabels(raw: string): ChoiceLabels | null {
  // ⚠️ **파이프라인을 다시 밟지 않는다.** 예전에는 여기서 마커를 다시 찾아 라벨을
  //    만들고 제품의 `choices` 와 글자 대조를 했다. R2 가 제품에 들어가자(2026-08-19)
  //    그 두 벌이 갈라져 **전량이 «판정 불가»가 될 뻔했다** — 대조 가드가 잡았다.
  //    이제 라벨은 제품이 직접 내준다(`parseProblemContentLabeled`). 규칙이 한 벌이라
  //    갈라질 자리가 없다.
  const p = parseProblemContentLabeled(raw ?? "");
  return {
    labels: p.labels,
    bodies: p.choices,
    dropped: p.dropped,
    deduped: p.deduped,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * 3. 기록된 정답이 «몇 번»을 가리키는가.
 *
 * 표기가 여러 가지다. 원문자만 읽으면 나머지를 «번호 없음»으로 뭉개고, 아무거나
 * 숫자로 읽으면 값(예: 「36」)을 번호로 오해한다. 그래서 **읽은 근거를 같이 낸다** —
 * 근거별로 표본을 볼 수 있어야 규칙이 과한지 알 수 있다.
 * ──────────────────────────────────────────────────────────────────────────── */
export type AnswerBasis =
  | "원문자" //  "③"        · 맨 앞 원문자 묶음
  | "번호.값" //  "5.\ -63"   · 「번호. 값」이고 값이 그 번호의 보기와 맞는다
  | "값(번호)" //  "-37 (④)"   · 값 뒤 괄호 번호, 값이 그 번호의 보기와 맞는다
  | "값일치" //  "22√5"      · 정확히 한 보기의 본문과 같다
  | "맨숫자" //  "3"         · 홀로 선 한 자리 숫자
  | "모호" //  "4" 인데 보기가 4,5,6,7,8 — 값으로도 번호로도 읽히고 답이 갈린다
  | "없음";

export interface AnswerRef {
  /** 정답이 가리키는 보기 번호들(«모두 고르시오» 는 여럿). 못 읽으면 빈 배열. */
  nums: number[];
  basis: AnswerBasis;
  /** 「번호. 값」·「값(번호)」·「값일치」에서 값이 실제로 그 보기와 맞았는가. */
  crossChecked: boolean;
}

const SEPARATOR = /[,·、/\s및과와또]/;

/** 맨 앞 원문자 묶음 — 뒤따르는 설명 속 원문자는 안 센다. */
function leadingCircled(answer: string): number[] {
  const s = answer.trim();
  const out: number[] = [];
  let i = 0;
  while (i < s.length) {
    const n = circledValue(s[i]!);
    if (n > 0) {
      out.push(n);
      i += 1;
      continue;
    }
    if (out.length > 0 && SEPARATOR.test(s[i]!)) {
      i += 1;
      continue;
    }
    break;
  }
  return out;
}

// 두 패턴은 **정규화된 정답**(`canon`)에 댄다 — 원문에는 `$…$` 와 `\ ` 가 섞여 있어
// 원문 그대로 대면 「$4.\ 22\sqrt5$」 같은 흔한 표기를 통째로 못 읽는다(실측).
// `[\s\S]` 로 쓴다 — `/s`(dotAll) 는 이 저장소의 tsconfig target 에서 못 쓴다.
const NUMBER_DOT_VALUE = /^([1-9])[.)]\\?([\s\S]+)$/;
const VALUE_PAREN_NUMBER = /^([\s\S]+?)[(（]([1-9])[)）]$/;

/**
 * 기록된 정답이 가리키는 보기 번호. `bodies` 를 주면 «값» 표기도 읽는다
 * (값이 그 번호의 보기와 맞는지 **스스로 검산**한 것만 받아들인다).
 *
 * `labels` 는 `bodies` 와 같은 순서의 **원래 번호**다. 없으면 1..n 으로 본다.
 * 검산은 «그 번호가 붙은 보기»와 대야 한다 — 자리로 대면 번호가 어긋난 문항에서
 * 엉뚱한 보기와 견주게 된다.
 */
export function readAnswerRef(
  answer: string,
  bodies: readonly string[] = [],
  labels: readonly number[] = bodies.map((_, i) => i + 1),
): AnswerRef {
  const raw = (answer ?? "").trim();
  if (raw.length === 0) return { nums: [], basis: "없음", crossChecked: false };

  const circled = leadingCircled(raw);
  if (circled.length > 0)
    return { nums: circled, basis: "원문자", crossChecked: false };

  const canonBodies = bodies.map((b) => canon(b));
  const at = (n: number) => {
    const i = labels.indexOf(n);
    return i >= 0 ? (canonBodies[i] ?? "") : "";
  };
  const answerCanon = canon(raw);

  // 「5.\ -63」 — 번호와 값이 **서로를 검산**한다. 값이 안 맞으면 안 읽는다.
  const dot = NUMBER_DOT_VALUE.exec(answerCanon);
  if (dot) {
    const n = Number(dot[1]);
    const value = dot[2]!;
    if (value.length > 0 && at(n) === value)
      return { nums: [n], basis: "번호.값", crossChecked: true };
  }

  // 「-37 (④)」 — 같은 방식으로 검산한다 (`canon` 이 ④ 를 4 로 편다).
  const paren = VALUE_PAREN_NUMBER.exec(answerCanon);
  if (paren) {
    const n = Number(paren[2]);
    const value = paren[1]!;
    if (value.length > 0 && at(n) === value)
      return { nums: [n], basis: "값(번호)", crossChecked: true };
  }

  // 값이 정확히 한 보기와 같다 → 그 보기의 **원래 번호**를 가리킨다.
  const valueHits = answerCanon.length
    ? canonBodies
        .map((b, i) =>
          b.length > 0 && b === answerCanon ? (labels[i] ?? 0) : 0,
        )
        .filter((n) => n > 0)
    : [];

  // 홀로 선 한 자리 숫자는 «보기 번호»로도 읽힌다.
  const bare = /^[1-9]$/.test(answerCanon) ? Number(answerCanon) : 0;
  const readableAsNumber =
    bare > 0 && bodies.length > 0 && bare <= bodies.length;

  // 두 읽기가 **서로 다른 보기**를 가리키면 답이 갈린다 — 고르지 말고 «모호»로 낸다.
  // 실측 10건. 예: 정화여고 2번 정답 "4", 보기 4,5,6,7,8 — 값 4 는 ① 이고 번호 4 는 ④ 다.
  // 두 읽기가 같은 번호를 내는 흔한 경우(보기가 1,2,3,4,5)는 모호하지 않다.
  if (readableAsNumber && valueHits.length === 1 && valueHits[0] !== bare)
    return { nums: [], basis: "모호", crossChecked: false };

  if (valueHits.length === 1)
    return { nums: valueHits, basis: "값일치", crossChecked: true };

  // 값과 겹치지 않을 때만 번호로 읽는다.
  // (`valueHits.length === 1` 은 위 두 갈래가 이미 가져갔으므로 여기 남는 것은 0 또는 2 이상이다.
  //  2 이상이면 같은 값이 여러 보기에 있다는 뜻이라 어느 쪽인지 못 정한다 → 안 읽는다.)
  if (readableAsNumber && valueHits.length === 0)
    return { nums: [bare], basis: "맨숫자", crossChecked: false };

  return { nums: [], basis: "없음", crossChecked: false };
}

/* ────────────────────────────────────────────────────────────────────────────
 * 4. 판정.
 * ──────────────────────────────────────────────────────────────────────────── */
export type Verdict =
  /** 이 자로는 판정할 수 없다 (제품 파서와 본문이 어긋났다). */
  | "미분류"
  /** 보기가 없고 정답도 번호가 아니다 — 서술형·단답형. */
  | "비객관식"
  /** 🔴 정답이 번호인데 지면에 보기가 한 칸도 안 찍힌다. */
  | "보기0칸"
  /** 🔴 정답 번호에 해당하는 보기가 없다. */
  | "정답보기없음"
  /** 🔴 정답 번호가 두 번 나온다 — 어느 쪽인지 못 정한다. */
  | "정답번호중복"
  /** 🔴 정답 보기가 지면에 **다른 번호로** 찍힌다 — 조용히 틀린다. */
  | "정답번호어긋남"
  /** 🔴 정답이 값으로도 번호로도 읽히고 **답이 갈린다**. */
  | "정답표기가모호"
  /** ⚠️ 정답 자리는 맞지만 **다른 보기**가 원본과 다른 번호로 찍힌다. */
  | "지면번호어긋남"
  /** ⚠️ 번호는 1..n 인데 n 이 5가 아니다 — 보기가 모자라거나 남는다. */
  | "보기수이상"
  /** ⚠️ 보기는 성한데 정답 표기가 «번호»가 아니다. */
  | "정답표기가번호아님"
  | "정상";

export type Cause =
  | "보기 그림 (figref 부류)"
  | "마커가 줄 중간에 붙었다"
  | "마커가 본문에 아예 없다"
  | "마커는 있으나 본문이 비었다"
  | "여러 문항이 한 행에 뭉쳤다"
  | "번호 순서가 뒤집혔다"
  | "정답 표기가 갈린다"
  | "-";

export interface JudgeInput {
  content: string;
  answer: string;
  figureUrls: readonly string[];
}

export interface Judgement {
  verdict: Verdict;
  cause: Cause;
  labels: number[];
  dropped: number[];
  ref: AnswerRef;
  /** 지면이 **원래 번호를 그대로 찍는다면** 정답을 고를 수 있는가. */
  fixedByLabelRendering: boolean;
}

/** 1..5 중 라벨에 없는 번호의 마커가 **줄머리가 아닌 자리**에 남아 있는가. */
function hasInlineMarker(content: string, missing: readonly number[]): boolean {
  return missing.some((n) => {
    const glyph = String.fromCodePoint(0x2460 + n - 1);
    return new RegExp(`[^\\n]\\s*(?:${glyph}|${n}[.)]\\s)`).test(content);
  });
}

function findCause(
  row: JudgeInput,
  labels: number[],
  dropped: number[],
): Cause {
  const runs = labels.join(",").split("1,2,3,4,5").length - 1;
  if (runs >= 2) return "여러 문항이 한 행에 뭉쳤다";
  const distinct = new Set(labels);
  const isPermutation =
    labels.length >= 2 &&
    distinct.size === labels.length &&
    [...labels].sort((a, b) => a - b).every((l, i) => l === i + 1);
  if (isPermutation && labels.some((l, i) => l !== i + 1))
    return "번호 순서가 뒤집혔다";
  if (dropped.length > 0) return "마커는 있으나 본문이 비었다";
  const missing = [1, 2, 3, 4, 5].filter((n) => !distinct.has(n));
  if (hasInlineMarker(row.content ?? "", missing))
    return "마커가 줄 중간에 붙었다";
  if (row.figureUrls.length >= 3) return "보기 그림 (figref 부류)";
  return "마커가 본문에 아예 없다";
}

export function judgeAnswerChoice(row: JudgeInput): Judgement {
  const labelled = choiceLabels(row.content ?? "");
  if (labelled === null) {
    return {
      verdict: "미분류",
      cause: "-",
      labels: [],
      dropped: [],
      ref: { nums: [], basis: "없음", crossChecked: false },
      fixedByLabelRendering: false,
    };
  }
  const { labels, bodies, dropped } = labelled;
  const ref = readAnswerRef(row.answer ?? "", bodies, labels);
  const base = { labels, dropped, ref };

  if (ref.basis === "모호") {
    return {
      ...base,
      verdict: "정답표기가모호",
      cause: "정답 표기가 갈린다",
      fixedByLabelRendering: false,
    };
  }
  if (ref.nums.length === 0) {
    return labels.length === 0
      ? {
          ...base,
          verdict: "비객관식",
          cause: "-",
          fixedByLabelRendering: true,
        }
      : {
          ...base,
          verdict: "정답표기가번호아님",
          cause: "-",
          fixedByLabelRendering: false,
        };
  }
  if (labels.length === 0) {
    return {
      ...base,
      verdict: "보기0칸",
      cause: findCause(row, labels, dropped),
      fixedByLabelRendering: false,
    };
  }

  const positions = ref.nums.map((a) =>
    labels.map((l, i) => (l === a ? i : -1)).filter((i) => i >= 0),
  );
  const cause = findCause(row, labels, dropped);
  // 지면이 원래 번호를 찍는다면: 정답 번호가 라벨에 **정확히 한 번** 있으면 고를 수 있다.
  const fixedByLabelRendering = positions.every((p) => p.length === 1);

  if (positions.some((p) => p.length === 0))
    return { ...base, verdict: "정답보기없음", cause, fixedByLabelRendering };
  if (positions.some((p) => p.length > 1))
    return { ...base, verdict: "정답번호중복", cause, fixedByLabelRendering };
  if (positions.some((p, k) => p[0]! + 1 !== ref.nums[k]))
    return { ...base, verdict: "정답번호어긋남", cause, fixedByLabelRendering };

  if (labels.some((l, i) => l !== i + 1))
    return { ...base, verdict: "지면번호어긋남", cause, fixedByLabelRendering };
  if (dropped.length > 0)
    return { ...base, verdict: "지면번호어긋남", cause, fixedByLabelRendering };
  if (labels.length !== 5)
    return { ...base, verdict: "보기수이상", cause, fixedByLabelRendering };

  return { ...base, verdict: "정상", cause: "-", fixedByLabelRendering: true };
}

/** 학생이 정답을 **고를 수 없는** 판정 (출제에서 빼야 하는 것). */
export const FATAL_VERDICTS: readonly Verdict[] = [
  "보기0칸",
  "정답보기없음",
  "정답번호중복",
  "정답번호어긋남",
  "정답표기가모호",
];

export const isFatal = (v: Verdict): boolean => FATAL_VERDICTS.includes(v);
