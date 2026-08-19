/**
 * **정답 표기가 갈리던 5건** — 행마다의 판단을 잠근다.
 *
 * 이 검사의 목적은 값 다섯 개를 지키는 게 아니라 **「일률 규칙을 쓰지 않았다」**를
 * 지키는 것이다. 「맨숫자는 늘 번호로 읽는다」로 바꾸면 정화여고 2번이 ④(=7)가 되어
 * 빨개진다. 「늘 값으로 읽는다」로 바꾸면 나머지 넷이 빨개진다.
 *
 * 근거는 HWP **미주**(본문 밖)다. 본문 안에서는 못 가른다 —
 * 보기가 숫자면 `"4"` 는 값으로도 번호로도 읽히기 때문이다.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readAnswerRef } from "../../../scripts/qa/answerChoiceRules";

interface LedgerRow {
  id: string;
  school: string;
  n: number;
  before: string;
  after: string;
  endnote: string;
  why: string;
}

const LEDGER = "scripts/qa/reports/ambiguous-answer-ledger.json";
const ledger = JSON.parse(readFileSync(LEDGER, "utf-8")) as {
  rows: LedgerRow[];
  적용됨: boolean;
};
const row = (school: string, n: number): LedgerRow => {
  const hit = ledger.rows.find((r) => r.school === school && r.n === n);
  if (!hit) throw new Error(`원장에 없다: ${school} ${n}`);
  return hit;
};

/** 확정한 정답과, 그때 지면에 서 있던 보기. */
const CASES = [
  {
    school: "정화여고",
    n: 2,
    bodies: ["$4$", "$5$", "$6$", "$7$", "$8$"],
    after: "①",
    reading: "값",
  },
  {
    school: "소선여중",
    n: 14,
    bodies: ["$2$", "$3$", "$4$", "$5$", "$6$"],
    after: "③",
    reading: "번호",
  },
  {
    school: "황금중",
    n: 5,
    bodies: ["$3$", "$4$", "$5$", "$6$", "$7$"],
    after: "⑤",
    reading: "번호",
  },
  {
    school: "성산고",
    n: 2,
    bodies: ["$3$", "$4$", "$5$", "$6$", "$7$"],
    after: "④",
    reading: "번호",
  },
  {
    school: "정화여고",
    n: 12,
    bodies: [
      "$\\frac{1}{3}$",
      "$\\frac{1}{2}$",
      "$\\frac{3}{2}$",
      "$3$",
      "$6$",
    ],
    after: "③",
    reading: "번호",
  },
] as const;

describe("정답 표기가 갈리던 5건 (원장님 위임 2026-08-19)", () => {
  it("원장이 적용됨으로 남아 있다 — 되돌릴 근거가 이 파일뿐이다", () => {
    expect(ledger.적용됨).toBe(true);
    expect(ledger.rows).toHaveLength(5);
    for (const r of ledger.rows) {
      expect(r.endnote.length).toBeGreaterThan(0); // 근거 없는 행이 없다
      expect(r.why.length).toBeGreaterThan(10); // 이유 없는 행이 없다
    }
  });

  for (const c of CASES) {
    it(`${c.school} ${c.n}번 — 미주가 ${c.after} 이므로 «${c.reading}» 읽기`, () => {
      const r = row(c.school, c.n);
      expect(r.after).toBe(c.after);
      // 확정한 정답은 **번호로 또렷이 읽힌다** — 더는 모호하지 않다.
      const ref = readAnswerRef(r.after, c.bodies, [1, 2, 3, 4, 5]);
      expect(ref.basis).toBe("원문자");
      expect(ref.nums).toHaveLength(1);
    });
  }

  it("🔴 **한 방향이 아니다** — 일률 규칙을 세우면 반드시 하나는 틀린다", () => {
    // 고치기 전 값(`before`)을 «늘 번호» 로 읽으면 정화여고 2번이 틀린다.
    const 정화2 = row("정화여고", 2);
    expect(정화2.before).toBe("4");
    expect(정화2.after).toBe("①"); // 번호로 읽었다면 ④ 였다

    // 반대로 «늘 값» 으로 읽으면 나머지 넷이 틀린다.
    const 황금5 = row("황금중", 5);
    expect(황금5.before).toBe("5");
    expect(황금5.after).toBe("⑤"); // 값으로 읽었다면 ③(=5) 이었다

    const 값읽기 = ledger.rows.filter((r) =>
      r.why.includes("**①번 보기의 값**"),
    );
    const 번호읽기 = ledger.rows.filter((r) => r.why.includes("**번호**"));
    expect(값읽기).toHaveLength(1);
    expect(번호읽기).toHaveLength(4);
  });
});
