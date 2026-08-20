/**
 * **한 덩어리를 바꿔도 되는가** — 변환 결과에 거는 가드. 한 곳.
 *
 * ## 🔴 왜 «행» 이 아니라 «덩어리» 인가
 *
 * 처음엔 가드를 **행 단위**로 걸었다. 한 해설에서 덩어리 하나가 걸리면
 * **그 행의 멀쩡한 덩어리 40개가 같이 버려졌다.** 실측으로 그렇게 버려진 행이
 * 107이고, 그 안에는 `{13} over {20}` 처럼 **아무 문제 없이 바뀌는 덩어리**가
 * 대부분이었다(2026-08-21 실측: 102문항이 「변환 대상인데 남음」).
 *
 * 분모를 잘못 잡으면 가드가 지나치게 문다. 여기서 판정의 단위는
 * **바꾸는 단위와 같아야 한다** — 우리는 덩어리를 바꾸므로 덩어리로 판정한다.
 * 못 바꾸는 덩어리는 **원래 글자 그대로** 두면 그만이고, 그건 지금까지와
 * 똑같은 상태다. 즉 덩어리 단위 판정은 **잃는 것이 없다.**
 *
 * ## 무엇을 막나 (각각 실제로 무엇을 잡았나)
 *
 * | 가드 | 막는 것 |
 * | --- | --- |
 * | 감춘 열쇠 | 겉포장이 감춘 사적 영역 글자를 변환기가 삼킨 자리 |
 * | 한글 | 변환이 한글을 먹었다 |
 * | 수(개수까지) | 집합으로 세면 **같은 수가 또 있을 때 손실이 안 보인다** |
 * | 잔재 | `sqrt {3} of 3` → `\sqrt{3}of3` 의 날 `of` |
 * | 빈 분수 | `LE pi over` 같은 잘린 조각에서 분모를 삼킨다 |
 * | 붉어짐 | 제품 렌더러가 붉게 그리면 지면에 붉게 나간다 |
 */
import { renderMathHtml } from "../../src/lib/math/renderMathHtml";
import { residueRuns } from "./solutionHwpScope";

/** 겉포장이 감출 때 쓰는 사적 영역 열쇠 — 결과에 남으면 변환이 삼킨 것이다. */
export const MASK_KEY = /[-]/u;

export const 한글 = (s: string) => (s.match(/[가-힣]/g) ?? []).join("");

/**
 * 수를 **개수까지** 센다.
 *
 * 🔴 집합으로 세면 같은 수가 또 있을 때 손실이 구조적으로 안 보인다 —
 *    `\frac{1}{2}+\frac{1}{2}` 에서 하나가 사라져도 집합은 그대로다.
 */
export const 수 = (s: string): Map<string, number> => {
  const m = new Map<string, number>();
  for (const n of s.match(/\d+/g) ?? []) m.set(n, (m.get(n) ?? 0) + 1);
  return m;
};

export const 빈분수 = (s: string) =>
  (s.match(/\\frac\{[^{}]*\}\{\}|\\frac\{\}/g) ?? []).length;

export const 붉은가 = (s: string) => {
  const html = renderMathHtml(s);
  return html.includes("katex-error") || html.includes("#cc0000");
};

export type SpanGuard =
  { ok: true } | { ok: false; why: string; 남은?: string[] };

/** 한 행에서 갈아 끼울 자리 하나. `out` 이 `null` 이면 변환에 실패한 것이다. */
export interface SpanPiece {
  /** `$` 를 **포함한** 시작 위치. */
  start: number;
  /** `$` 를 **포함한** 끝 위치(배타적). */
  end: number;
  body: string;
  out: string | null;
}

export interface SpliceResult {
  after: string;
  /** 실제로 갈아 끼운 덩어리 수. 0이면 이 행은 안 바뀐다. */
  바꾼수: number;
  /** 버린 덩어리의 사유 — 무엇을 못 고쳤는지 조용하지 않게 한다. */
  버림: { why: string; 남은?: string[] }[];
}

/**
 * 가드를 통과한 덩어리**만** 갈아 끼운다.
 *
 * 🔴 걸린 덩어리 하나가 **그 행 전부를 버리게 하지 않는다.** 못 바꾸는 덩어리는
 *    원래 글자 그대로 남으므로 지금까지와 같은 상태이고, 옆 덩어리를 고치는 것을
 *    막을 이유가 없다. 실측: 행 단위였을 때 107행이 통째로 버려졌다.
 *
 * 뒤에서부터 갈아 끼운다 — 앞자리를 먼저 바꾸면 뒤 자리의 오프셋이 흔들린다.
 */
export function spliceAccepted(
  before: string,
  pieces: readonly SpanPiece[],
): SpliceResult {
  let after = before;
  let 바꾼수 = 0;
  const 버림: { why: string; 남은?: string[] }[] = [];
  for (const p of [...pieces].sort((a, b) => b.start - a.start)) {
    const v = judgeConverted(p.body, p.out);
    if (!v.ok) {
      버림.push({ why: v.why, 남은: v.남은 });
      continue;
    }
    after = after.slice(0, p.start) + "$" + p.out + "$" + after.slice(p.end);
    바꾼수++;
  }
  return { after, 바꾼수, 버림 };
}

/**
 * 바뀐 덩어리를 받아들일지 판정한다.
 *
 * @param body 원래 덩어리 본문 (`$` 없이)
 * @param out  변환기가 준 본문 (`null` 이면 변환 실패)
 */
export function judgeConverted(body: string, out: string | null): SpanGuard {
  if (out == null) return { ok: false, why: "변환 실패" };
  if (out === body) return { ok: false, why: "바뀐 것 없음" };
  // 판정도 **지면과 같은 모양**으로 한다 — `$` 를 씌워야 렌더러가 수식으로 읽는다.
  const 전 = "$" + body + "$";
  const 후 = "$" + out + "$";
  if (MASK_KEY.test(후)) return { ok: false, why: "🔴 감춘 열쇠가 남았다" };
  if (한글(후) !== 한글(전)) return { ok: false, why: "🔴 한글이 달라졌다" };
  const 후수 = 수(후);
  for (const [n, c] of 수(전))
    if ((후수.get(n) ?? 0) < c) return { ok: false, why: "🔴 수를 잃었다" };
  // 🔴 결과 검사는 `scopeOf` 가 아니라 `residueRuns` 다 — `scopeOf` 의
  //    「역슬래시가 있으면 LaTeX」 규칙을 결과에 대면 **구조적으로 0**이 된다.
  const 남은 = residueRuns(후);
  if (남은.length > 0) return { ok: false, why: "잔재가 남았다", 남은 };
  if (빈분수(후) > 빈분수(전)) return { ok: false, why: "🔴 빈 분수가 생겼다" };
  if (붉은가(후) && !붉은가(전)) return { ok: false, why: "🔴 붉어졌다" };
  return { ok: true };
}
