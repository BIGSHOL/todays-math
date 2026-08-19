/**
 * 확인테스트 범위 한 줄·막대 (S-04 Hi-fi ④) — `describeRange`.
 *
 * 막대가 **거짓말을 하지 않는지**를 본다. 채운 길이와 라벨의 숫자가 같은 것을
 * 가리켜야 하고, 학년을 넘는 범위에서 100% 를 넘거나 음수가 되면 안 된다.
 */
import { describe, expect, it } from "vitest";

import { describeRange } from "@/components/test/rangeSummary";

/** 중2 4개 + 중3 2개. orderIndex 는 전역 연속값이다(D-27). */
const UNITS = [
  { id: "m2-1", grade: "중2", chapter: "1. 수와 식", section: "유리수와 소수", orderIndex: 413 },
  { id: "m2-2", grade: "중2", chapter: "1. 수와 식", section: "순환소수", orderIndex: 414 },
  { id: "m2-3", grade: "중2", chapter: "2. 부등식", section: "부등식", orderIndex: 415 },
  { id: "m2-4", grade: "중2", chapter: "2. 부등식", section: "일차부등식의 풀이", orderIndex: 416 },
  { id: "m3-1", grade: "중3", chapter: "1. 실수", section: "제곱근", orderIndex: 470 },
  { id: "m3-2", grade: "중3", chapter: "1. 실수", section: "무리수", orderIndex: 471 },
];

describe("[S-04] 확인테스트 범위 한 줄·막대", () => {
  it("한 줄은 시작·끝 소단원 이름이고, 막대는 그 학년에서의 자리다", () => {
    const summary = describeRange(UNITS, "m2-1", "m2-2");

    expect(summary).toEqual({
      text: "유리수와 소수 ~ 순환소수",
      label: "중2 소단원 4개 중 1~2번째",
      offsetPct: 0,
      widthPct: 50,
    });
  });

  it("범위가 중간부터면 막대도 그만큼 밀린다", () => {
    const summary = describeRange(UNITS, "m2-3", "m2-4");

    expect(summary?.label).toBe("중2 소단원 4개 중 3~4번째");
    expect(summary?.offsetPct).toBe(50);
    expect(summary?.widthPct).toBe(50);
  });

  /**
   * 🔒 **학년을 넘어도 막대가 넘치지 않는다.** 분모는 끝 학년(중3) 하나로 고정하고,
   * 시작이 그 앞 학년이면 왼쪽 끝부터 채운 뒤 「(중2부터 이어짐)」이라고 적는다 —
   * 두 학년을 합쳐 분모로 쓰면 범위가 바뀔 때마다 분모가 움직여 막대끼리 못 견준다.
   */
  it("학년을 넘는 범위는 끝 학년 기준으로 그리고, 이어짐을 적는다", () => {
    const summary = describeRange(UNITS, "m2-3", "m3-1");

    expect(summary?.text).toBe("부등식 ~ 제곱근");
    expect(summary?.label).toBe("중3 소단원 2개 중 1~1번째 (중2부터 이어짐)");
    expect(summary?.offsetPct).toBe(0);
    expect(summary?.widthPct).toBe(50);
  });

  it("시작·끝이 뒤바뀌어 들어와도 앞에서부터 읽는다", () => {
    expect(describeRange(UNITS, "m2-4", "m2-1")?.text).toBe(
      "유리수와 소수 ~ 일차부등식의 풀이",
    );
  });

  it("모르는 단원이면 아무것도 그리지 않는다 — 지어내지 않는다", () => {
    expect(describeRange(UNITS, "", "m2-1")).toBeNull();
    expect(describeRange(UNITS, "m2-1", "지워진-단원")).toBeNull();
  });
});
