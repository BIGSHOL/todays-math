/**
 * 값 형태 불일치를 **표기 차이 / 진짜 오답 / 판정 불가** 로 가른다 (트랙 B-1).
 *
 * 왜: `audit-answers-vs-official.ts` 가 낸 1,019건은 표본을 보면 다수가
 * `4` ↔ `k=4`, `x²` ↔ `x2` 같은 **표기 차이**다. 이걸 안 걷어내면 진짜 오답이 묻힌다.
 * 반대로 규칙이 헐거우면 **틀린 답이 표기 차이로 숨는다** — 이 정답은 학생
 * 시험지에 그대로 인쇄되므로 후자가 훨씬 위험하다.
 *
 * 그래서 규칙은 **좁은 것부터** 차례로 대고, 어느 규칙이 흡수했는지를 갈래에 남긴다.
 * 사람이 갈래 단위로 표본만 봐도 규칙이 과했는지 알 수 있어야 한다.
 *
 *   npx tsx scripts/qa/classify-answer-mismatch.ts
 *   npx tsx scripts/qa/classify-answer-mismatch.ts --samples 5
 *
 * 입력: scripts/qa/reports/answer-audit.json (`audit-answers-vs-official.ts` 산출)
 * 출력: scripts/qa/reports/answer-mismatch-classified.json
 *
 * **DB 를 건드리지 않는다.** 교정은 `apply-official-answers.ts` 가 따로 한다.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { isDirectScript } from "../import/isDirectScript";

import {
  answerPieces,
  canon,
  canonLoose,
  circledSet,
  firstLatexAtom,
  hasBrokenGlyph,
  hasJunkGlyph,
  isSeeSolution,
  labelAwareEqual,
  normalizeInequalityChain,
  numericKey,
  parts,
  pieceSetEqual,
  stripLabel,
  stripOuterParens,
  stripUnits,
} from "./answer-notation";

const IN = "scripts/qa/reports/answer-audit.json";
const OUT = "scripts/qa/reports/answer-mismatch-classified.json";

interface Row {
  id: string;
  externalId: string;
  ours: string;
  official: string;
}

/** 완료 기준의 세 낱말과 1:1 로 맞춘다. */
type Verdict = "표기차이" | "진짜오답" | "판정불가";

const CIRCLED = /[①②③④⑤⑥⑦⑧⑨⑩]/;

/**
 * 공식 정답면 텍스트를 **정본으로 쓸 수 없는지**.
 *
 * 정답 목록 지면에서 답이 아닌 것이 잡히는 길이 다섯 있다 — 글꼴 인코딩,
 * 분수 가로선 잔재, 해설 문장의 꼬리, 부호만 남은 것, 안내 문구.
 */
function officialBroken(text: string): boolean {
  if (hasJunkGlyph(text)) return true;
  // 근호에 딸리지 않은 분수 가로선이 남았으면 수식이 뭉개진 것이다 (`5=⁄4`, `-{⁄2`).
  if (/⁄/.test(text.replace(/√\s*⁄/g, ""))) return true;
  const t = canon(text);
  // 연산자로 시작하는 것은 해설 문장의 꼬리다 (`×30=216000`).
  if (/^[*+/=}{)]/.test(t)) return true;
  // 뜻을 읽을 글자가 하나도 안 남는 것 — `}` `„` `…`
  const core = t.replace(/[^0-9A-Za-z가-힣①②③④⑤⑥⑦⑧⑨⑩√π°]/g, "");
  if (core === "") return true;
  // 값이 아니라 안내 문구만 잡힌 것 — `(서술형)` `이다.` `아래 참조`
  return /^[가-힣]{1,6}$/.test(core);
}

/** 공식 정답을 **그대로 지면에 인쇄해도 되는지**. 교정 대상 판단에 쓴다. */
function officialPrintable(text: string): boolean {
  if (officialBroken(text)) return false;
  // 너무 길면 해설 문장이 딸려 온 것이다.
  return canon(text).length <= 40;
}

