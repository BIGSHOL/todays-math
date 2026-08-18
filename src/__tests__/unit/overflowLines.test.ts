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

import { JASEUP_MEASURED_PX } from "@/lib/printGeometry";
import {
  estimateProblemLines,
  estimateProblemPx,
  OVERFLOW_LINE_LIMIT,
} from "@/lib/printOverflow";

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

/**
 * 🟢 회귀 가드 — 적대적 리뷰 ③ `[적대③-D]` 승격 (§6).
 *
 * 추정기의 «자»가 지면과 **한 방향으로** 어긋나 있었다(전부 덜 셌다):
 *   · 문항번호 + 정답란 62.5px = 3.08줄 → **0줄**로 셈 (모든 문항)
 *   · 상자 하나 98.0px(= `my-4` 포함) → 3줄(60.9px)로 셈
 *   · 문항 열 58.2 · 1열 보기 55.2 · 상자 항목 52.7 단위 → **전부 59단위**로 셈
 *   · 보기 그리드 `mt-4` 16px + 행 간격 8px×n → 0으로 셈
 *
 * 셋을 바로잡고 한계를 **칸 높이에서 다시 유도**했다(`484/20.3125 → 23`).
 * 순서가 중요하다 — 자만 고치면 경고가 8,446건(정밀도 32.3%)으로 튀고,
 * 한계만 올리면 덜 세던 몫이 되살아난다.
 *
 * 아래 수치는 `scripts/qa/measure-paper-units.tsx` 가 지면에서 잰 것이다.
 * 여기가 빨개지면 지면 CSS 가 바뀐 것이니 **다시 재서** 상수를 고칠 것.
 */
describe("[적대③-D] 추정기의 «자»가 지면과 맞는가", () => {
  const { line, fixedChrome, continuationSlot } = JASEUP_MEASURED_PX;
  /** 실측 대 추정을 줄 단위로 견준다 (실측은 measure-paper-units.tsx 산출). */
  const closeToLines = (actual: number, measured: number) =>
    expect(Math.abs(actual - measured)).toBeLessThanOrEqual(1);

  it("빈 본문도 문항번호·정답란만큼은 쓴다 — 실측 3.08줄", () => {
    expect(estimateProblemPx("")).toBeCloseTo(fixedChrome, 5);
    expect(fixedChrome / line).toBeCloseTo(3.08, 2);
    expect(estimateProblemLines("")).toBeGreaterThanOrEqual(3);
  });

  it("한계는 문항 칸 높이에서 유도된다", () => {
    expect(OVERFLOW_LINE_LIMIT).toBe(Math.floor(continuationSlot / line));
    // 한계까지 채운 문항은 칸 안이고, 한 줄 더 가면 밖이다.
    expect(OVERFLOW_LINE_LIMIT * line).toBeLessThanOrEqual(continuationSlot);
    expect((OVERFLOW_LINE_LIMIT + 1) * line).toBeGreaterThan(continuationSlot);
  });

  /** 실측 8.36줄(본문) + 고정 chrome 3.08줄. 예전 추정은 본문 6줄이었다. */
  it("1열 보기 다섯 개 — 실측 본문 8.36줄", () => {
    const content = `다음 중 옳은 것은?
1. ${"가".repeat(20)}
2. ${"나".repeat(20)}
3. ${"다".repeat(20)}
4. ${"라".repeat(20)}
5. ${"마".repeat(20)}`;
    closeToLines((estimateProblemPx(content) - fixedChrome) / line, 8.36);
  });

  /** 실측 5.58줄. `mt-4`·행 간격을 안 세면 4줄로 보인다. */
  it("2열 보기 다섯 개 — 실측 본문 5.58줄", () => {
    const content = `다음 중 옳은 것은?
1. ${"가".repeat(5)}
2. ${"나".repeat(5)}
3. ${"다".repeat(5)}
4. ${"라".repeat(5)}
5. ${"마".repeat(5)}`;
    closeToLines((estimateProblemPx(content) - fixedChrome) / line, 5.58);
  });

  /** 실측 9.04줄. `my-4` 와 좁은 항목칸(52.7단위)을 안 보면 8줄로 보인다. */
  it("<보기> 상자 — 실측 본문 9.04줄", () => {
    const content = `다음 <보기> 에서 옳은 것을 고르시오.
<보기>
ㄱ. ${"가".repeat(30)}
ㄴ. ${"나".repeat(30)}`;
    closeToLines((estimateProblemPx(content) - fixedChrome) / line, 9.04);
  });

  /** 상자가 없는 같은 글자 — 실측 3.00줄. 상자 몫이 진짜 상자에서만 붙는지 본다. */
  it("상자 없는 같은 글자 — 실측 본문 3.00줄", () => {
    const content = `다음 보기 에서 옳은 것을 고르시오. ㄱ. ${"가".repeat(30)} ㄴ. ${"나".repeat(30)}`;
    closeToLines((estimateProblemPx(content) - fixedChrome) / line, 3.0);
  });

  it("한 줄짜리 평문 — 실측 본문 1.00줄", () => {
    closeToLines(
      (estimateProblemPx("가".repeat(20)) - fixedChrome) / line,
      1.0,
    );
  });
});

