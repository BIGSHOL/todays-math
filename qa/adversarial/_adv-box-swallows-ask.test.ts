/**
 * 적대적 재현 🔴 — **상자가 서술형 발문을 삼킨다. 그리고 감사 지표는 그걸 못 센다.**
 *
 * ── 무엇이 틀렸나 ──────────────────────────────────────────────────────────
 * `boxBlock.endsWithQuestion` 은 발문을 **물음표 하나로** 판정한다. 주석은
 * "`~시오`·`~하여라` 까지 신호로 넣으면 진짜 조건을 상자 밖으로 밀어낸다"고 적었다.
 * 그 대가로 **서술형 문항의 발문은 구조적으로 상자에 남는다** — 이 말뭉치의 서술형은
 * `…을 구하시오.` · `…풀이 과정과 답을 쓰시오.` 로 끝나지 물음표로 끝나지 않는다.
 *
 * 더 나쁜 것은 **감사 도구가 같은 목록을 쓴다는 점**이다.
 * `scripts/qa/audit-box-boundary.ts` 의 「발문 삼킴」 신호도 `[?？]` 하나뿐이라,
 * 서술형 삼킴은 감사에서 **구조적으로 0으로 세어진다.** 보고서
 * `body-typeset.md` §1 이 "물음표(발문 삼킴) 52 → 30" 이라고 적은 30 은
 * **물음표가 있는 것만** 센 수다.
 * (CLAUDE.md 2026-08-18 «목록을 손으로 쓰면 세는 쪽과 고치는 쪽이 같이 눈이 먼다»,
 *  2026-08-16 «지표가 실패를 셀 수 있는 형태인지 먼저 확인하라».)
 *
 * ── 실데이터 근거 (전수 47,152건) ──────────────────────────────────────────
 * 목록에 기대지 않는 열쇠로 다시 셌다 — 「상자 **밖**에 묻는 문장이 하나도 없다」:
 *   `npx tsx qa/adversarial/scripts/scan-swallowed-ask.ts`
 *     발문을 삼킨 문항  옛 96 → 지금 75   (감사가 보는 것은 그중 30)
 *     **새로 삼킨 것(회귀) 2건** — 380a0d63 · bbed4567, 둘 다 이번에 새로 만든
 *     «마커 없는 다음 조건» 상자다.
 *   `npx tsx qa/adversarial/scripts/scan-box-blindspots.ts`
 *     상자가 서술형 발문으로 끝나는 것 94개 — 그중 **87개가 기존 감사에 안 보인다.**
 *   실례: b4dfd873 · fdb2aa8f · 976481bf · 0df42e17 · 2b91e41e · 6ffd193d …
 */
import { describe, expect, it } from "vitest";

import { splitBoxSegments } from "@/lib/math/boxBlock";

/** 상자 안에 발문이 들어갔는가 — 항목 아무 데나 «묻는 문장»이 있으면 삼킨 것이다. */
const ASK_TAIL = /구하시오|구하여라|서술하시오|쓰시오|답하시오|나타내시오/;

function boxItems(raw: string): string[] {
  return splitBoxSegments(raw).flatMap((seg) =>
    seg.kind === "box" ? seg.items : [],
  );
}

describe("적대적 ② 상자가 서술형 발문을 삼킨다", () => {
  it("실측 380a0d63 — «마커 없는 다음 조건» 상자가 발문을 먹었다 (회귀)", () => {
    const raw = [
      "미분가능한 함수 $f(x)$가 다음 조건을 만족시킨다.",
      "∘ $f(1)=1$",
      "∘ $\\int f(x)dx=xf(x)-x^{2}e^{-x}$ 함수 $f(x)$의 최댓값을 구하고 그 과정을 서술하시오.",
    ].join(" ");
    expect(boxItems(raw).some((item) => ASK_TAIL.test(item))).toBe(false);
  });

  it("실측 bbed4567 — 같은 자리, 다른 문항 (회귀)", () => {
    // DB 원문 그대로 (줄바꿈 포함).
    const raw = [
      "최고차항의 계수가 $1$인 사차함수 $f\\left( x\\right)$에 대해 함수 $g\\left( x\\right) =\\left| f\\left( x\\right) +k\\right|$는 다음 조건을 만족한다.",
      "⚪ $g\\left( x\\right)$는 $x=0$에서만 미분불가능하다.",
      "⚪ $f\\left( x\\right)$는 $x=1$일 때, 극솟값 $-2$을 가진다.",
      "이 때, 닫힌구간 $[-1,~4]$에서 함수 $f\\left( x\\right)$의 최댓값을 구하시오. (단, $k$는 상수)",
    ].join("\n");
    expect(boxItems(raw).some((item) => ASK_TAIL.test(item))).toBe(false);
  });

  it("마커 있는 상자도 같다 — 물음표만 없으면 뚫린다", () => {
    const withQuestionMark =
      "<조건> (가) $f(2)=8$ (나) $f(3)=1$ $f(5)$ 의 값은?";
    const withEssayTail =
      "<조건> (가) $f(2)=8$ (나) $f(3)=1$ $f(5)$ 의 값을 구하시오.";
    // 물음표 판은 발문을 상자 밖으로 잘 내보낸다.
    expect(boxItems(withQuestionMark).some((i) => /값은\?/.test(i))).toBe(
      false,
    );
    // 같은 문장을 서술형으로 바꾸면 상자가 삼킨다.
    expect(boxItems(withEssayTail).some((i) => ASK_TAIL.test(i))).toBe(false);
  });
});
