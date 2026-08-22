/**
 * 초등 엔진 **전 교육과정 관문** — 「모든 소단원에서, 어떤 씨앗으로도 문항이 나오는가」.
 *
 * ## 왜 학년별 시험과 따로 두는가
 *
 * 학년별 시험은 «그 학년의 규칙»을 본다. 여기서 보는 것은 **분모**다 —
 * 소단원 하나가 특정 씨앗에서 조용히 못 나오면, 그 소단원은 시험지에서 **빠질 뿐**
 * 아무도 실패로 세지 않는다. 「N passed」는 N이 전부인지 말해 주지 않는다
 * (2026-08-19 「게이트는 통과 수가 아니라 분모를 먼저 지켜야 한다」).
 *
 * 실제로 이 시험을 세우자마자 초3 `1-1-2` 가 **씨앗의 0.55%** 에서 던지고 있었다
 * (`addWithCarries` 가 `a=799` 를 뽑으면 `b` 범위가 `[101, 100]` 으로 뒤집힌다).
 * 학년별 시험은 씨앗을 몇 개만 보므로 이 부류를 **구조적으로** 못 본다.
 *
 * ## 무엇을 반증 가능한 형태로 세는가
 *
 * - **던짐** — 그 씨앗에서 문항이 아예 안 나온다.
 * - **빈 칸** — 발문·정답·해설 중 하나라도 비었다. 지면에 빈 자리로 나간다.
 * - **씨앗 무반응** — 씨앗을 바꿔도 발문이 한 가지뿐이면 시험지가 매번 같다(R9).
 *
 * ⚠️ 씨앗 목록을 줄이지 말 것. **씨앗 수가 곧 이 관문의 분해능이다.**
 * 던짐 쓸기는 1,200개를 쓴다 — 위 결함을 「범위 뒤집힘 되살리기」 변이로 재 보니
 * 첫 히트가 **328번째 씨앗**이었다(발생률 ~0.2%/씨앗). 80개로는 그 변이가 초록이었다.
 */
import { describe, expect, it } from "vitest";

import {
  elementaryUnits,
  generateElementaryProblem,
} from "@/lib/elementary/generate";

/** 결정적이다 — 같은 목록을 늘 본다. 결함을 찾으면 그 씨앗이 그대로 재현된다. */
const SEEDS = Array.from({ length: 80 }, (_, i) => 20260821 + i * 7);
/** 던짐 쓸기 전용 — 문자열을 안 모으므로 촘촘해도 싸다. 위 헤더의 실측(328) 참조. */
const DENSE_SEEDS = Array.from({ length: 1200 }, (_, i) => 20260821 + i * 7);

type Failure = { where: string; why: string };

/** 전 소단원 × 전 씨앗을 한 번만 돌고, 세 가지 판정이 그 결과를 나눠 본다. */
const UNITS = elementaryUnits();
const threw: Failure[] = [];
const blank: Failure[] = [];
const stuck: Failure[] = [];

// 던짐 쓸기: 낮은 확률로만 밟히는 범위 결함(뒤집힌 intBetween 류)은 씨앗을
// 촘촘히 써야 보인다. 발문 내용은 안 본다 — 그건 아래 80개 쓸기의 몫이다.
for (const unit of UNITS) {
  for (const seed of DENSE_SEEDS) {
    try {
      generateElementaryProblem(unit, seed);
    } catch (error) {
      threw.push({
        where: `${unit.grade} ${unit.section}`,
        why: `씨앗 ${seed}: ${String((error as Error)?.message ?? error)}`,
      });
    }
  }
}

for (const unit of UNITS) {
  const where = `${unit.grade} ${unit.section}`;
  const contents = new Set<string>();
  for (const seed of SEEDS) {
    let problem;
    try {
      problem = generateElementaryProblem(unit, seed);
    } catch {
      // 던짐은 위 촘촘한 쓸기가 이미 셌다 (SEEDS ⊂ DENSE_SEEDS — 같은 식, 같은 걸음).
      continue;
    }
    if (
      !problem.content?.trim() ||
      !problem.answer?.trim() ||
      !problem.solution?.trim()
    ) {
      blank.push({
        where,
        why: `씨앗 ${seed}: 발문·정답·해설 중 빈 칸이 있다`,
      });
    }
    contents.add(problem.content);
  }
  if (contents.size <= 1) {
    stuck.push({
      where,
      why: `씨앗 ${SEEDS.length}개를 다 써도 발문이 ${contents.size}가지 — 시험지가 매번 같다`,
    });
  }
}

