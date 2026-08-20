/**
 * HWP 수식에서 **글자가 잘못 읽힌 것**을 되돌린다 — `≠`·`≅`·`↔`.
 *
 * ## 무엇이 문제인가
 *
 * 원장님이 종이에서 찾아 주셨다(2026-08-20):
 *
 *   `기숙사생의 70≠ 가 남학생이고`   ← `70%` 다
 *   `sin ↔ = -√5/3`                 ← `sin θ` 다
 *   `∠C = 90≅ 인 직각삼각형`         ← `90°` 다
 *
 * **못 푸는 게 아니라 다르게 푼다.** `70≠` 는 부등호로 읽힌다 — 에러도 안 나고
 * 지면도 멀쩡해 보인다. 이 저장소가 여러 번 적은 「침묵하는 결함」이다.
 *
 * ## 어떻게 찾았나 — 목록을 손으로 쓰지 않았다
 *
 * 수식 안 기호를 **131종 전수로 세어** 빈도순으로 놓았다. `↔` 1,531회 ·
 * `≅` 906회가 비정상적으로 많았다. 무엇이 잘못된 글자인지 미리 정하면
 * 목록에 없는 부류는 구조적으로 0이 된다(CLAUDE.md 2026-08-18).
 *
 * ## 가르는 열쇠는 **문법**이다
 *
 * `≠`·`≅` 는 **두 항 사이 관계 기호**다. 오른쪽에 항이 없으면 관계일 수 없다 —
 * 숫자에 붙은 꼬리 글자(`%`·`°`)다. 문턱이 아니라 문법으로 가른다.
 *
 * 반대쪽 표본이 결정적이었다:
 *   · `≠` — 「진짜 부등호」로 분류한 338건이 `y≠0`·`a≠-3`·`p:a≠b` 로 전부 진짜였다.
 *   · `≅` — 「진짜 합동(△ABC≅△DEF)」이 **0건**이다.
 *   · `↔` — 「진짜 동치(p↔q)」가 **0건**이다.
 *
 * ## 본문 밖의 근거로 검산했다
 *
 * 정본 PDF 에는 **수식이 없다**(개체라 텍스트로 안 남는다). 그래서 **기록된 정답**
 * 으로 검산했다 — 네 건 전부 맞았다:
 *   `A=60°,B=45°,b=6√2` → 사인법칙 6√3 = 보기③ ·
 *   `AB=AC=4,A=45°` → 4√2 = 보기③ ·
 *   `70%·20%` → 0.16 = 보기① ·
 *   `sinθ-cosθ=1/3` → 5√17/27 = 보기②
 *
 * ## 왜 유니코드 글자로 넣나 (`\theta` 가 아니라 `θ`)
 *
 * 이 DB 는 이미 `π`(3,137회)·`α`·`β`·`°`(1,983회)·`%`(749회)를 **유니코드 글자**로
 * 담고 있다. 같은 규약을 따라야 렌더가 오늘과 같다 — 여기서만 LaTeX 명령을 쓰면
 * 그 문항만 다른 길로 그려진다.
 */

/** 오른쪽 항이 될 수 있는 글자 — 이게 뒤에 오면 **관계 기호**다. */
const RIGHT_OPERAND = /[0-9a-zA-Z\\({[.\-+]/;

export interface GlyphFix {
  /** 잘못 읽힌 글자. */
  from: string;
  /** 원래 글자. */
  to: string;
  /** 사람이 읽는 사유 — 원장에 남는다. */
  why: string;
}

export const FIXES: readonly GlyphFix[] = [
  {
    from: "≅",
    to: "°",
    why: "숫자·변수 뒤 ≅ 는 도(°)다. 진짜 합동(△≅△)은 0건",
  },
  {
    from: "↔",
    to: "θ",
    why: "삼각함수·각의 변수 ↔ 는 세타(θ)다. 진짜 동치(p↔q)는 0건",
  },
  {
    from: "≠",
    to: "%",
    why: "오른쪽 항이 없는 ≠ 는 퍼센트(%)다. 항이 있으면 진짜 부등호라 안 건드린다",
  },
];

/**
 * 이 자리의 글자가 **꼬리**인가 — 오른쪽에 항이 없나.
 *
 * `≠` 에만 쓴다. `≅`·`↔` 는 진짜 쓰임이 0건이라 자리를 안 가린다
 * (가리면 `90≅-x` 같은 «다음 연산자» 를 오른쪽 항으로 잘못 읽는다 — 실제로 그랬다).
 */
function isTail(text: string, at: number): boolean {
  for (let i = at + 1; i < text.length; i++) {
    const c = text[i]!;
    if (c === " " || c === "\t") continue;
    return !RIGHT_OPERAND.test(c);
  }
  return true; // 문자열 끝 — 오른쪽 항이 없다
}

/** 이 문항을 손대면 안 되는가 — 진짜 합동·동치가 섞였으면 통째로 건너뛴다. */
export function looksGenuine(text: string): boolean {
  // △ABC≅△DEF 처럼 도형 사이 합동, `p↔q` 처럼 명제 사이 동치.
  return /[△▲]\s*[A-Z]{2,4}\s*≅/.test(text) || /[pqrs]\s*↔\s*[pqrs]/.test(text);
}

/** 고친 결과와 **자리별 건수**. 아무것도 안 바뀌면 입력을 그대로 돌려준다. */
export function fixGlyphs(text: string): {
  text: string;
  counts: Record<string, number>;
} {
  const counts: Record<string, number> = {};
  if (looksGenuine(text)) return { text, counts };
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    const fix = FIXES.find((f) => f.from === c);
    if (!fix) {
      out += c;
      continue;
    }
    // `≠` 만 자리를 가린다.
    if (fix.from === "≠" && !isTail(text, i)) {
      out += c;
      continue;
    }
    out += fix.to;
    counts[fix.from] = (counts[fix.from] ?? 0) + 1;
  }
  return { text: out, counts };
}
