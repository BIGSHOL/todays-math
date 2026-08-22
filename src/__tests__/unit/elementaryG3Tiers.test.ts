/**
 * 초3 난이도 갈래 파일럿 (D-71) — `1-1-2 받아올림이 두 번, 세 번 있는 (세 자리 수)+(세 자리 수)`.
 *
 * **참은 발문에서 온다.** 생성기의 계산을 다시 부르지 않고, 지면에 실제로 찍히는 수를
 * 정규식으로 뽑아 여기서 다시 계산한다 — 생성기가 틀려도 이 검사는 안 따라 틀린다.
 * 받아올림 세는 것도 여기 다시 적는다(제품 함수를 부르면 동어반복이 된다).
 */
import { describe, expect, it } from "vitest";

import { ELEM_TIERS, type ElemTier } from "@/lib/elementary/difficulty";
import {
  elementaryUnits,
  generateElementaryProblem,
  supportedTiers,
} from "@/lib/elementary/generate";

const UNIT = elementaryUnits().find(
  (u) => u.grade === "초3" && u.section.startsWith("1-1-2"),
)!;

const SEEDS = [
  20260821, 7, 1234, 99991, 20260822, 555, 31337, 4242, 1, 2, 3, 88,
];

/**
 * KaTeX 안에 찍힌 수를 **나온 순서대로** 뽑는다.
 * 한 덩어리에 여럿일 수 있다(`$578+132=\square$` → `[578, 132]`).
 */
function nums(text: string): number[] {
  return [...text.matchAll(/\$([^$]*)\$/g)].flatMap((m) =>
    [...m[1]!.matchAll(/\d+/g)].map((d) => Number(d[0])),
  );
}

function answerOf(answer: string): number {
  expect(answer, `정답이 KaTeX 로 안 감싸졌다: ${answer}`).toMatch(/^\$\d+\$$/);
  return Number(answer.slice(1, -1));
}

/** 받아올림 횟수 — 일→십 · 십→백 · **백→천**. 세 자리를 다 센다. */
function carries(a: number, b: number): number {
  let count = 0;
  let carry = 0;
  for (let place = 1; place <= 100; place *= 10) {
    const sum =
      (Math.floor(a / place) % 10) + (Math.floor(b / place) % 10) + carry;
    carry = sum >= 10 ? 1 : 0;
    count += carry;
  }
  return count;
}

/** 이 갈래가 실제로 시키는 덧셈들 — `[[더할 수, 더할 수], …]`. 발문·해설의 수로만 만든다. */
function additionsOf(
  tier: ElemTier,
  content: string,
  answer: string,
): [number, number][] {
  const v = nums(content);
  if (tier === "연산" || tier === "기본") {
    expect(v.length, `${tier} 발문의 수가 둘이 아니다: ${content}`).toBe(2);
    return [[v[0]!, v[1]!]];
  }
  if (tier === "응용") {
    expect(v.length, `응용 발문의 수가 둘이 아니다: ${content}`).toBe(2);
    const [base, more] = v as [number, number];
    return [
      [base, more],
      [base, base + more],
    ];
  }
  // 심화 — 어떤 수는 잘못된 합에서 되짚어 구한다.
  expect(v.length, `심화 발문의 수가 셋이 아니다: ${content}`).toBe(3);
  const [right, wrong, wrongSum] = v as [number, number, number];
  const some = wrongSum - wrong;
  return [
    [some, wrong],
    [some, right],
  ];
  void answer;
}