/** 실패를 다 보여 준다 — 첫 건만 찍으면 「하나 고쳤더니 또 하나」가 된다. */
function report(rows: Failure[]): string {
  const head = rows.slice(0, 12).map((r) => `  [${r.where}] ${r.why}`);
  const rest = rows.length > 12 ? [`  … 그 밖 ${rows.length - 12}건`] : [];
  return ["", ...head, ...rest].join("\n");
}

describe("초등 전 교육과정 — 모든 소단원에서 문항이 나온다", () => {
  it("분모부터 확인한다 — 소단원과 씨앗이 실제로 있다", () => {
    // 목록이 비면 아래 셋은 전부 «0건»이 되어 초록이다. 0 은 「깨끗하다」와
    // 「못 셌다」를 구분해 주지 않으므로, 분모를 먼저 못 박는다.
    expect(UNITS.length).toBeGreaterThanOrEqual(200);
    expect(SEEDS.length).toBeGreaterThanOrEqual(60);
    // 실측: 뒤집힘 변이의 첫 히트가 328번째 — 이보다 줄이면 그 부류가 안 보인다.
    expect(DENSE_SEEDS.length).toBeGreaterThanOrEqual(1200);
    expect(new Set(UNITS.map((u) => u.grade)).size).toBe(4);
  });

  it("어떤 씨앗에서도 던지지 않는다 (촘촘한 쓸기)", () => {
    expect(threw.length, `문항이 안 나오는 자리${report(threw)}`).toBe(0);
  });

  it("발문·정답·해설이 비지 않는다", () => {
    expect(blank.length, `빈 칸이 나가는 자리${report(blank)}`).toBe(0);
  });

  it("씨앗을 바꾸면 발문이 달라진다 (R9)", () => {
    expect(stuck.length, `씨앗에 반응하지 않는 자리${report(stuck)}`).toBe(0);
  });
});

describe("소단원 이름이 약속한 부류가 실제로 나온다", () => {
  it("초3 1-1-2 「받아올림이 두 번, 세 번」 — 세 번(합이 네 자리)이 나온다", () => {
    // 예전에는 `a + b < 1000` 으로 묶어 세 번 받아올림이 **구조적으로 0** 이었다.
    // 「두 번」과 「세 번」 둘 다 세어, 어느 한쪽이 0 이면 소단원 이름이 거짓말이 된다.
    const unit = UNITS.find(
      (u) => u.grade === "초3" && u.section.startsWith("1-1-2"),
    );
    expect(unit, "초3 1-1-2 소단원이 시드에 없다").toBeDefined();
    // 받아올림 수를 **발문에 찍힌 두 수**에서 다시 센다 — 참이 지면에서 온다.
    // (합이 네 자리인가로 가르면 일·백의 자리만 받아올리는 두 번짜리(805+306)가
    // 세 번으로 잘못 세어진다.)
    const carriesOf = (a: number, b: number): number => {
      let carries = 0;
      let c = 0;
      for (const div of [1, 10, 100]) {
        const s = (Math.floor(a / div) % 10) + (Math.floor(b / div) % 10) + c;
        c = s >= 10 ? 1 : 0;
        carries += c;
      }
      return carries;
    };
    const byCarries = new Map<number, number>();
    for (const seed of SEEDS) {
      const p = generateElementaryProblem(unit!, seed);
      const m = p.content.match(/\$(\d+)\+(\d+)=/);
      expect(m, `덧셈 발문 모양이 아니다: ${p.content}`).not.toBeNull();
      const k = carriesOf(Number(m![1]), Number(m![2]));
      byCarries.set(k, (byCarries.get(k) ?? 0) + 1);
    }
    // 소단원 밖의 부류(0·1번)가 섞이면 그것대로 결함이다.
    for (const [k, cnt] of byCarries) {
      expect(
        k >= 2 && k <= 3,
        `받아올림 ${k}번짜리가 ${cnt}건 — 이 소단원은 두 번·세 번만 담는다`,
      ).toBe(true);
    }
    expect(
      byCarries.get(2) ?? 0,
      "받아올림 두 번이 한 번도 안 나온다",
    ).toBeGreaterThan(0);
    expect(
      byCarries.get(3) ?? 0,
      "받아올림 세 번이 한 번도 안 나온다",
    ).toBeGreaterThan(0);
  });
});