/**
 * 곱해진 인수의 순서를 정렬해 흡수. `(x+1)(5x-9)` ↔ `(5x-9)(x+1)`.
 *
 * 인수분해 답은 곱셈 순서가 자유롭다. 괄호 묶음만 세고, 괄호 밖에 다른 글자가
 * 있으면(계수·부호) 건드리지 않는다 — 그때는 순서가 뜻을 가질 수 있다.
 */
function sortedFactors(text: string): string | null {
  const t = stripLabel(text);
  if (!/^(\([^()]+\)){2,}$/.test(t)) return null;
  return (t.match(/\([^()]+\)/g) as string[]).sort().join("");
}

/** 다항식·합 표현의 항을 정렬해 순서 차이를 흡수. `40√2-21` ↔ `-21+40√2` */
function sortedTerms(text: string): string | null {
  const t = stripLabel(text);
  if (!/^[-+]?[^=<>≤≥]+$/.test(t)) return null;
  const terms = t.match(/[-+]?[^-+]+/g);
  if (!terms || terms.length < 2) return null;
  return terms
    .map((s) => (s.startsWith("+") ? s.slice(1) : s))
    .map((s) => (s.startsWith("-") ? s : `+${s}`))
    .sort()
    .join("");
}

/**
 * `공식` 이 `우리` 안에 **값을 바꾸지 않는 자리로** 들어 있는지.
 *
 * 두 가지를 막는다:
 * - 숫자가 잘리는 것 — `12` 가 `120` 안에 걸리면 안 된다.
 * - **연산자에 물리는 것** — `12√3/25` 안의 `12√3` 은 값이 다르다(실측 오탐).
 *   앞뒤가 `+ - * / ^` 면 그 조각은 식의 일부일 뿐 답이 아니다.
 */
function containsAtBoundary(ours: string, official: string): boolean {
  if (official.length === 0 || ours.length <= official.length) return false;
  if (!/[0-9A-Za-z①②③④⑤⑥⑦⑧⑨⑩]/.test(official)) return false;
  const glued = /[0-9A-Za-z.+\-*/^]/;
  let from = 0;
  for (;;) {
    const at = ours.indexOf(official, from);
    if (at < 0) return false;
    const before = ours[at - 1] ?? "";
    const after = ours[at + official.length] ?? "";
    if (!glued.test(before) && !glued.test(after)) return true;
    from = at + 1;
  }
}

/**
 * 값 비교 규칙. **좁은 것부터** 차례로 대고, 처음 걸린 것이 갈래가 된다.
 *
 * 순서가 곧 근거의 강도다 — 위쪽일수록 흡수한 차이가 작아 사람이 확인할 것이 적다.
 */
interface Rule {
  key: string;
  why: string;
  test: (ours: string, official: string) => boolean;
}

