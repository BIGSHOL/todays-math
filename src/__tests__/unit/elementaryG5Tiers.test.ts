/**
 * 초5 `1-6-2` 난이도 4단 갈래 (D-71 파일럿).
 *
 * 참은 **찍힌 발문**에서 온다 — 생성기의 계산을 다시 부르지 않고, 발문에 있는 수로
 * 넓이·둘레를 **다시 계산**해 정답과 맞댄다. 생성기를 부르면 그 생성기가 틀릴 때
 * 같이 틀리므로 아무것도 증명하지 못한다.
 */
import { describe, expect, it } from "vitest";

import { ELEM_TIERS, type ElemTier } from "@/lib/elementary/difficulty";
import {
  elementaryUnits,
  generateElementaryProblem,
  supportedTiers,
} from "@/lib/elementary/generate";

const UNIT = elementaryUnits().find(
  (u) => u.grade === "초5" && u.section.startsWith("1-6-2"),
)!;

const SEEDS = [20260821, 7, 1234, 99991, 20260822, 555, 31337, 4242];

/** `$12$` 안의 수만 꺼낸다 — R1 을 지키면 발문의 수는 전부 KaTeX 안에 있다. */
function katexNumbers(text: string): number[] {
  return [...text.matchAll(/\$(\d+)\$/g)].map((m) => Number(m[1]));
}

function answerNumber(answer: string): number {
  expect(answer, `정답이 KaTeX 로 감싸이지 않았다: ${answer}`).toMatch(
    /^\$\d+\$$/,
  );
  return Number(answer.slice(1, -1));
}

/** KaTeX 밖에 남은 맨 숫자 — R1. */
function bareNumbers(text: string): string[] {
  return text.replace(/\$[^$]*\$/g, " ").match(/\d+/g) ?? [];
}

const problem = (tier: ElemTier, seed: number) =>
  generateElementaryProblem(UNIT, seed, tier);

/** 응용 — 둘레를 한 걸음 되짚어야 넓이가 선다. 발문의 수만으로 다시 계산한다. */
function checkApply(seed: number): void {
  const p = problem("응용", seed);
  const nums = katexNumbers(p.content);
  const answer = answerNumber(p.answer);
  if (p.content.includes("정사각형")) {
    const [per] = nums as [number];
    expect(per % 4, p.content).toBe(0);
    expect(answer, p.content).toBe((per / 4) * (per / 4));
    return;
  }
  const [per, w] = nums as [number, number];
  expect(per % 2, p.content).toBe(0);
  const h = per / 2 - w;
  expect(Number.isInteger(h) && h > 0, p.content).toBe(true);
  expect(h, `가로와 세로가 같으면 정사각형이다: ${p.content}`).not.toBe(w);
  expect(answer, p.content).toBe(w * h);
}

/** 심화 — 넓이 → 한 변 → 둘레 → 남은 변 → 넓이. 네 걸음이 실제로 서는지 본다. */
function checkDeep(seed: number): void {
  const p = problem("심화", seed);
  const [area, given] = katexNumbers(p.content) as [number, number];

  // ⚠️ 초5 는 제곱근이 없다 — 「넓이 → 한 변」이 곱셈구구로 서야 한다.
  const side = Math.round(Math.sqrt(area));
  expect(side * side, `완전제곱이 아니다: ${p.content}`).toBe(area);
  expect(side, `한 변이 곱셈구구 밖이다: ${side}`).toBeLessThanOrEqual(12);

  const half = side * 2; // 둘레 ÷ 2 = 가로 + 세로
  const other = half - given;
  expect(other > 0, `남은 변이 0 이하다: ${p.content}`).toBe(true);
  expect(other, `가로와 세로가 같으면 정사각형이다: ${p.content}`).not.toBe(
    given,
  );
  expect(answerNumber(p.answer), p.content).toBe(given * other);
}

