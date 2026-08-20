/**
 * **극한의 화살표** — `\lim_{x \Rightarrow 0}` 은 `\lim_{x \to 0}` 이어야 한다.
 *
 * ## 어디서 왔나
 *
 * HWP 수식 스크립트의 `rarrow` 는 **→**(rightarrow)다. 그런데 정본 변환기
 * (`testchanger/core/hwpeq_to_latex.py`)가 그것을 **`\Rightarrow`(⇒)** 로
 * 옮긴다(실측: `lim _{n rarrow INF }` → `\lim _{n\Rightarrow \infty }`).
 * ⇒ 는 «함의»이지 «가까워진다»가 아니다. 지면에 `lim_{x⇒0}` 로 찍힌다.
 *
 * ## 🔴 `\Rightarrow` 를 전부 바꾸면 안 된다
 *
 * 실측 981자리 중 **밖 451자리는 진짜 함의**다 —
 * `명제 q ⇒ p` · `(x+3)(x-2)<0 ⇒ -3<x<2` · `0.3x>2.4 ⇒ x>8`.
 * 그것까지 → 로 바꾸면 **뜻이 반대로** 된다.
 *
 * 그래서 **`\lim` 의 아래첨자 안**에서만 바꾼다(530자리). 거기서는 ⇒ 가
 * 성립할 수 없다 — 극한의 아래첨자는 «어디로 가까워지는가»만 적는 자리다.
 * 못 가르는 밖 451자리는 **손대지 않는다**(2026-08-18 근호와 같은 규율).
 */

/** `\lim` 뒤 아래첨자 `_{…}` — 중괄호 짝을 세어 읽는다(한 겹만 보면 샌다). */
const LIM_HEAD = /\\lim\s*_\s*\{/g;

export interface LimArrowResult {
  text: string;
  /** 바꾼 자리 수. */
  fixed: number;
}

export function fixLimArrow(input: string): LimArrowResult {
  let text = input;
  let fixed = 0;

  for (let guard = 0; guard < 200; guard++) {
    LIM_HEAD.lastIndex = 0;
    let hit: { open: number; close: number } | null = null;
    for (const m of text.matchAll(LIM_HEAD)) {
      const open = m.index + m[0].length; // `{` 바로 다음
      let depth = 1;
      let i = open;
      while (i < text.length && depth > 0) {
        if (text[i] === "{") depth++;
        else if (text[i] === "}") depth--;
        i++;
      }
      if (depth !== 0) continue; // 짝이 안 맞는다 — 손대지 않는다
      const close = i - 1;
      if (text.slice(open, close).includes("\\Rightarrow")) {
        hit = { open, close };
        break;
      }
    }
    if (!hit) break;
    const body = text.slice(hit.open, hit.close);
    const next = body.replace(/\\Rightarrow/g, "\\to ");
    fixed += (body.match(/\\Rightarrow/g) ?? []).length;
    text = text.slice(0, hit.open) + next + text.slice(hit.close);
  }

  // `\to  ` 처럼 공백이 겹치면 한 칸으로. 지면에서 차이는 없지만 스냅숏이 흔들린다.
  if (fixed > 0) text = text.replace(/\\to\s{2,}/g, "\\to ");
  return { text, fixed };
}
