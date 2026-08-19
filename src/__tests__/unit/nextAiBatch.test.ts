/**
 * 남은 자리 뺄셈 — 틀리면 **같은 문항을 두 번 만든다.**
 *
 * 계획 269건 중 39건은 원본의 출제 형식이 비어 있고, 그 자리는 우리가 형식을
 * 정해서 만든다. 그래서 키가 정확히 안 맞는다. 되맞춤이 없으면 이미 만든 것이
 * «아직 안 만든 것»으로 남아 토큰을 두 배로 쓴다.
 */
import { describe, expect, it } from "vitest";

import { subtract } from "../../../scripts/qa/next-ai-batch";

const 자리 = (over: Partial<Parameters<typeof subtract>[0][number]> = {}) => ({
  unitId: "u1",
  unitName: "중2 부등식",
  difficulty: "mid",
  questionType: "객관식" as string | null,
  problemType: "개념",
  개수: 2,
  단원풀: 50,
  ...over,
});

describe("subtract — 이미 만든 것을 뺀다", () => {
  it("형식까지 맞으면 그 자리에서 뺀다", () => {
    const left = subtract(
      [자리()],
      [
        {
          unitId: "u1",
          difficulty: "mid",
          questionType: "객관식",
          problemType: "개념",
        },
      ],
    );
    expect(left[0]?.개수).toBe(1);
  });

  it("계획의 형식이 «빈 값»이어도 우리가 정한 형식으로 뺀다", () => {
    // 🔴 이 되맞춤이 없으면 39자리가 영원히 «안 만든 것»으로 남는다.
    const left = subtract(
      [자리({ questionType: null })],
      [
        {
          unitId: "u1",
          difficulty: "mid",
          questionType: "객관식",
          problemType: "개념",
        },
      ],
    );
    expect(left[0]?.개수).toBe(1);
  });

  it("형식이 «빈 값»이 아닌 자리는 형식이 다르면 안 뺀다", () => {
    // 되맞춤이 너무 헐거우면 «서술형 자리»를 객관식으로 채웠다고 잘못 읽는다.
    const left = subtract(
      [자리({ questionType: "서술형" })],
      [
        {
          unitId: "u1",
          difficulty: "mid",
          questionType: "객관식",
          problemType: "개념",
        },
      ],
    );
    expect(left[0]?.개수).toBe(2);
  });

  it("단원·난이도·유형이 다르면 안 뺀다", () => {
    const made = [
      {
        unitId: "u2",
        difficulty: "mid",
        questionType: "객관식",
        problemType: "개념",
      },
      {
        unitId: "u1",
        difficulty: "hard",
        questionType: "객관식",
        problemType: "개념",
      },
      {
        unitId: "u1",
        difficulty: "mid",
        questionType: "객관식",
        problemType: "계산",
      },
    ];
    expect(subtract([자리()], made)[0]?.개수).toBe(2);
  });

  it("다 채운 자리는 목록에서 사라진다", () => {
    const 한건 = {
      unitId: "u1",
      difficulty: "mid",
      questionType: "객관식",
      problemType: "개념",
    };
    expect(subtract([자리()], [한건, 한건])).toHaveLength(0);
  });
});
