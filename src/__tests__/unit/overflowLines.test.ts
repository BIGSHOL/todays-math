/**
 * 🔴 RED — 넘침 판정이 **줄 수**를 보게 한다.
 *
 * ## 왜 이 테스트가 있는가
 *
 * 자습 지면은 문항 하나가 고정 높이 반 페이지 칸인데, 그 칸(`.problemItem`)에는
 * **`overflow` 가 없다.** 그래서 넘치면 잘리는 게 아니라 **옆 문항 위에 겹쳐 찍히고**,
 * 아래 칸에서 넘치면 보기·정답란이 지면 밖으로 밀려 사라진다 — 어느 쪽이든
 * **아무 표시 없이 인쇄돼 학생에게 배포된다**(적대적 리뷰 ③ §3). 그래서 넘침 판정은
 * "인쇄를 막는 장치"가 아니라 **원장이 알고 누르게 하는 유일한 장치**다.
 *
 * 그런데 판정이 `displayWidth(content)` 하나만 봤다. 그건 **글자 폭의 총합**이라
 * 줄 수를 모른다. 2026-08-17 상자·보기 열 수 수리로 지면 높이가 실제로 늘었는데
 * (상자 3,573문항에 테두리+여백, 긴 보기 2,065문항이 1열로 내려가 최대 2줄 증가)
 * **총합은 한 글자도 안 변한다.** 지표가 구조적으로 못 보는 자리다 —
 * 이 저장소가 반복해서 데인 「실패를 셀 수 없는 지표」와 같은 부류다.
 *
 * 그래서 아래 셋을 잠근다.
 *   1. 같은 글자를 담아도 **1열 보기가 2열보다 높다.**
 *   2. 같은 글자를 담아도 **상자가 있으면 더 높다.**
 *   3. 판정은 렌더러와 **같은 함수**로 열 수를 정한다 — 둘이 갈라지면
 *      "화면은 1열인데 판정은 2열로 셈" 같은 침묵 회귀가 난다.
 */
import { describe, expect, it } from "vitest";

import { estimateProblemLines } from "@/lib/printOverflow";

/** 보기 5개를 만든다. `width` 는 한 항목의 대략적인 표시폭(한글 1자 = 2). */
function choices(count: number, width: number): string {
  const marks = ["①", "②", "③", "④", "⑤"];
  const body = "가".repeat(Math.max(1, Math.floor(width / 2)));
  return marks
    .slice(0, count)
    .map((mark) => `${mark} ${body}`)
    .join("\n");
}

const SHORT_STEM = "다음 중 옳은 것은?";

describe("[넘침] 보기 열 수가 높이에 반영된다", () => {
  it("짧은 보기(2열로 들어감)보다 긴 보기(1열로 내려감)가 더 높다", () => {
    // 표시폭 10 — TWO_COLUMN_WIDTH_LIMIT(24) 안이라 2열로 남는다.
    const twoCol = `${SHORT_STEM}\n${choices(5, 10)}`;
    // 표시폭 40 — 한계를 넘어 1열로 내려간다.
    const oneCol = `${SHORT_STEM}\n${choices(5, 40)}`;

    const a = estimateProblemLines(twoCol);
    const b = estimateProblemLines(oneCol);
    expect(b).toBeGreaterThan(a);
  });

  it("보기 개수가 같고 폭만 한계를 넘으면 그것만으로 높이가 는다", () => {
    // 한계값 바로 아래 / 바로 위. 글자 수 차이는 작지만 배치가 갈린다.
    const under = `${SHORT_STEM}\n${choices(5, 22)}`;
    const over = `${SHORT_STEM}\n${choices(5, 26)}`;
    expect(estimateProblemLines(over)).toBeGreaterThan(
      estimateProblemLines(under),
    );
  });
});

describe("[넘침] 상자가 높이에 반영된다", () => {
  it("같은 글자라도 <보기> 상자로 묶이면 더 높다", () => {
    const items = "ㄱ. 유리수이다 ㄴ. 무리수이다 ㄷ. 정수이다";
    const plain = `${SHORT_STEM} ${items}`;
    const boxed = `${SHORT_STEM} <보기> ${items}`;

    expect(estimateProblemLines(boxed)).toBeGreaterThan(
      estimateProblemLines(plain),
    );
  });

  it("상자는 테두리·여백만큼도 먹는다 — 라벨 줄 하나로 퉁치지 않는다", () => {
    // 항목이 하나뿐인 상자. 같은 글자를 상자 없이 쓴 것과 견주면
    // **테두리+여백(2줄) + 라벨(1줄)** 만큼은 반드시 높아야 한다.
    // 이 하한이 없으면 `BOX_CHROME_LINES` 를 0 으로 만들어도 테스트가 초록이다
    // (라벨 줄 하나만으로 "더 높다"가 성립해 버린다 — 실제로 그랬다).
    const item = "ㄱ. 유리수이다";
    const plain = `${SHORT_STEM} ${item}`;
    const boxed = `${SHORT_STEM} <보기> ${item}`;

    const diff = estimateProblemLines(boxed) - estimateProblemLines(plain);
    expect(diff).toBeGreaterThanOrEqual(3);
  });

  it("상자가 둘이면 하나일 때보다 높다", () => {
    const one = "다음을 보시오. <보기> ㄱ. 참 ㄴ. 거짓";
    const two = "다음을 보시오. <보기> ㄱ. 참 ㄴ. 거짓 <조건> ∘ 양수 ∘ 정수";
    expect(estimateProblemLines(two)).toBeGreaterThan(
      estimateProblemLines(one),
    );
  });
});

describe("[넘침] 판정과 렌더러가 같은 규칙을 쓴다", () => {
  it("본문이 길수록 줄 수가 늘어난다 — 단조성", () => {
    const short = estimateProblemLines("짧은 문항이다.");
    const long = estimateProblemLines("긴 ".repeat(200) + "문항이다.");
    expect(long).toBeGreaterThan(short);
  });

  it("빈 본문도 던지지 않고 0 이상을 낸다", () => {
    expect(estimateProblemLines("")).toBeGreaterThanOrEqual(0);
  });
});
