/**
 * 스크롤 상자 안에서만 굴린다 — `scrollDeltaToReveal`.
 *
 * 이 계산을 함수로 뺀 이유: 컴포넌트에서 `scrollIntoView` 를 부르면 **문서까지**
 * 굴러서 페이지가 튄다(원장님이 지적하신 바로 그 증상). 여기서는 「열 상자를 얼마나
 * 굴릴까」만 답하고, DOM 은 안 만진다.
 */
import { describe, expect, it } from "vitest";

import { scrollDeltaToReveal } from "@/components/progress/revealWithin";

describe("[범위 피커] 열 안에서만 굴린다", () => {
  it("이미 다 보이면 굴리지 않는다", () => {
    expect(
      scrollDeltaToReveal({
        containerTop: 100,
        containerHeight: 260,
        nodeTop: 140,
        nodeHeight: 44,
      }),
    ).toBe(0);
  });

  it("아래에 숨어 있으면 가운데로 가져온다", () => {
    // 상자 100~360, 항목 500~544 → 가운데(100+108)로 오려면 292 만큼 굴린다.
    expect(
      scrollDeltaToReveal({
        containerTop: 100,
        containerHeight: 260,
        nodeTop: 500,
        nodeHeight: 44,
      }),
    ).toBe(292);
  });

  it("위에 숨어 있으면 음수로 굴린다", () => {
    expect(
      scrollDeltaToReveal({
        containerTop: 100,
        containerHeight: 260,
        nodeTop: 20,
        nodeHeight: 44,
      }),
    ).toBe(-188);
  });

  it("경계에 딱 걸치면 굴리지 않는다", () => {
    expect(
      scrollDeltaToReveal({
        containerTop: 100,
        containerHeight: 260,
        nodeTop: 316,
        nodeHeight: 44,
      }),
    ).toBe(0);
  });

  /**
   * 🔒 항목이 상자보다 크면 **가운데 정렬이 머리를 자른다**(위로 20px 밀린다).
   * 잘릴 수밖에 없다면 시작이 보이는 쪽이 낫다 — 위를 맞춘다.
   */
  it("항목이 상자보다 크면 머리를 자르지 않고 위를 맞춘다", () => {
    expect(
      scrollDeltaToReveal({
        containerTop: 100,
        containerHeight: 260,
        nodeTop: 400,
        nodeHeight: 300,
      }),
    ).toBe(300);
  });
});
