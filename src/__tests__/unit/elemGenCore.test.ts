/**
 * 초등 출제 CLI 의 알맹이 (scripts/elem/gen-core.ts).
 *
 * 지키는 것:
 * - 목록은 손으로 쓰지 않는다 — 커버리지는 엔진 등록부(handlerKeys)에서 유도된다.
 * - 프리셋 배분(D-71)은 합이 문항 수와 같고, 배분 산식이 재현 가능하다.
 * - 같은 씨앗 → 같은 세트 (재현), 한 세트 안에서는 중복 문항이 없다 (겹치면 던진다).
 * - 갈래 없는 소단원에 프리셋을 물으면 조용히 기본 문항을 내지 않고 던진다.
 */
import { describe, expect, it } from "vitest";

import { ELEM_TIERS, type ElemTier } from "../../lib/elementary/difficulty";
import {
  elementaryUnits,
  handlerKeys,
  supportedTiers,
} from "../../lib/elementary/generate";
import {
  allocateByPreset,
  findUnit,
  generateSet,
  listCoverage,
} from "../../../scripts/elem/gen-core";

describe("[초등 출제 CLI] 커버리지 목록", () => {
  it("커버리지는 엔진 등록부에서 유도된다 — 손 목록이 아니다", () => {
    const rows = listCoverage();
    const keys = new Set(handlerKeys());
    // 모든 행이 실제 생성기가 있는 대단원에 속한다
    for (const row of rows) {
      expect(
        keys.has(`${row.grade}|${row.chapter}`),
        `${row.grade} ${row.section}`,
      ).toBe(true);
    }
    // 독립 재셈: 등록된 대단원에 속한 소단원 수와 행 수가 같다
    const expected = elementaryUnits().filter((u) =>
      keys.has(`${u.grade}|${u.chapter}`),
    ).length;
    expect(rows.length).toBe(expected);
    expect(rows.length).toBeGreaterThan(0);
  });

  it("갈래 표시는 supportedTiers 와 일치한다", () => {
    for (const row of listCoverage()) {
      const unit = findUnit(row.grade, row.code);
      expect(row.tiers).toEqual(supportedTiers(unit));
    }
  });

  it("없는 소단원 코드는 던진다", () => {
    expect(() => findUnit("초4", "9-9-9")).toThrow(/9-9-9/);
  });
});

describe("[초등 출제 CLI] 프리셋 배분 (D-71 안A)", () => {
  it("하위반 8문항 — 최대 잔여법 손셈 그대로", () => {
    // 40/40/20/0 % 의 8문항: 3.2/3.2/1.6/0 → 바닥 3/3/1/0(=7) → 잔여 .2/.2/.6/0
    // → 남은 1을 잔여 최대인 응용에 → 3/3/2/0
    expect(allocateByPreset("하위반", 8)).toEqual({
      연산: 3,
      기본: 3,
      응용: 2,
      심화: 0,
    });
  });

  it("동률 잔여는 ELEM_TIERS 순서가 가른다 — 하위반 1문항은 연산", () => {
    // 0.4/0.4/0.2/0 전부 바닥 0 → 잔여 동률(연산·기본) → 선언 순서 앞인 연산이 받는다
    expect(allocateByPreset("하위반", 1)).toEqual({
      연산: 1,
      기본: 0,
      응용: 0,
      심화: 0,
    });
  });

  it("합은 항상 문항 수와 같다", () => {
    for (const preset of ["하위반", "중위반", "상위반"] as const) {
      for (const count of [1, 4, 8, 12, 25]) {
        const alloc = allocateByPreset(preset, count);
        const sum = ELEM_TIERS.reduce((a, t) => a + alloc[t], 0);
        expect(sum, `${preset} ${count}문항`).toBe(count);
      }
    }
  });

  it("0% 갈래는 0문항이다 — 하위반 심화·상위반 연산", () => {
    expect(allocateByPreset("하위반", 25).심화).toBe(0);
    expect(allocateByPreset("상위반", 25).연산).toBe(0);
  });
});

describe("[초등 출제 CLI] 세트 생성", () => {
  it("같은 씨앗은 같은 세트다 — 재현 가능", () => {
    const a = generateSet({
      grade: "초4",
      code: "1-5-1",
      count: 4,
      seed: 20260823,
    });
    const b = generateSet({
      grade: "초4",
      code: "1-5-1",
      count: 4,
      seed: 20260823,
    });
    expect(a).toEqual(b);
  });

  it("한 세트 안에 같은 문항이 없다 (발문+정답 열쇠)", () => {
    const items = generateSet({
      grade: "초4",
      code: "1-5-1",
      count: 6,
      seed: 20260823,
    });
    expect(items).toHaveLength(6);
    const keys = items.map((i) => `${i.problem.content}|${i.problem.answer}`);
    expect(new Set(keys).size).toBe(6);
  });

  it("갈래 없는 소단원에 프리셋을 물으면 던진다 — 조용히 기본 문항을 내지 않는다", () => {
    // 초4 1-5-3 은 아직 갈래 미등록 (파일럿은 초3 1-1-2 · 초5 1-6-2)
    expect(() =>
      generateSet({
        grade: "초4",
        code: "1-5-3",
        count: 4,
        seed: 1,
        preset: "중위반",
      }),
    ).toThrow(/갈래/);
  });

  it("tier 와 preset 을 같이 주면 던진다", () => {
    expect(() =>
      generateSet({
        grade: "초3",
        code: "1-1-2",
        count: 4,
        seed: 1,
        tier: "기본",
        preset: "중위반",
      }),
    ).toThrow();
  });

  it("파일럿 소단원의 프리셋 세트 — 갈래 구성이 배분과 같다", () => {
    const items = generateSet({
      grade: "초3",
      code: "1-1-2",
      count: 8,
      seed: 20260823,
      preset: "하위반",
    });
    const got: Record<string, number> = {};
    for (const item of items) {
      expect(item.tier).not.toBeNull();
      got[item.tier as ElemTier] = (got[item.tier as ElemTier] ?? 0) + 1;
      expect(item.problem.content.length).toBeGreaterThan(0);
      expect(item.problem.answer.length).toBeGreaterThan(0);
    }
    expect(got).toEqual({ 연산: 3, 기본: 3, 응용: 2 });
  });
});