/** 값 하나짜리 규칙. 아래 조합 규칙이 조각마다 이걸 다시 쓴다(재귀 없음). */
const ATOMIC: Rule[] = [
  {
    key: "표기정규화",
    why: "첨자·LaTeX·분수가로선·도/퍼센트 글리프·출처주석만 다르고 값이 같다.",
    test: (a, b) => canon(a) !== "" && canon(a) === canon(b),
  },
  {
    key: "수치동일",
    why: "둘 다 수치이고 값이 같다 (`85/2` ↔ `42.5`, `-0` ↔ `0`).",
    test: (a, b) => {
      const x = numericKey(a);
      return x !== null && x === numericKey(b);
    },
  },
  {
    key: "단위",
    why: "한쪽에만 단위(`cm²` `개` `명` `°`)가 붙어 있고 값은 같다.",
    test: (a, b) => stripUnits(a) !== "" && stripUnits(a) === stripUnits(b),
  },
  {
    key: "수치동일·단위",
    why: "단위를 떼면 수치가 같다 (`16/5 cm` ↔ `3.2cm`).",
    test: (a, b) => {
      const x = numericKey(stripUnits(a));
      return x !== null && x === numericKey(stripUnits(b));
    },
  },
  {
    key: "이름표",
    why: "한쪽에만 `k=` `f(x)=` `a+b=` 처럼 답의 이름표가 붙어 있다. 양쪽에 있으면 이름표까지 같을 때만.",
    test: (a, b) => labelAwareEqual(a, b),
  },
  {
    key: "이름표·단위",
    why: "이름표와 단위를 함께 떼면 같다.",
    test: (a, b) => labelAwareEqual(stripUnits(a), stripUnits(b)),
  },
  {
    key: "답풀이붙음",
    why: "우리 정답 뒤에 풀이가 붙어 잘려 있다 (`$12$$f(x)=3x+`). 앞의 답만 보면 같다.",
    test: (a, b) => {
      const atom = firstLatexAtom(a);
      return atom !== null && labelAwareEqual(stripUnits(atom), stripUnits(b));
    },
  },
  {
    key: "항순서",
    why: "덧셈 항의 순서만 다르다 (`40√2-21` ↔ `-21+40√2`).",
    test: (a, b) => {
      const x = sortedTerms(a);
      return x !== null && x === sortedTerms(b);
    },
  },
  {
    key: "인수순서",
    why: "곱해진 인수의 순서만 다르다 (`(x+1)(5x-9)` ↔ `(5x-9)(x+1)`).",
    test: (a, b) => {
      const x = sortedFactors(a);
      return x !== null && x === sortedFactors(b);
    },
  },
  {
    key: "답순서",
    why: "쉼표·`또는` 으로 갈린 답의 순서만 다르다. 양쪽에 변수명이 있으면 변수까지 맞춰 본다.",
    test: pieceSetEqual,
  },
  {
    key: "한글부연",
    why: "단위·조사·괄호 부연(한글)만 다르다. 한글을 떼면 같다.",
    test: (a, b) => canonLoose(a) !== "" && canonLoose(a) === canonLoose(b),
  },
  {
    key: "한글부연·이름표",
    why: "한글 부연을 떼고 이름표까지 떼면 같다 (`3 (매년 3%)` ↔ `a=3`).",
    test: (a, b) => labelAwareEqual(canonLoose(a), canonLoose(b)),
  },
  {
    key: "등호표기",
    why: "등호 유무만 다르다 (`나머지 두 근 -1, -3` ↔ `나머지 두근=-1, -3`).",
    test: (a, b) => {
      const drop = (v: string) => canon(v).replace(/=/g, "");
      return drop(a) !== "" && drop(a) === drop(b);
    },
  },
  {
    key: "겉괄호",
    why: "식을 감싼 겉괄호나 괄호로 묶은 단위만 다르다 (`(3√3-3) cm` ↔ `3√3-3(cm)`).",
    test: (a, b) => {
      const peel = (v: string) => stripOuterParens(stripUnits(v));
      return peel(a) !== "" && peel(a) === peel(b);
    },
  },
  {
    key: "부등호방향",
    why: "크기 비교를 읽는 방향만 다르다 (`2⁵⁰<7²⁰<3⁴⁰<5³⁰` ↔ `5³⁰>3⁴⁰>7²⁰>2⁵⁰`).",
    test: (a, b) => {
      const x = normalizeInequalityChain(a);
      return x !== null && x === normalizeInequalityChain(b);
    },
  },
];

/**
 * 규칙 하나가 터져도 나머지는 계속 본다. 다만 **조용히 삼키지는 않는다** —
 * 오타 하나로 규칙이 통째로 죽어도 결과가 그럴듯해 보여 못 알아챈다(실제로 겪었다).
 */
const ruleFailures = new Map<string, number>();
function runRule(rule: Rule, ours: string, official: string): boolean {
  try {
    return rule.test(ours, official);
  } catch (error) {
    const key = `${rule.key}: ${(error as Error).message}`;
    ruleFailures.set(key, (ruleFailures.get(key) ?? 0) + 1);
    return false;
  }
}

/** 조각 하나끼리 표기 차이인지. 조합 규칙이 쓰는 얕은 비교(재귀 없음). */
function atomicMatch(ours: string, official: string): boolean {
  return ATOMIC.some((rule) => runRule(rule, ours, official));
}