describe("[초3 난이도] 1-1-2 네 갈래", () => {
  it("소단원이 네 갈래를 전부 낸다", () => {
    expect(supportedTiers(UNIT)).toEqual(ELEM_TIERS);
  });

  it("같은 씨앗·같은 갈래면 같은 문항이다", () => {
    for (const tier of ELEM_TIERS) {
      const a = generateElementaryProblem(UNIT, 11, tier);
      const b = generateElementaryProblem(UNIT, 11, tier);
      expect(a.content, tier).toBe(b.content);
      expect(a.answer, tier).toBe(b.answer);
      expect(a.solution, tier).toBe(b.solution);
    }
  });

  it("정답은 발문의 수로 다시 계산한 값과 같다", () => {
    for (const tier of ELEM_TIERS) {
      for (const seed of SEEDS) {
        const p = generateElementaryProblem(UNIT, seed, tier);
        const where = `${tier} seed ${seed}: ${p.content}`;
        const adds = additionsOf(tier, p.content, p.answer);
        // 마지막 덧셈의 합이 곧 답이다 — 갈래마다 단계 수는 달라도 이건 같다.
        const last = adds[adds.length - 1]!;
        expect(answerOf(p.answer), where).toBe(last[0] + last[1]);
      }
    }
  });

  it("심화는 잘못 더한 수가 바른 수의 자릿수를 맞바꾼 것이고, 되짚기가 성립한다", () => {
    for (const seed of SEEDS) {
      const p = generateElementaryProblem(UNIT, seed, "심화");
      const [right, wrong, wrongSum] = nums(p.content) as [
        number,
        number,
        number,
      ];
      const where = `seed ${seed}: ${p.content}`;
      expect(wrong, where).not.toBe(right);
      // 자릿수를 맞바꿨으므로 숫자 구성이 같다 — 「그럴듯한 실수」의 정의다.
      const digitsOf = (v: number) => String(v).split("").sort().join("");
      expect(digitsOf(wrong), where).toBe(digitsOf(right));
      const some = wrongSum - wrong;
      expect(
        some,
        `어떤 수가 세 자리가 아니다 — ${where}`,
      ).toBeGreaterThanOrEqual(100);
      expect(some, where).toBeLessThanOrEqual(999);
      expect(answerOf(p.answer), where).toBe(some + right);
      // 잘못된 합도 학생이 뺄셈할 수 있는 세 자리여야 한다.
      expect(wrongSum, where).toBeLessThanOrEqual(999);
    }
  });

  it("모든 갈래의 모든 덧셈이 (세 자리)+(세 자리)이고 받아올림이 두 번 이상이다", () => {
    const bad: string[] = [];
    for (const tier of ELEM_TIERS) {
      for (const seed of SEEDS) {
        const p = generateElementaryProblem(UNIT, seed, tier);
        for (const [a, b] of additionsOf(tier, p.content, p.answer)) {
          if (a < 100 || a > 999 || b < 100 || b > 999) {
            bad.push(`${tier} seed ${seed}: ${a}+${b} — 세 자리가 아니다`);
          }
          if (carries(a, b) < 2) {
            bad.push(
              `${tier} seed ${seed}: ${a}+${b} — 받아올림 ${carries(a, b)}번`,
            );
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("소단원 이름이 약속한 「세 번」이 실제로 나온다", () => {
    // 「두 번, 세 번」은 나열이라 매번 세 번일 필요는 없지만, **한 번도 안 나오면**
    // 그 낱말이 구조적으로 0인 것이다 — 예전 `addWithCarries` 가 그랬다.
    const three = new Set<ElemTier>();
    for (const tier of ELEM_TIERS) {
      for (let seed = 0; seed < 120; seed += 1) {
        const p = generateElementaryProblem(UNIT, seed, tier);
        for (const [a, b] of additionsOf(tier, p.content, p.answer)) {
          if (carries(a, b) === 3) three.add(tier);
        }
      }
    }
    expect([...three].sort()).toEqual([...ELEM_TIERS].sort());
  });

  it("씨앗을 바꾸면 갈래마다 문항이 바뀐다", () => {
    for (const tier of ELEM_TIERS) {
      const seen = new Set(
        SEEDS.map((s) => generateElementaryProblem(UNIT, s, tier).content),
      );
      expect(seen.size, `${tier} 가 씨앗에 반응하지 않는다`).toBe(SEEDS.length);
    }
  });

  it("네 갈래 발문이 서로 갈린다 — 문장 틀도 다르다", () => {
    for (const seed of SEEDS) {
      const made = ELEM_TIERS.map((t) =>
        generateElementaryProblem(UNIT, seed, t),
      );
      expect(new Set(made.map((p) => p.content)).size, `seed ${seed}`).toBe(4);
      // 수를 지운 «틀»까지 달라야 한다 — 숫자만 다른 네 갈래는 갈래가 아니다.
      const stems = made.map((p) => p.content.replace(/\$[^$]*\$/g, "#"));
      expect(new Set(stems).size, `seed ${seed}: ${stems.join(" | ")}`).toBe(4);
    }
  });

  it("소재가 한 가지로 굳지 않는다", () => {
    // 원장님: 「유형은 다양할수록 환영」. 문장 갈래는 소재 풀에서 뽑는다.
    for (const tier of ["기본", "응용"] as const) {
      const stems = new Set<string>();
      for (let seed = 0; seed < 120; seed += 1) {
        stems.add(
          generateElementaryProblem(UNIT, seed, tier).content.replace(
            /\$[^$]*\$/g,
            "#",
          ),
        );
      }
      expect(stems.size, `${tier} 소재 틀`).toBeGreaterThanOrEqual(5);
    }
  });

  it("모든 갈래의 수가 KaTeX 안에 있다", () => {
    for (const tier of ELEM_TIERS) {
      for (const seed of SEEDS) {
        const p = generateElementaryProblem(UNIT, seed, tier);
        for (const [label, text] of [
          ["발문", p.content],
          ["정답", p.answer],
          ["해설", p.solution],
        ] as const) {
          const outside = text.replace(/\$[^$]*\$/g, " ").match(/\d+/g);
          expect(outside, `${tier} seed ${seed} ${label}: ${text}`).toBeNull();
        }
      }
    }
  });

  it("해설이 단계를 그대로 보여 준다", () => {
    for (const seed of SEEDS) {
      const two = generateElementaryProblem(UNIT, seed, "응용");
      const [base, more] = nums(two.content) as [number, number];
      // 중간값과 최종값이 둘 다 해설에 식으로 적혀 있어야 한다.
      expect(two.solution, `응용 seed ${seed}`).toContain(
        `${base}+${more}=${base + more}`,
      );
      expect(two.solution, `응용 seed ${seed}`).toContain(
        `${base}+${base + more}=${base + (base + more)}`,
      );

      const deep = generateElementaryProblem(UNIT, seed, "심화");
      const [right, wrong, wrongSum] = nums(deep.content) as [
        number,
        number,
        number,
      ];
      expect(deep.solution, `심화 seed ${seed}`).toContain(
        `${wrongSum}-${wrong}=${wrongSum - wrong}`,
      );
      expect(deep.solution, `심화 seed ${seed}`).toContain(
        `${wrongSum - wrong}+${right}=${wrongSum - wrong + right}`,
      );
    }
  });

  it("갈래를 안 주면 예전 문항 그대로다", () => {
    const plain = generateElementaryProblem(UNIT, 20260821);
    const tiered = generateElementaryProblem(UNIT, 20260821, "연산");
    // 모양은 같아도 소금이 달라 수가 갈린다 — 갈래가 기존 경로를 덮어쓰지 않는다.
    expect(plain.content).toMatch(/^다음을 계산하시오\./);
    expect(tiered.content).not.toBe(plain.content);
  });
});
