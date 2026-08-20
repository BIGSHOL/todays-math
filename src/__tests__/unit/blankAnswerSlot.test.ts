import { describe, expect, it } from "vitest";

import { findBlankAnswerSlots } from "@/lib/math/blankAnswerSlot";

describe("[blankAnswerSlot] 기입 칸 자리", () => {
  it("각·꼭짓점·변 빈칸을 세 자리로 잡는다", () => {
    const text =
      "그림을 보고 각, 꼭짓점, 변을 쓰세요. 각 (　　) 각의 꼭짓점 (　　) 각의 변 (　　)";
    const slots = findBlankAnswerSlots(text);
    expect(slots).toHaveLength(3);
    expect(text.slice(slots[0]!.index, slots[0]!.index + slots[0]!.length)).toBe(
      "각 (　　)",
    );
    expect(text.slice(slots[1]!.index, slots[1]!.index + slots[1]!.length)).toBe(
      "각의 꼭짓점 (　　)",
    );
    expect(text.slice(slots[2]!.index, slots[2]!.index + slots[2]!.length)).toBe(
      "각의 변 (　　)",
    );
  });

  it("빈칸이 하나면 나누지 않는다 — 문장 속 빈칸이다", () => {
    expect(findBlankAnswerSlots("빈칸 (　　) 에 알맞은 수를 쓰세요.")).toEqual(
      [],
    );
  });

  it("각 (가) 처럼 칸이 비어 있지 않으면 잡지 않는다", () => {
    expect(
      findBlankAnswerSlots("다음 각 (가) 와 각 (나) 의 크기를 구하시오."),
    ).toEqual([]);
  });

  it("수식 안의 괄호는 보지 않는다", () => {
    expect(
      findBlankAnswerSlots("값 $f(  )$ 와 $g(  )$ 를 구하시오."),
    ).toEqual([]);
  });
});
