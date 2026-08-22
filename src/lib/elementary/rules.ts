/**
 * 초등 문항 **가드** 한 곳. 테스트가 230문항 전량에 이것을 댄다.
 *
 * 원장님 육안 검수(2026-08-22)에서 나온 결함을 낱개로 고치지 않고 규칙으로 접은 자리다
 * (`docs/planning/tracks/elem-engine-review-20260822.md`). 가드가 「끝났다」를 정의한다.
 *
 * ⚠️ **여기 규칙의 «참»은 제품 상수에서 오면 안 된다.** 학년별 허용 연산은 손 목록이 아니라
 * `units.ts`(교육과정 SSOT)의 **단원 순서**에서 끌어온다 — 단원 이름이 바뀌면 조용히
 * 통과하는 대신 **던진다**.
 */
import { CURRICULUM_UNITS } from "../../../prisma/seed-data/units";

/** `$...$` 를 걷어낸 나머지. 여기 숫자가 남으면 KaTeX 밖에 있는 것이다. */
function stripMath(text: string): string {
  return text.replace(/\$[^$]*\$/g, " ");
}

/**
 * KaTeX 밖에 남은 숫자. 원장님: 「모든 숫자는 일반텍스트 말고 KaTeX 이용해서 표현하도록」.
 *
 * 소단원 번호(`2-5-5`)는 화면이 따로 찍는 것이라 본문에 없다 — 본문에 있으면 그것도 결함이다.
 */
export function bareNumbers(text: string): string[] {
  const rest = stripMath(text);
  return rest.match(/\d+(?:\.\d+)?/g) ?? [];
}

/**
 * 답에 샌 부동소수점. 원장님: 「분수 문제에서 소수로 답을 표현하게 하지 말고 대분수로」.
 *
 * 자릿수가 셋을 넘는 소수는 초등 답이 아니다 — `6.333333333333333` 이 그렇게 나갔다.
 */
export function runawayDecimals(text: string): string[] {
  return text.match(/\d+\.\d{4,}/g) ?? [];
}

/** 아라비아 숫자로 쓴 도형 이름. 원장님: 「8각형이 아니라 팔각형」. */
export function arabicPolygons(text: string): string[] {
  return text.match(/\d+\s*각형/g) ?? [];
}

/** 틀에서 안 채운 자리가 그대로 나간 것 — `정n각형`, `n각형`. */
export function unfilledPlaceholders(text: string): string[] {
  return text.match(/[a-zA-Z]각형/g) ?? [];
}

/** 학년 안에서 «아직 안 배운 연산»을 가려낼 이름들. 값은 그 연산을 **도입하는 단원 이름**이다. */
const CONCEPT_CHAPTER: Record<string, string> = {
  분수의곱셈: "2-2 분수의 곱셈",
  분수의나눗셈: "1-1 분수의 나눗셈",
  소수의곱셈: "2-4 소수의 곱셈",
  소수의나눗셈: "1-3 소수의 나눗셈",
};

/** 단원 이름 → 전역 orderIndex. 이름이 units.ts 에 없으면 **던진다**(조용히 통과 금지). */
function chapterOrder(chapterName: string): number {
  let best = Number.POSITIVE_INFINITY;
  for (const unit of CURRICULUM_UNITS) {
    if (unit.chapter === chapterName) best = Math.min(best, unit.orderIndex);
  }
  if (!Number.isFinite(best)) {
    throw new Error(
      `units.ts 에 없는 단원 이름입니다: ${chapterName} — CONCEPT_CHAPTER 를 고치십시오`,
    );
  }
  return best;
}

/** 개념 → 그 개념을 배우는 시점(전역 orderIndex). units.ts 에서 끌어온다. */
export function conceptIntro(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [concept, chapter] of Object.entries(CONCEPT_CHAPTER)) {
    out[concept] = chapterOrder(chapter);
  }
  return out;
}

const DEC = String.raw`\d+\.\d+`;
const FRAC = String.raw`\\frac\{[^}]*\}\{[^}]*\}`;
const TIMES = String.raw`(?:\\times|×)`;
const DIV = String.raw`(?:\\div|÷)`;

/**
 * 해설이 실제로 **쓰는** 연산. 발문이 아니라 해설을 본다 —
 * 원장님이 잡으신 것은 초4 소수 단원 해설에 `0.1×10=1` 이 나온 자리다.
 */
export function conceptsUsed(text: string): string[] {
  const found = new Set<string>();
  const has = (re: string) => new RegExp(re).test(text);

  if (has(`${DEC}\\s*${TIMES}`) || has(`${TIMES}\\s*${DEC}`))
    found.add("소수의곱셈");
  if (has(`${DEC}\\s*${DIV}`) || has(`${DIV}\\s*${DEC}`))
    found.add("소수의나눗셈");
  if (has(`${FRAC}\\s*${TIMES}`) || has(`${TIMES}\\s*${FRAC}`))
    found.add("분수의곱셈");
  if (has(`${FRAC}\\s*${DIV}`) || has(`${DIV}\\s*${FRAC}`))
    found.add("분수의나눗셈");

  return [...found];
}

/**
 * 이 문항의 해설이 «아직 안 배운 연산»을 썼는가.
 *
 * 같은 단원 안에서 그 개념을 배우는 것은 당연히 허용한다(`>=`).
 */
export function tooAdvanced(orderIndex: number, solution: string): string[] {
  const intro = conceptIntro();
  return conceptsUsed(solution).filter((c) => orderIndex < (intro[c] ?? 0));
}
