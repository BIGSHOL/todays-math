/**
 * 🔴 배점 채움 규칙 — 이 규칙 하나가 멀쩡한 시험지를 통째로 버리고 있었다.
 *
 * 추출기가 서술형의 `[합 10점]` 표기를 놓치면 그 문항만 배점이 빈다. 예전에는 그 자리를
 * **편 전체 중앙값**(객관식이 지배하니 3~4점)으로 메워 총점이 모자랐고, 만점 100
 * 신뢰 가드(D-45)에 걸려 원본이 멀쩡한 시험지가 학습·출제에서 통째로 빠졌다.
 *
 * 원본 PDF 실측으로 확인된 사례:
 *   강동중 중2 = 객관식 16문 합 60 + 서술형 4문 × 10점 = **정확히 100** (추출 90점)
 */
import { describe, expect, it } from "vitest";

import {
  fillScore,
  scoreFromText,
  type ScoredQuestion,
} from "@/lib/predictor/fillScore";

const q = (qtype: string, score: number | null): ScoredQuestion => ({
  qtype,
  score,
});

describe("[T7.18] 배점 채움", () => {
  it("배점이 이미 있으면 건드리지 않는다 — 읽힌 값을 추정치로 덮지 않는다", () => {
    const all = [q("객관식", 3), q("서술형", 10)];
    expect(fillScore(q("서술형", 10), all)).toEqual({
      score: 10,
      basis: "없음",
    });
  });

  it("🔴 서술형이 비면 **다른 서술형**으로 메운다 (강동중 실측 모양)", () => {
    // 객관식 16문 3~4점, 서술형 4문 10점 — 그중 하나가 안 읽혔다.
    const all: ScoredQuestion[] = [
      ...Array.from({ length: 16 }, () => q("객관식", 3.75)),
      q("서술형", 10),
      q("서술형", 10),
      q("서술형", 10),
      q("서술형", null),
    ];
    const filled = fillScore(q("서술형", null), all);
    expect(filled.score).toBe(10);
    expect(filled.basis).toBe("같은유형");

    // 총점이 정확히 100 으로 복원된다 — 예전 규칙이면 3.75 가 들어가 93.75 였다.
    const total = 16 * 3.75 + 10 * 3 + filled.score!;
    expect(total).toBe(100);
  });

  it("그 유형에 읽힌 배점이 하나도 없으면 편 전체로 떨어진다", () => {
    const all = [q("객관식", 4), q("객관식", 4), q("서술형", null)];
    expect(fillScore(q("서술형", null), all)).toEqual({
      score: 4,
      basis: "편전체",
    });
  });

  it("🔴 시험지에 배점이 하나도 안 읽혔으면 지어내지 않는다", () => {
    const all = [q("객관식", null), q("서술형", null)];
    expect(fillScore(q("객관식", null), all)).toEqual({
      score: null,
      basis: "없음",
    });
  });

  it("0 이나 음수는 '읽혔다'고 보지 않는다", () => {
    const all = [q("서술형", 0), q("서술형", -3), q("서술형", 8)];
    expect(fillScore(q("서술형", null), all).score).toBe(8);
  });
});

describe("[T7.18] 본문에 남은 배점 표기", () => {
  it("🔴 `[합 10점]`이 본문에 있으면 그 값을 쓴다 — 추정보다 실제 값이 먼저다", () => {
    const all = [q("객관식", 3), q("서술형", null)];
    const filled = fillScore(
      { qtype: "서술형", score: null, text: "다음을 구하시오. [합 10점]" },
      all,
    );
    expect(filled.score).toBe(10);
    expect(filled.basis).toBe("본문표기");
  });

  it("`[총 9 점]` 처럼 띄어쓰기가 섞여도 읽는다 — 실측 표기가 그렇다", () => {
    expect(scoreFromText("... [총  9 점]")).toBe(9);
    expect(scoreFromText("... [ 합 8.5 점 ]")).toBe(8.5);
  });

  it("배점이 아닌 대괄호는 읽지 않는다", () => {
    expect(scoreFromText("[서술형 1] 다음을 구하시오")).toBeNull();
    expect(scoreFromText("[소단원] 이차함수")).toBeNull();
  });
});

describe("[T7.21] 🔴 하위 배점 오집 정정 — 표기가 증거다", () => {
  /**
   * 적대적 리뷰 후속 실측(15 §A.0): 본문에 `[합/총 N점]` 표기가 남은 87문항 중
   * 53문항은 기록 배점이 표기보다 **작다** — 추출기가 `합` 을 몰라 머리표 대신
   * 첫 소문항의 `[2점]` 을 집었기 때문이다(범물중 "추출 78점 / 원본 100점"의 경로).
   *
   * fillScore 의 "읽힌 값은 덮지 않는다" 원칙의 **예외**다. 표기가 같은 문항 안에
   * 있으면 기록 배점이 하위 소문항 것이라는 증거가 있으므로 표기로 정정한다.
   */
  it("기록 배점이 본문 표기보다 작으면 표기로 정정한다", () => {
    const all = [q("객관식", 4), q("서술형", 2)];
    const fixed = fillScore(
      {
        qtype: "서술형",
        score: 2, // 추출기가 집은 첫 소문항 배점
        text: "[서답형 2] 다음 물음에 답하시오. [합 10점] (1) …[2점] (2) …[8점]",
      },
      all,
    );
    expect(fixed.score).toBe(10);
    expect(fixed.basis).toBe("본문표기");
  });

  it("🔴 기록 배점이 표기와 같거나 크면 건드리지 않는다 — 증거 없는 정정은 안 한다", () => {
    // 발문에 [총 3점] 이 그대로 있고 배점도 3 으로 맞게 읽힌 경우.
    const same = fillScore(
      { qtype: "객관식", score: 3, text: "…의 값은? [총 3점]" },
      [],
    );
    expect(same.score).toBe(3);
    expect(same.basis).toBe("없음");
  });

  it("표기가 없으면 기존 동작 그대로다", () => {
    const kept = fillScore(
      { qtype: "객관식", score: 4, text: "다음을 구하시오." },
      [],
    );
    expect(kept).toEqual({ score: 4, basis: "없음" });
  });
});
