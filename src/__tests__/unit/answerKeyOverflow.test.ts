/**
 * 🔴 RED → 🟢 정답지도 판정한다 — 적대적 리뷰 ③ `[적대③-C]` (§5, §11-3).
 *
 * ## 왜 이 테스트가 있는가
 *
 * `assessOverflowRisk` 는 `problem.content` 만 읽고 **`solution` 은 한 글자도 안 봤다.**
 * 그런데 정답지에도 클립이 있다 — `.answerSolutions { overflow: hidden; column-count: 2 }`
 * 라, 높이를 넘긴 해설은 **3번째 단으로 밀려 지면 밖에서 사라진다.**
 * 세로로 조금 잘리는 게 아니라 **한 문항의 해설이 통째로 없어진다.**
 *
 * 실측(Chromium 인쇄 매체, 시험지 120개 × 25문항, 해설 있는 문항만):
 *   정답지 480장 중 해설이 잘린 장 **134장(27.9%)** · 그중 1쪽이 **95장**
 *   해설 3,000건 중 지면 밖으로 밀린 것 **256건(8.53%)**
 *
 * 1쪽이 유독 많은 이유는 「빠른 정답」 상자다 — 시험지 전 문항을 4열로 늘어놓으므로
 * 문항 수에 비례해 커지고(25문항이면 7행 = 345px), 그만큼 해설 칸이 좁아진다.
 *
 * ⚠️ **정원(장당 8건)은 안 건드린다.** 줄이면 정답지 장 수와 배치가 바뀌므로
 *    원장님 확정 대상이다(D-07, 절대 규칙 1·6). 여기서는 **알리기만** 한다.
 */
import { describe, expect, it } from "vitest";

import type { TestPrintProblem } from "@/components/print/types";
import { JASEUP_GEOMETRY, JASEUP_MEASURED_PX } from "@/lib/printGeometry";
import {
  assessAnswerKeyRisk,
  estimateSolutionPx,
  quickAnswerBoxPx,
} from "@/lib/printOverflow";

const problem = (over: Partial<TestPrintProblem> = {}): TestPrintProblem => ({
  id: "p1",
  orderIndex: 0,
  content: "다음을 계산하시오.",
  answer: "1",
  solution: null,
  ...over,
});

/** 문항 n개짜리 시험지. 해설은 길이만 다르게 준다. */
function withSolutions(solutions: (string | null)[]): TestPrintProblem[] {
  return solutions.map((solution, index) =>
    problem({ id: `p${index + 1}`, orderIndex: index + 1, solution }),
  );
}

describe("[적대③-C] 「빠른 정답」 상자가 1쪽 해설 칸을 얼마나 먹는가", () => {
  const plain = (n: number) => Array.from({ length: n }, (_, i) => `${i % 5}`);

  it("짧은 정답만 있으면 4열 · 4문항마다 한 행이다", () => {
    // 실측(정답이 전부 한 글자): 8문항 129.2px · 12문항 172.3px ·
    // 16문항 215.4px · 25문항 344.7px
    expect(quickAnswerBoxPx(plain(8))).toBeCloseTo(129.2, 0);
    expect(quickAnswerBoxPx(plain(12))).toBeCloseTo(172.3, 0);
    expect(quickAnswerBoxPx(plain(16))).toBeCloseTo(215.4, 0);
    expect(quickAnswerBoxPx(plain(25))).toBeCloseTo(344.7, 0);
  });

  /**
   * ⚠️ 여기서 한 번 크게 틀렸다. 처음에는 이 상자를 **문항 수만으로** 쟀다
   * (합성 정답 「1」 로 재서 25문항 = 344.7px 로 굳혔다). 그런데 실제 정답은
   * 수식이라 셀이 두세 줄이 되고, 실측 상자 높이가 **344~668px** 로 갈린다.
   * 그만큼 1쪽 해설 칸을 넓게 봐서 경고를 놓쳤다 —
   * **지면 실측은 실제 내용으로, 실제 지면 안에서 해야 한다.**
   */
  it("정답이 길면 셀이 접혀 상자가 커진다 — 문항 수만으로는 못 구한다", () => {
    const long = Array.from({ length: 8 }, () => "$\frac{-3+2\sqrt{5}}{7}$");
    expect(quickAnswerBoxPx(long)).toBeGreaterThan(quickAnswerBoxPx(plain(8)));
  });

  it("한 행의 높이는 그 행에서 **가장 높은 칸**이다", () => {
    const oneTall = ["1", "2", "3", "가".repeat(30)];
    const allShort = ["1", "2", "3", "4"];
    expect(quickAnswerBoxPx(oneTall)).toBeGreaterThan(
      quickAnswerBoxPx(allShort),
    );
    // 그 행 하나가 길어진 만큼만 커진다 — 네 칸이 다 길어도 같다.
    const allTall = Array.from({ length: 4 }, () => "가".repeat(30));
    expect(quickAnswerBoxPx(allTall)).toBe(quickAnswerBoxPx(oneTall));
  });

  it("문항이 없으면 상자도 없다", () => {
    expect(quickAnswerBoxPx([])).toBe(0);
  });
});