/** 조각이 **부연**인지 — 한글이 섞였거나 이름표가 붙은 것. 맨 숫자면 부연이 아니다. */
function isAnnotation(piece: { label: string; body: string }): boolean {
  return piece.label !== "" || /[가-힣]/.test(piece.body);
}

const COMPOSITE: Rule[] = [
  {
    key: "우리가더씀",
    why: "우리 답이 공식 답을 낱말 경계 그대로 품고 근거·과정을 더 적었다. 값은 같다.",
    test: (a, b) =>
      containsAtBoundary(canon(a), canon(b)) ||
      containsAtBoundary(canonLoose(a), canonLoose(b)),
  },
  {
    key: "소문항번호없음",
    why: "공식은 소문항 번호를 붙였고 우리는 안 붙였다. 값을 짝지으면 같다 (`x=4, a=2` ↔ `⑴ x=4 ⑵ a=2`).",
    test: (a, b) => {
      const bodies = [...parts(b).values()].filter((v) => canon(v) !== "");
      if (bodies.length < 2) return false;
      const ourPieces = answerPieces(a);
      if (parts(a).size > 0 || ourPieces.length !== bodies.length) return false;
      const used = new Set<number>();
      return bodies.every((body) =>
        ourPieces.some((piece, i) => {
          if (used.has(i)) return false;
          const hit = atomicMatch(`${piece.label ? `${piece.label}=` : ""}${piece.body}`, body);
          if (hit) used.add(i);
          return hit;
        }),
      );
    },
  },
  {
    key: "조각포함",
    why: "공식이 적은 값을 우리도 다 갖고 있고, 우리만 있는 조각은 전부 부연(한글·이름표)이다.",
    test: (a, b) => {
      const ourPieces = answerPieces(a);
      const offPieces = answerPieces(b);
      // 조각이 하나뿐이면 위의 값 규칙이 이미 다 봤다. 둘 이상일 때만 짝짓는다.
      if (offPieces.length === 0 || ourPieces.length < offPieces.length) {
        return false;
      }
      if (ourPieces.length < 2) return false;
      const used = new Set<number>();
      const covered = offPieces.every((off) =>
        ourPieces.some((piece, i) => {
          if (used.has(i)) return false;
          const hit = atomicMatch(
            `${piece.label ? `${piece.label}=` : ""}${piece.body}`,
            `${off.label ? `${off.label}=` : ""}${off.body}`,
          );
          if (hit) used.add(i);
          return hit;
        }),
      );
      if (!covered) return false;
      // 우리에게만 있는 조각이 맨 값이면 답이 다른 것이다 (`b=2,3,4,6` ↔ `4,6`).
      return ourPieces.every((piece, i) => used.has(i) || isAnnotation(piece));
    },
  },
];

const RULES: Rule[] = [...ATOMIC, ...COMPOSITE];

/**
 * 답 한 짝을 규칙 사다리에 대 본다. 걸리면 규칙 이름, 아니면 null.
 *
 * 소문항 비교에서도 **같은 사다리**를 쓴다 — `⑵ (2x+1)(x+2)이므로 둘레는 6x+6` ↔ `⑵ 6x+6`
 * 처럼 소문항 안에서만 부연이 붙은 것을 전체 문자열로는 못 가른다.
 */
function matchOne(ours: string, official: string): string | null {
  for (const rule of RULES) {
    if (runRule(rule, ours, official)) return rule.key;
  }
  return null;
}

/**
 * **답이 실린** 소문항만. 두 가지를 뺀다:
 * - 공식면이 `(3)` 만 찍고 값을 안 남긴 것
 * - `⑵ 풀이 참조` — 그 소문항의 답은 지면에 인쇄돼 있지 않다. 그대로 옮기면
 *   학생 시험지에 "풀이 참조" 가 정답으로 찍힌다.
 */
function filledParts(text: string): Map<string, string> {
  const map = parts(text);
  for (const [key, value] of [...map]) {
    if (canon(value) === "" || isSeeSolution(value)) map.delete(key);
  }
  return map;
}

