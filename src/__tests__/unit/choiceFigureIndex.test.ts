/**
 * 🟢 회귀 가드 — `choiceFigureIndex` 규약.
 *
 * 이 가드가 지키는 것은 성능도 편의도 아니고 **「모를 때 어느 쪽으로 받는가」** 하나다.
 *
 * 원장님 확정(2026-08-18)과 함께 못 박힌 것:
 *   빈 배열은 «짝을 모른다»이고, 모르면 지면은 **오늘 그대로** 그린다.
 *   빈 배열이 「아무 그림이나 ①에 붙여도 된다」로 미끄러지면 안 된다 —
 *   지금은 못 푸는 문항이 못 푸는 채로 보이지만, **틀린 짝은 그럴듯해 보이면서
 *   틀린다.** 그건 지금보다 나쁘다.
 *
 * 그래서 아래 테스트는 「되는 것」보다 **「안 되는 것이 확실히 안 되는지」**를 더 센다.
 */
import { describe, expect, it } from "vitest";

import {
  checkChoiceFigureIndex,
  hasChoiceFigureLinks,
  parseChoiceFigureIndex,
} from "@/lib/problem/choiceFigureIndex";

describe("아는 경우", () => {
  it("발문 없이 보기 다섯 — 실측 52건의 모양", () => {
    expect(parseChoiceFigureIndex(5, [1, 2, 3, 4, 5])).toEqual([
      { kind: "choice", number: 1 },
      { kind: "choice", number: 2 },
      { kind: "choice", number: 3 },
      { kind: "choice", number: 4 },
      { kind: "choice", number: 5 },
    ]);
  });

  it("첫 장이 발문 + 보기 다섯 — 실측 44건의 모양", () => {
    const parsed = parseChoiceFigureIndex(6, [0, 1, 2, 3, 4, 5]);
    expect(parsed[0]).toEqual({ kind: "stem" });
    expect(parsed[5]).toEqual({ kind: "choice", number: 5 });
  });

  it("보기 하나가 글자라 그림이 넷 — 실측 1건(팔달중 10번)의 모양", () => {
    expect(hasChoiceFigureLinks(4, [1, 2, 3, 4])).toBe(true);
  });

  it("발문 그림은 여럿이어도 된다", () => {
    expect(hasChoiceFigureLinks(7, [0, 0, 1, 2, 3, 4, 5])).toBe(true);
  });
});

describe("🔴 모를 때 — 전부 null 로 받는다. 반쪽은 없다", () => {
  it("빈 배열은 «모른다» 다 (기본값)", () => {
    expect(parseChoiceFigureIndex(5, [])).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(checkChoiceFigureIndex(5, []).reason).toBe("모른다");
    expect(hasChoiceFigureLinks(5, [])).toBe(false);
  });

  it("null·undefined 도 «모른다» 다", () => {
    expect(hasChoiceFigureLinks(5, null)).toBe(false);
    expect(hasChoiceFigureLinks(5, undefined)).toBe(false);
  });

  it("길이가 다르면 **통째로** 모른다 — 앞의 넷만 쓰지 않는다", () => {
    expect(parseChoiceFigureIndex(5, [1, 2, 3, 4])).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(hasChoiceFigureLinks(5, [1, 2, 3, 4, 5, 6])).toBe(false);
  });

  it("🔴 0 이 아닌 번호가 **겹치면** 통째로 모른다", () => {
    // 그림 둘이 같은 ③을 주장한다 = 짝짓기가 무너졌다. 하나만 그리면
    // **틀린 짝이 조용히 지면에 나간다.**
    expect(hasChoiceFigureLinks(5, [1, 2, 3, 3, 5])).toBe(false);
    expect(
      parseChoiceFigureIndex(5, [1, 2, 3, 3, 5]).every((x) => x === null),
    ).toBe(true);
  });

  it("값이 범위 밖이면 통째로 모른다", () => {
    expect(hasChoiceFigureLinks(3, [1, 2, 11])).toBe(false);
    expect(hasChoiceFigureLinks(3, [1, 2, -1])).toBe(false);
    expect(hasChoiceFigureLinks(3, [1, 2, 1.5])).toBe(false);
  });

  it("그림이 없으면 빈 배열이다 (물어볼 것이 없다)", () => {
    expect(parseChoiceFigureIndex(0, [])).toEqual([]);
    expect(parseChoiceFigureIndex(0, [1, 2])).toEqual([]);
  });
});

describe("사유를 구분해 낸다 — «아직 없는 것»과 «틀린 것»은 다르다", () => {
  it("빈 배열의 사유는 «모른다» 로 따로 나온다", () => {
    expect(checkChoiceFigureIndex(5, []).reason).toBe("모른다");
  });

  it("깨진 값은 무엇이 깨졌는지 말한다", () => {
    expect(checkChoiceFigureIndex(5, [1, 2, 3, 4]).reason).toContain(
      "길이가 다르다",
    );
    expect(checkChoiceFigureIndex(5, [1, 2, 3, 3, 5]).reason).toContain(
      "둘 이상",
    );
    expect(checkChoiceFigureIndex(3, [1, 2, 99]).reason).toContain("범위 밖");
  });
});