/**
 * 🟢 회귀 가드 — 적대적 리뷰 ④.
 *
 * 위 `[적대③-D]` 픽스처는 **세 열 폭을 가르지 못했다.** 보기 항목 폭 40·상자 항목
 * 폭 60 은 문항 열(58.2단위)·보기 글자칸(55.2)·상자 항목칸(52.7) 어디서도 한 줄이라,
 * 셋을 **한 값으로 뭉개도 전부 초록**이었다(상수 변이 시험으로 확인).
 * 그래서 «셋이 갈리는 자리»의 폭으로 다시 잠근다.
 */
describe("[적대④] 세 열 폭이 실제로 갈린다", () => {
  const stem = "다음 중 옳은 것은?";
  /** 한글 한 글자 = 표시폭 2. */
  const wide = "가".repeat(28); // 56단위 — 보기 글자칸(55.2)은 넘고 문항 열(58.2)은 안 넘는다
  const narrow = "가".repeat(20); // 40단위 — 어느 열에서도 한 줄

  it("1열 보기는 **보기 글자칸**으로 접는다 — 문항 열로 재면 한 줄로 보인다", () => {
    const list = (body: string) =>
      `${stem}\n1. ${body}\n2. ${body}\n3. ${body}\n4. ${body}\n5. ${body}`;
    const grown =
      (estimateProblemPx(list(wide)) - estimateProblemPx(list(narrow))) /
      JASEUP_MEASURED_PX.line;
    // 다섯 항목이 각각 한 줄씩 늘어야 한다. 문항 열로 재면 0줄이다.
    expect(grown).toBeGreaterThanOrEqual(4.5);
  });

  it("상자 항목은 **상자 항목칸**으로 접는다 — 더 좁다", () => {
    // 54단위 — 상자 항목칸(52.7)은 넘고 보기 글자칸(55.2)·문항 열은 안 넘는다.
    const boxed = (body: string) =>
      `다음 <보기>\n<보기>\nㄱ. ${body}\nㄴ. ${body}`;
    const grown =
      (estimateProblemPx(boxed("가".repeat(27))) -
        estimateProblemPx(boxed("가".repeat(20)))) /
      JASEUP_MEASURED_PX.line;
    expect(grown).toBeGreaterThanOrEqual(1.5);
  });

  it("셋이 서로 다르다 — 상자가 가장 좁고 문항 열이 가장 넓다", () => {
    const { boxItemColumn, choiceTextColumn, problemColumn } =
      JASEUP_MEASURED_PX;
    expect(boxItemColumn).toBeLessThan(choiceTextColumn);
    expect(choiceTextColumn).toBeLessThan(problemColumn);
  });
});
