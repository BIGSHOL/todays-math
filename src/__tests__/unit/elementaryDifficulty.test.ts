/**
 * 초등 난이도 계약 (D-71) — 갈래가 채워지기 **전의** 행동을 잠근다.
 *
 * - 프리셋 수치의 참은 07 문서 D-71 행(원장님 확정)이다. 여기 리터럴은 그 문서에서
 *   옮겨 적은 것 — 제품 상수를 복사하면 제품이 틀릴수록 초록이 된다.
 * - tier 를 안 주면 예전과 완전히 같아야 한다(기존 관문 230×1,260 이 이 경로를 돈다).
 * - 미등록 소단원에 tier 를 물으면 던진다 — 조용히 기본 문항을 주면
 *   「심화를 냈다」는 시험지가 거짓말이 된다.
 */
import { describe, expect, it } from "vitest";

import {
  ELEM_TIERS,
  TIER_PRESETS,
  TIER_SALT,
  sectionCode,
  tierKey,
} from "@/lib/elementary/difficulty";
import {
  elementaryUnits,
  generateElementaryProblem,
  supportedTiers,
} from "@/lib/elementary/generate";

const UNITS = elementaryUnits();

describe("난이도 계약 (D-71)", () => {
  it("4단이고 순서는 연산→기본→응용→심화다", () => {
    expect([...ELEM_TIERS]).toEqual(["연산", "기본", "응용", "심화"]);
  });

  it("반 프리셋은 안A 그대로이고 각 반의 합이 100 이다", () => {
    // 참은 07 D-71 (원장님 확정 수치). 여기서 다르면 제품이 틀린 것이다.
    expect(TIER_PRESETS.하위반).toEqual({
      연산: 40,
      기본: 40,
      응용: 20,
      심화: 0,
    });
    expect(TIER_PRESETS.중위반).toEqual({
      연산: 15,
      기본: 40,
      응용: 30,
      심화: 15,
    });
    expect(TIER_PRESETS.상위반).toEqual({
      연산: 0,
      기본: 25,
      응용: 40,
      심화: 35,
    });
    for (const ratio of Object.values(TIER_PRESETS)) {
      expect(Object.values(ratio).reduce((a, b) => a + b, 0)).toBe(100);
    }
  });

  it("씨앗 소금은 갈래마다 다르다 — 겹치면 두 갈래가 같은 수를 낸다", () => {
    const salts = Object.values(TIER_SALT);
    expect(new Set(salts).size).toBe(salts.length);
  });

  it("소단원 키는 코드로 만든다 — 이름은 바뀔 수 있다", () => {
    expect(sectionCode({ section: "1-1-2 받아올림이 두 번" })).toBe("1-1-2");
    expect(tierKey({ grade: "초3", section: "1-1-2 받아올림이 두 번" })).toBe(
      "초3|1-1-2",
    );
  });

  it("tier 를 안 주면 결정적이고, tier 인자 추가가 기존 경로를 안 바꿨다", () => {
    const unit = UNITS.find(
      (u) => u.grade === "초3" && u.section.startsWith("1-1-2"),
    )!;
    const a = generateElementaryProblem(unit, 20260822);
    const b = generateElementaryProblem(unit, 20260822);
    expect(a.content).toBe(b.content);
    expect(a.answer).toBe(b.answer);
  });

  it("미등록 소단원에 tier 를 물으면 소단원·갈래를 말하며 던진다", () => {
    // 등록이 «없는» 소단원을 supportedTiers 로 찾는다 — 파일럿이 채워져도 이 시험은 산다.
    const bare = UNITS.find((u) => supportedTiers(u).length === 0);
    expect(
      bare,
      "전 소단원이 등록되면 이 시험을 «등록 후 계약»으로 바꿀 것",
    ).toBeDefined();
    expect(() =>
      generateElementaryProblem(bare!, 20260822, "심화"),
    ).toThrowError(/난이도 갈래가 없는 소단원/);
    expect(() =>
      generateElementaryProblem(bare!, 20260822, "심화"),
    ).toThrowError(new RegExp(bare!.grade));
  });

  it("supportedTiers 는 전부(4)이거나 없음(0)이다 — 일부 등록은 타입이 막는다", () => {
    for (const unit of UNITS) {
      const tiers = supportedTiers(unit);
      expect([0, 4]).toContain(tiers.length);
    }
  });

  it("등록된 파일럿은 갈래마다 문항이 나오고, 갈래끼리 발문이 갈린다", () => {
    // 지금은 0개(빈 맵)여도 초록이다 — g3·g5 가 채우면 자동으로 그 소단원을 검사한다.
    for (const unit of UNITS) {
      if (supportedTiers(unit).length === 0) continue;
      const byTier = ELEM_TIERS.map((tier) =>
        generateElementaryProblem(unit, 20260822, tier),
      );
      for (const p of byTier) {
        expect(p.content.trim()).not.toBe("");
        expect(p.answer.trim()).not.toBe("");
        expect(p.solution.trim()).not.toBe("");
      }
      // 네 갈래가 같은 발문이면 난이도가 이름뿐이다.
      expect(new Set(byTier.map((p) => p.content)).size).toBe(4);
    }
  });
});