/**
 * 답 한 짝의 갈래와 판정. 테스트가 이 함수를 직접 부른다 —
 * **픽스처는 실제 데이터에서 가져오고, 지면으로 확인한 것만 쓴다**
 * (합성 픽스처가 이관 결함을 통과시킨 적이 있다).
 */
export function classifyPair(
  ours: string,
  official: string,
): { rule: string; verdict: Verdict } {
  return classify({ id: "", externalId: "", ours, official });
}

function classify(row: Row): { rule: string; verdict: Verdict } {
  // 우리 정답이 PUA 로 깨졌다. 공식면도 같은 글리프라 대조로는 못 가르지만,
  // 원본 지면을 렌더해 96건 전수(시험지 7편)를 눈으로 확인했다 — 값은 맞고 표기만 깨졌다.
  if (hasBrokenGlyph(row.ours)) {
    return { rule: "우리글리프깨짐", verdict: "표기차이" };
  }
  if (row.ours.trim() === "") return { rule: "우리비었음", verdict: "판정불가" };

  const whole = matchOne(row.ours, row.official);
  if (whole) return { rule: whole, verdict: "표기차이" };

  // 소문항이 있으면 번호별로 같은 사다리를 다시 댄다.
  const ourParts = filledParts(row.ours);
  const offParts = filledParts(row.official);
  if (offParts.size >= 1) {
    if (ourParts.size === 0) {
      // 우리 답에는 번호가 없다. 공식 소문항 중 하나만 맞으면 나머지를 빠뜨린 것이다.
      const hit = [...offParts.values()].some(
        (value) => matchOne(row.ours, value) !== null,
      );
      if (hit && offParts.size >= 2) {
        return { rule: "우리일부만", verdict: "진짜오답" };
      }
    } else {
      const shared = [...offParts.keys()].filter((k) => ourParts.has(k));
      const allAgree =
        shared.length > 0 &&
        shared.every(
          (k) =>
            matchOne(ourParts.get(k) as string, offParts.get(k) as string) !==
            null,
        );
      if (allAgree) {
        // 겹치는 소문항은 다 맞다. 남은 문제는 개수 차이뿐이다.
        if (offParts.size > ourParts.size) {
          return { rule: "우리일부만", verdict: "진짜오답" };
        }
        if (ourParts.size > offParts.size) {
          return { rule: "공식일부만", verdict: "판정불가" };
        }
        return { rule: "소문항", verdict: "표기차이" };
      }
      if (shared.length > 0) {
        return { rule: "소문항불일치", verdict: "진짜오답" };
      }
    }
  }

  // 공식이 원문자를 우리보다 많이 적었다 — 복수정답으로 처리된 문항이다.
  const oursCircled = circledSet(row.ours);
  const offCircled = circledSet(row.official);
  if (
    oursCircled.length > 0 &&
    offCircled.length > oursCircled.length &&
    oursCircled.every((c) => offCircled.includes(c))
  ) {
    return { rule: "공식복수정답", verdict: "진짜오답" };
  }

  if (officialBroken(row.official)) {
    return { rule: "공식훼손", verdict: "판정불가" };
  }

  // 우리는 번호, 공식은 값 — 정답면에서 해설 조각이 잡혔을 수 있어 자동 판정하지 않는다.
  if (CIRCLED.test(row.ours) && !CIRCLED.test(row.official)) {
    return { rule: "번호↔값", verdict: "판정불가" };
  }

  return { rule: "값이다름", verdict: "진짜오답" };
}

