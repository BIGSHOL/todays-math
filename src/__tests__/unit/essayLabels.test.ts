/**
 * 서술형 지면 순번 (원장님 지시: "문제 배치될 때 알아서 스마트하게 [서술형 n]").
 *
 * 본문에 박혀 있던 `[서술형 3]` 을 뗐으니 그 자리를 **조판이** 채워야 한다.
 * 여기서 매기는 번호는 **이 시험지에서의 순번**이지 원본 시험지의 번호가 아니다 —
 * 원본 번호는 새 시험지에서 아무 뜻이 없다.
 */
import { describe, expect, it } from "vitest";

import type { TestPrintProblem } from "@/components/print/types";
import { assignEssayLabels } from "@/lib/tests/essayLabels";

function problem(id: string, questionType: string | null): TestPrintProblem {
  return {
    id,
    orderIndex: 0,
    content: "본문",
    answer: "1",
    solution: null,
    questionType,
  };
}

describe("[assignEssayLabels] 서술형 지면 순번", () => {
  it("서술형에만 번호를 매기고 배치 순서대로 1부터 센다", () => {
    const labels = assignEssayLabels([
      problem("a", "객관식"),
      problem("b", "서술형"),
      problem("c", "단답형"),
      problem("d", "서술형"),
    ]);
    expect(labels.get("b")).toBe(1);
    expect(labels.get("d")).toBe(2);
    expect(labels.has("a")).toBe(false);
    expect(labels.has("c")).toBe(false);
  });

  it("원본 시험지 번호가 아니라 이 시험지의 순번이다", () => {
    // 원본에서 [서술형 7] 이었어도 이 시험지에서 첫 서술형이면 1 이다.
    const labels = assignEssayLabels([problem("only", "서술형")]);
    expect(labels.get("only")).toBe(1);
  });

  it("서술형이 없으면 아무 번호도 매기지 않는다", () => {
    expect(assignEssayLabels([problem("a", "객관식")]).size).toBe(0);
  });

  it("questionType 이 비어 있으면 매기지 않는다 — 모르는 것을 서술형이라 하지 않는다", () => {
    // 라벨을 떼면서 유형 정보는 questionType 으로만 남는다. 그 값이 없으면
    // 서술형이라고 **단정하지 않는다**(틀린 표시가 표시 없음보다 나쁘다).
    expect(assignEssayLabels([problem("a", null)]).size).toBe(0);
    expect(assignEssayLabels([problem("a", undefined as never)]).size).toBe(0);
  });

  it("문항이 없으면 빈 결과", () => {
    expect(assignEssayLabels([]).size).toBe(0);
  });
});
