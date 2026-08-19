/**
 * 지면 유형 표시 (원장님 지시: "문제 배치될 때 알아서 스마트하게 [서술형 n]").
 *
 * 본문에 박혀 있던 `[서술형 3]` 을 뗐으니 그 자리를 **조판이** 채워야 한다.
 * 여기서 매기는 번호는 **이 시험지에서의 순번**이지 원본 시험지의 번호가 아니다 —
 * 원본 번호는 새 시험지에서 아무 뜻이 없다.
 *
 * 2026-08-19 원장님 확정: 원본 시험지의 `서답형` 은 **서술형으로 합치고**
 * `단답형` 은 **그대로 둔다.** 그래서 지면 표시가 둘이 됐다.
 */
import { describe, expect, it } from "vitest";

import type { TestPrintProblem } from "@/components/print/types";
import { assignSubjectiveLabels } from "@/lib/tests/essayLabels";

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

describe("[assignSubjectiveLabels] 지면 유형 표시", () => {
  it("서술형에 배치 순서대로 1부터 매기고 객관식은 건너뛴다", () => {
    const labels = assignSubjectiveLabels([
      problem("a", "객관식"),
      problem("b", "서술형"),
      problem("c", "서술형"),
    ]);
    expect(labels.get("b")).toEqual({ kind: "서술형", n: 1 });
    expect(labels.get("c")).toEqual({ kind: "서술형", n: 2 });
    expect(labels.has("a")).toBe(false);
  });

  // 원장님 확정: 「[단답형 출제]시에 [단답형]으로」.
  it("단답형에는 «단답형» 이라 찍는다 — 서술형으로 뭉개지 않는다", () => {
    const labels = assignSubjectiveLabels([problem("a", "단답형")]);
    expect(labels.get("a")).toEqual({ kind: "단답형", n: 1 });
  });

  // 🔴 한 통으로 세면 각 표시의 번호가 건너뛴다 — 학생이 「단답형 1」을 찾는다.
  it("⭐ 유형마다 **따로** 센다", () => {
    const labels = assignSubjectiveLabels([
      problem("a", "서술형"),
      problem("b", "단답형"),
      problem("c", "서술형"),
      problem("d", "단답형"),
    ]);
    expect(labels.get("a")).toEqual({ kind: "서술형", n: 1 });
    expect(labels.get("c")).toEqual({ kind: "서술형", n: 2 });
    expect(labels.get("b")).toEqual({ kind: "단답형", n: 1 });
    expect(labels.get("d")).toEqual({ kind: "단답형", n: 2 });
  });

  it("원본 시험지 번호가 아니라 이 시험지의 순번이다", () => {
    // 원본에서 [서술형 7] 이었어도 이 시험지에서 첫 서술형이면 1 이다.
    expect(
      assignSubjectiveLabels([problem("only", "서술형")]).get("only"),
    ).toEqual({ kind: "서술형", n: 1 });
  });

  it("표시할 유형이 없으면 아무 번호도 매기지 않는다", () => {
    expect(assignSubjectiveLabels([problem("a", "객관식")]).size).toBe(0);
  });

  it("questionType 이 비어 있으면 매기지 않는다 — 모르는 것을 서술형이라 하지 않는다", () => {
    // 라벨을 떼면서 유형 정보는 questionType 으로만 남는다. 그 값이 없으면
    // 서술형이라고 **단정하지 않는다**(틀린 표시가 표시 없음보다 나쁘다).
    expect(assignSubjectiveLabels([problem("a", null)]).size).toBe(0);
    expect(
      assignSubjectiveLabels([problem("a", undefined as never)]).size,
    ).toBe(0);
  });

  // 「서답형」은 이 컬럼에 오지 않는다(적재가 이미 서술형으로 합쳤다). 혹시 와도
  // **모르는 값은 표시하지 않는다** — 지면에 처음 보는 말이 찍히면 안 된다.
  it("모르는 유형은 표시하지 않는다", () => {
    expect(assignSubjectiveLabels([problem("a", "서답형")]).size).toBe(0);
  });

  it("문항이 없으면 빈 결과", () => {
    expect(assignSubjectiveLabels([]).size).toBe(0);
  });
});