const WHY: Record<string, string> = {
  우리글리프깨짐:
    "우리 정답이 PUA(U+F08x)로 깨져 지면에 네모 상자로 인쇄된다. 값은 맞다(전수 확인). 표기 복구 대상.",
  우리비었음: "우리 정답이 빈 문자열이다. 대조할 것이 없다.",
  소문항: "소문항 번호별로 맞춰 보면 값이 같다 (`⑴ x²=64` ↔ `⑴ 64`).",
  소문항불일치:
    "소문항 번호를 맞춰 봤는데 값이 어긋난다. 어느 소문항이 틀렸는지 보고 교정한다.",
  우리일부만:
    "공식면에는 소문항이 더 있는데 우리 답이 그중 일부만 갖고 있다. 답이 불완전하다.",
  공식일부만:
    "소문항이 여럿인데 공식면에서 앞부분만 추출됐다. 겹치는 소문항은 일치한다.",
  공식복수정답:
    "공식 정답면이 원문자를 우리보다 많이 적었다(복수정답). 공식을 따라야 한다.",
  공식훼손: "공식 정답면이 글꼴 인코딩으로 깨졌거나 해설 조각이 잡혔다. 정본으로 못 쓴다.",
  "번호↔값": "우리는 번호, 공식은 값이다. 정답면 오추출인지 우리 오답인지 지면을 봐야 한다.",
  값이다름: "규칙으로 못 걷어냈다. 값 자체가 다르다.",
};

const VERDICT_OF: Record<string, Verdict> = {
  우리비었음: "판정불가",
  공식일부만: "판정불가",
  공식훼손: "판정불가",
  "번호↔값": "판정불가",
  소문항불일치: "진짜오답",
  우리일부만: "진짜오답",
  공식복수정답: "진짜오답",
  값이다름: "진짜오답",
};

async function main(): Promise<void> {
  const at = process.argv.indexOf("--samples");
  const samples = at > 0 ? Number(process.argv[at + 1]) : 3;
  const audit = JSON.parse(await readFile(IN, "utf-8")) as {
    conflictValue: Row[];
  };
  const rows = audit.conflictValue;

  const byRule = new Map<string, Row[]>();
  const byVerdict = new Map<Verdict, number>();
  for (const row of rows) {
    const { rule, verdict } = classify(row);
    if (!byRule.has(rule)) byRule.set(rule, []);
    (byRule.get(rule) as Row[]).push(row);
    byVerdict.set(verdict, (byVerdict.get(verdict) ?? 0) + 1);
  }

  const meta = new Map(RULES.map((r) => [r.key, r]));
  const groups = [...byRule]
    .map(([rule, items]) => ({
      rule,
      verdict: VERDICT_OF[rule] ?? ("표기차이" as Verdict),
      why: meta.get(rule)?.why ?? WHY[rule] ?? "",
      count: items.length,
      items: items.map((it) => ({
        ...it,
        officialPrintable: officialPrintable(it.official),
      })),
    }))
    .sort((a, b) => b.count - a.count);

  await mkdir("scripts/qa/reports", { recursive: true });
  await writeFile(
    OUT,
    JSON.stringify(
      {
        generatedFrom: IN,
        total: rows.length,
        verdicts: Object.fromEntries(byVerdict),
        rules: groups,
      },
      null,
      1,
    ),
    "utf-8",
  );

  console.log("── 값 형태 불일치 분류 ──");
  console.log(`대상 ${rows.length}건\n`);
  for (const group of groups) {
    const pct = ((group.count * 100) / rows.length).toFixed(1);
    console.log(
      `[${group.verdict}] ${group.rule.padEnd(9)} ${String(group.count).padStart(4)} (${pct.padStart(4)}%)  ${group.why}`,
    );
    for (const item of group.items.slice(0, samples)) {
      console.log(
        `      ${item.externalId.padEnd(9)} 우리 ${JSON.stringify(item.ours).slice(0, 44).padEnd(46)} 공식 ${JSON.stringify(item.official).slice(0, 44)}`,
      );
    }
  }
  console.log("\n── 판정 ──");
  for (const [verdict, n] of [...byVerdict].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${verdict} ${n} (${((n * 100) / rows.length).toFixed(1)}%)`);
  }
  const real = groups.filter((g) => g.verdict === "진짜오답");
  const realTotal = real.reduce((n, g) => n + g.count, 0);
  const printable = real
    .flatMap((g) => g.items)
    .filter((i) => i.officialPrintable).length;
  console.log(
    `\n진짜오답 ${realTotal} 중 공식 정답을 그대로 인쇄해도 되는 것 ${printable}`,
  );
  console.log(`→ ${OUT}`);
}

if (isDirectScript(import.meta.url)) {
  void main();
}
