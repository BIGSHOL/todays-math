/**
 * 🟢 발문의 `[그림]` 자국 가리기 — **조판과 자가 같은 함수를 쓴다.**
 *
 * 원장님이 시험지에서 찾아 주셨다(2026-08-20): 그림이 붙어 있는데 발문에
 * `[그림]` 이라는 글자가 같이 인쇄된다(실측 3,951건).
 *
 * 이 검사가 지키는 것은 셋이다:
 *  ⑴ 그림이 **없으면** 안 지운다 — 그 표시가 「못 푸는 문항」의 유일한 신호다.
 *  ⑵ **보기** 쪽은 안 건드린다 — 「어느 그림이 ①인지 모른다」를 솔직히 보여 준다.
 *  ⑶ 조판이 안 그리는 것을 **자도 안 센다** — 갈라지면 높이가 조용히 어긋난다.
 */
import { describe, expect, it } from "vitest";

import {
  FIGURE_MARKER,
  hideFigureMarker,
} from "../../lib/problem/figureMarker";
import { estimateProblemPx } from "../../lib/printOverflow";

const NL = String.fromCharCode(10);

describe("발문의 자국을 가린다", () => {
  it("그림이 있으면 지운다", () => {
    expect(hideFigureMarker("다음 그림을 보시오. [그림]", true)).toBe(
      "다음 그림을 보시오.",
    );
  });

  it("🔴 그림이 **없으면** 안 지운다 — 못 푸는 문항의 유일한 신호다", () => {
    const raw = "다음 그림을 보시오. [그림]";
    expect(hideFigureMarker(raw, false)).toBe(raw);
  });

  it("자국이 없으면 문자열이 **그대로**다 — 3만여 건의 지면이 안 바뀐다", () => {
    const raw = `한 줄${NL}${NL}두 줄`;
    expect(hideFigureMarker(raw, true)).toBe(raw);
  });

  it("자국만 있던 줄은 통째로 사라진다 — 조판이 안 그리는 빈 줄을 자가 세면 안 된다", () => {
    const got = hideFigureMarker(`앞줄${NL}${FIGURE_MARKER}${NL}뒷줄`, true);
    expect(got.split(NL).filter((l) => l.trim() === "")).toHaveLength(0);
    expect(got).toContain("앞줄");
    expect(got).toContain("뒷줄");
  });

  it("자국을 뺀 자리에 겹친 공백을 남기지 않는다", () => {
    expect(hideFigureMarker("값은?  [그림]  구하시오", true)).toBe(
      "값은? 구하시오",
    );
  });
});

describe("🔴 조판과 **자**가 같은 것을 본다", () => {
  /**
   * 자가 자국을 세면 높이를 **과대평가**한다 — 넘치지도 않는 문항이 경고를 받고,
   * 출제가 그것을 후순위로 밀어 멀쩡한 문항이 안 나간다.
   *
   * 반대로 조판만 지우고 자를 안 고치면 두 값이 갈라지는데, **갈라진 것은
   * 아무도 못 본다** — 지면은 멀쩡하고 숫자만 틀린다.
   */
  const stem = "오른쪽 그림에서 x 의 값을 구하시오.";
  const dim = { width: 100, height: 50 } as const;

  /**
   * 🔴 자국을 **제 줄에** 둔다. 발문 끝에 붙이면 6글자가 줄 수를 안 바꿔서
   *    가드가 **초록으로 남는다** — 실제로 그랬다(2026-08-20 변이 시험).
   *    픽스처가 경계를 안 가르면 그 검사는 아무것도 안 지킨다.
   */
  const marked = `${stem}${NL}${FIGURE_MARKER}${NL}그리고 이어지는 줄.`;
  const clean = `${stem}${NL}그리고 이어지는 줄.`;

  it("자국이 있든 없든 자가 재는 높이가 같다 (그림이 있을 때)", () => {
    expect(estimateProblemPx(marked, [dim])).toBe(
      estimateProblemPx(clean, [dim]),
    );
  });

  it("🔴 그림이 **없으면** 자국을 그대로 센다 — 지면에도 그대로 나간다", () => {
    expect(estimateProblemPx(marked, [])).toBeGreaterThan(
      estimateProblemPx(clean, []),
    );
  });
});
