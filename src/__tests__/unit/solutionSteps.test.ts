/**
 * 🔴 RED → 🟢 — 해설 줄 나누기 (원장님 검수 지적 2026-08-21).
 *
 * 해설이 화면에서 **한 줄 벽**으로 나온다 — HWP 추출이 해설의 줄 구조를 잃어
 * DB 에 개행이 없기 때문이다. 데이터는 손대지 않고 **표시할 때** 잃어버린
 * 경계를 되찾는다. 구현: src/lib/solutionSteps.ts
 *
 * 열쇠 (실데이터에서 눈으로 확인한 것):
 *  · `…$` 바로 뒤에 `$…` 가 붙는 자리(`$$` 경계)는 원본에서 줄이 갈리던 자리다 —
 *    보통 글은 수식 사이에 낱말이 있다. (J30602-VMC9 실측)
 *  · 소문항 표지 ⑴⑵…, ∴·따라서·그러므로 앞도 새 줄이다.
 *  · 한글 문장 끝(`다.`·`시오.`) 뒤도 새 줄이다 — `$3.5$` 같은 소수점은
 *    한글이 아니라 안 걸린다.
 *  · **수식(`$…$`) 안에서는 절대 자르지 않는다.**
 */
import { describe, expect, it } from "vitest";

import { splitSolutionSteps } from "@/lib/solutionSteps";

// J30602-VMC9 의 실제 해설 (rm 수리 뒤 DB 값 그대로)
const VMC9 =
  "$18$$\\mathrm{\\angle }PAO=\\angle PBO=90°$피타고라스의 정리에 의하여 $\\mathrm{\\overline{AO}}=3$$\\mathrm{\\triangle }PAO=\\triangle PBO$ ($\\mathrm{RHS}$ 합동)$□\\mathrm{AOBP}$의 둘레의 길이는 $3+3+6+6 = 18$";

describe("splitSolutionSteps — 해설 줄 나누기", () => {
  it("인접한 수식 경계($$)에서 줄을 가른다 — VMC9 실데이터", () => {
    const steps = splitSolutionSteps(VMC9);
    expect(steps.length).toBeGreaterThanOrEqual(3);
    expect(steps[0]).toBe("$18$");
    // 어느 줄도 수식이 반 토막 나면 안 된다 — $ 개수가 줄마다 짝수여야 한다
    for (const s of steps) {
      expect((s.match(/\$/g) ?? []).length % 2).toBe(0);
    }
    // 내용은 하나도 잃지 않는다 (공백 무시)
    expect(steps.join("").replace(/\s/g, "")).toBe(VMC9.replace(/\s/g, ""));
  });

  it("수식 안의 소수점·기호에서는 자르지 않는다", () => {
    const s = "넓이가 $3.5$ 이므로 답은 $7$";
    expect(splitSolutionSteps(s)).toEqual([s]);
  });

  it("소문항 표지 ⑴⑵ 앞에서 가른다", () => {
    const steps = splitSolutionSteps("답은 다음과 같다.⑴ $x=1$⑵ $x=2$");
    expect(steps).toEqual(["답은 다음과 같다.", "⑴ $x=1$", "⑵ $x=2$"]);
  });

  it("따라서·∴ 앞에서 가른다", () => {
    const steps = splitSolutionSteps("$x=2$이고 $y=3$이다.따라서 합은 $5$");
    expect(steps).toEqual(["$x=2$이고 $y=3$이다.", "따라서 합은 $5$"]);
  });

  it("한글 문장 끝 뒤에서 가른다 — 소수점은 안 가른다", () => {
    const steps = splitSolutionSteps(
      "반지름은 $2.5$이다.넓이를 구하면 $6.25\\pi$",
    );
    expect(steps).toEqual(["반지름은 $2.5$이다.", "넓이를 구하면 $6.25\\pi$"]);
  });

  it("가를 자리가 없으면 통째로 한 줄", () => {
    const s = "둘레는 $3+3+6+6 = 18$";
    expect(splitSolutionSteps(s)).toEqual([s]);
  });

  it("빈 문자열은 빈 목록", () => {
    expect(splitSolutionSteps("")).toEqual([]);
  });
});