describe("[적대③-C] 해설 한 건의 지면 높이", () => {
  it("해설이 없으면 「등록되지 않았습니다」 한 줄만큼은 먹는다", () => {
    expect(estimateSolutionPx(null)).toBeGreaterThan(0);
    expect(estimateSolutionPx(null)).toBeLessThan(
      JASEUP_MEASURED_PX.answerSolutionsFull / 4,
    );
  });

  /**
   * ⚠️ 같은 글자를 되풀이한 문자열을 쓰면 안 된다 — 렌더러 정규화의
   *    `dropDuplicatedTail`(OCR 이 꼬리를 두 번 저장한 결함 제거)이 절반을 지운다.
   *    판정이 그걸 그대로 따라가는 게 맞고, 그래서 시험 데이터는 안 되풀이돼야 한다.
   */
  const varied = (n: number) =>
    Array.from({ length: n }, (_, i) => `${i}단계 계산한다.`).join(" ");

  it("길수록 높다 — 폭 총합이 아니라 단 폭으로 접은 줄 수다", () => {
    const short = estimateSolutionPx(varied(2));
    const long = estimateSolutionPx(varied(60));
    expect(long).toBeGreaterThan(short * 5);
  });

  /**
   * ⚠️ 손상된 입력. DB 해설은 OCR 이 수식마다 빈 줄을 넣어 문단이 100개가 넘는 것이
   *    있다. 그런데 렌더러(`normalizeOcrText`)는 **개행을 전부 공백으로 녹인다** —
   *    문단으로 세면 실측 309px 짜리를 2,098px 로 본다(실제로 그렇게 틀렸다).
   *    판정은 렌더러와 **같은 정규화**를 태워야 한다.
   */
  it("OCR 이 넣은 빈 줄은 문단이 아니다 — 렌더러와 같은 정규화를 쓴다", () => {
    const flowing = "가".repeat(40) + " " + "나".repeat(40);
    const chopped = "가".repeat(40) + "\n\n" + "나".repeat(40);
    expect(estimateSolutionPx(chopped)).toBe(estimateSolutionPx(flowing));
  });
});

describe("[적대③-C] 정답지 쪽에서 사라질 해설을 짚는다", () => {
  it("짧은 해설만 있으면 경고하지 않는다", () => {
    expect(
      assessAnswerKeyRisk(withSolutions(Array(25).fill("간단히 계산한다."))),
    ).toEqual([]);
  });

  /**
   * 25문항 시험지의 1쪽은 「빠른 정답」 상자(7행 345px)가 얹혀 해설 칸이 604px 뿐이다.
   * 2단이라 1,208px 어치가 한계인데, 8건이 전부 긴 해설이면 넘는다.
   */
  it("1쪽은 빠른 정답 상자만큼 좁다 — 같은 해설이 2쪽에서는 들어간다", () => {
    // 한 건 약 8줄(195px). 1쪽 칸(604px)에는 단마다 3건, 2쪽 칸(965px)에는 4건 —
    // 그래서 같은 해설이 1쪽에서만 밀린다.
    const medium = Array.from(
      { length: 9 },
      (_, i) => `${i}단계에서 양변을 정리하면 값이 나온다.`,
    ).join(" ");
    const risks = assessAnswerKeyRisk(
      withSolutions(Array.from({ length: 25 }, () => medium)),
    );
    expect(risks.some((r) => r.page === 1)).toBe(true);
    expect(risks.find((r) => r.page === 1)!.numbers.length).toBeGreaterThan(
      risks.find((r) => r.page === 2)?.numbers.length ?? 0,
    );
  });

  it("사라지는 것은 그 쪽의 **뒷** 문항이다 — 앞에서부터 단을 채운다", () => {
    const long = Array.from(
      { length: 60 },
      (_, i) => `${i}단계에서 양변을 정리하면 값이 나온다.`,
    ).join(" ");
    const risks = assessAnswerKeyRisk(
      withSolutions(Array.from({ length: 8 }, () => long)),
    );
    const lost = risks[0]!.numbers;
    expect(lost.at(-1)).toBe(8);
    expect(lost).not.toContain(1);
  });

  it("정원(장당 8건)은 안 건드린다 — 알리기만 한다", () => {
    expect(JASEUP_GEOMETRY.answerEntriesPerPage).toBe(8);
  });

  it("해설이 통째로 없는 시험지도 경고하지 않는다", () => {
    expect(assessAnswerKeyRisk(withSolutions(Array(25).fill(null)))).toEqual(
      [],
    );
  });
});