describe("[초5 1-6-2] 난이도 4단 (D-71)", () => {
  it("넷이 전부 등록돼 있다", () => {
    expect(supportedTiers(UNIT)).toEqual(ELEM_TIERS);
  });

  it("같은 씨앗·같은 갈래면 같은 문항이다", () => {
    for (const tier of ELEM_TIERS) {
      const a = problem(tier, 11);
      const b = problem(tier, 11);
      expect(a.content, tier).toBe(b.content);
      expect(a.answer, tier).toBe(b.answer);
    }
  });

  it("같은 씨앗에서 네 갈래 발문이 서로 갈린다", () => {
    for (const seed of SEEDS) {
      const rows = ELEM_TIERS.map((t) => problem(t, seed).content);
      expect(new Set(rows).size, `씨앗 ${seed}\n${rows.join("\n")}`).toBe(4);
    }
  });

  it("갈래마다 씨앗에 반응한다 (R9)", () => {
    for (const tier of ELEM_TIERS) {
      const rows = new Set(SEEDS.map((s) => problem(tier, s).content));
      expect(rows.size, `${tier}\n${[...rows].join("\n")}`).toBeGreaterThan(1);
    }
  });

  // ⚠️ 위의 `> 1` 만으로는 **소재가 굳어도 통과한다** — 「정사각형/직사각형」이 갈리는 것만으로
  //    발문이 둘이 되기 때문이다. 변이(소재 고정)가 초록이라 드러났다. 소재를 직접 센다.
  it("기본 — 소재가 씨앗마다 갈린다 (「직사각형」한 낱말만 되풀이하지 않는다)", () => {
    const things = new Set<string>();
    for (let seed = 1; seed <= 60; seed += 1) {
      const hit = problem("기본", seed).content.match(/모양 (.+?)의 넓이/);
      expect(hit, problem("기본", seed).content).toBeTruthy();
      things.add(hit![1]!);
    }
    expect(things.size, `소재 ${[...things].join(" · ")}`).toBeGreaterThan(3);
  });

  it("모든 수가 KaTeX 안에 있다 (R1)", () => {
    const bad: string[] = [];
    for (const tier of ELEM_TIERS) {
      for (const seed of SEEDS) {
        const p = problem(tier, seed);
        for (const [where, text] of [
          ["발문", p.content],
          ["정답", p.answer],
          ["해설", p.solution],
        ] as const) {
          const loose = bareNumbers(text);
          if (loose.length)
            bad.push(`${tier} @${seed} ${where}: ${loose.join(",")} — ${text}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("연산 — 치수가 발문에 글로 있고 그림이 없다", () => {
    for (const seed of SEEDS) {
      const p = problem("연산", seed);
      expect(p.figureSpec, `씨앗 ${seed}`).toBeNull();
      const nums = katexNumbers(p.content);
      // 정사각형이면 한 변 하나, 직사각형이면 가로·세로 둘.
      if (p.content.includes("정사각형")) {
        expect(nums, p.content).toHaveLength(1);
        expect(answerNumber(p.answer), p.content).toBe(nums[0]! * nums[0]!);
      } else {
        expect(nums, p.content).toHaveLength(2);
        expect(answerNumber(p.answer), p.content).toBe(nums[0]! * nums[1]!);
      }
    }
  });

  it("기본 — 치수가 발문에 없고 그림이 그 값을 들고 있다", () => {
    for (const seed of SEEDS) {
      const p = problem("기본", seed);
      // 발문에 수가 있으면 「그림에서 읽는」 문항이 아니다.
      expect(katexNumbers(p.content), `씨앗 ${seed}: ${p.content}`).toEqual([]);
      const spec = p.figureSpec as {
        kind?: string;
        shape?: string;
        base?: number;
        height?: number;
      } | null;
      expect(spec?.kind, `씨앗 ${seed}`).toBe("areaPoly");
      expect(spec?.shape, `씨앗 ${seed}`).toBe("rect");
      expect(answerNumber(p.answer), p.content).toBe(
        spec!.base! * spec!.height!,
      );
      if (p.content.includes("정사각형")) expect(spec!.base).toBe(spec!.height);
      else expect(spec!.base).not.toBe(spec!.height);
    }
  });

  it("응용 — 둘레에서 변을 되찾아야 넓이가 선다", () => {
    for (const seed of SEEDS) checkApply(seed);
  });

  it("심화 — 넓이가 완전제곱이고 네 걸음이 실제로 선다", () => {
    for (const seed of SEEDS) checkDeep(seed);
  });

  /**
   * ⚠️ 위 두 검사는 **씨앗 여덟 개**만 본다. 응용의 직사각형 갈래는 그중 3번만 나오고,
   * 「세로 = 가로」 경계는 한 번도 안 밟힌다 — 필터를 지우는 변이가 **초록**이라 드러났다.
   * 경계를 밟게 하려면 표본을 넓히는 수밖에 없다.
   */
  it("응용·심화의 불변식은 씨앗 200개에서도 선다", () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      checkApply(seed);
      checkDeep(seed);
    }
  });

  it("해설이 걸음 순서대로이고 갈래마다 길이가 는다", () => {
    for (const seed of SEEDS) {
      const len = (t: ElemTier) => problem(t, seed).solution.length;
      expect(len("심화"), `씨앗 ${seed}`).toBeGreaterThan(len("응용"));
      expect(len("응용"), `씨앗 ${seed}`).toBeGreaterThan(len("연산"));
      // 심화 해설은 한 변 → 둘레 → 남은 변 → 넓이가 **그 차례로** 나와야 한다.
      const s = problem("심화", seed).solution;
      const order = ["한 변", "둘레", "합은", "넓이는"].map((k) =>
        s.indexOf(k),
      );
      expect(
        order.every((i) => i >= 0),
        s,
      ).toBe(true);
      expect(
        [...order].sort((a, b) => a - b),
        s,
      ).toEqual(order);
    }
  });

  it("네 갈래 모두 1-6-2 소단원을 그대로 단다", () => {
    for (const tier of ELEM_TIERS) {
      const p = problem(tier, 20260821);
      expect(p.section).toBe(UNIT.section);
      expect(p.orderIndex).toBe(UNIT.orderIndex);
      expect(p.content).toMatch(/직사각형|정사각형/);
      expect(p.content).toMatch(/넓이는 몇 cm²입니까\?$/);
    }
  });
});
