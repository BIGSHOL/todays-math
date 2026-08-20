/**
 * 🔴 **정본 변환기 겉포장** — `scripts/qa/convert-hwp-spans.py` 의 구멍 막기를 못 박는다.
 *
 * 정본(`testchanger/core/hwpeq_to_latex.py`)은 읽기 전용이라 고치지 않는다. 대신
 * 겉포장이 구멍을 막는데, **그 구멍들이 전부 에러 없이 조용히 틀린 값을 낸다** —
 * 그래서 시험이 없으면 되돌아가도 아무도 모른다.
 *
 * | 구멍 | 겉포장 없이 나오는 것 |
 * | --- | --- |
 * | `overline {AB}` | `\frac{}{line}AB` — **선분이 분수가 된다** |
 * | `rarrow` | `\Rightarrow`(⇒) — →가 아니다 |
 * | `sintheta` | 그대로 — 붙은 함수 이름은 안 바뀐다 |
 * | `INF` (어휘 누락) | `\in F` — `in`+`F` 로 **찢긴다** |
 * | `TRIANGLE` | (찢으면) `TRI ANGLE` |
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

import { describe, expect, it } from "vitest";

/** testchanger 정본이 이 컴퓨터에 있나. 없으면 이 파일은 돌 수 없다. */
const 정본있음 = (() => {
  for (const d of [
    process.env.TESTCHANGER_DIR,
    "F:\\시험지변환기",
    "D:\\시험지 한글화",
  ])
    if (d && existsSync(d)) return true;
  return false;
})();

const probe = (): Record<string, string> => {
  const out = execFileSync(
    "python",
    ["scripts/qa/convert-hwp-spans.py", "--probe"],
    { encoding: "utf-8", maxBuffer: 1 << 24 },
  );
  const map: Record<string, string> = {};
  for (const line of out.split(/\r?\n/)) {
    const i = line.indexOf(" -> ");
    if (i < 0) continue;
    map[line.slice(0, i).trim()] = line.slice(i + 4).trim();
  }
  return map;
};

describe.skipIf(!정본있음)(
  "HWP span 변환 겉포장 (testchanger 정본 필요)",
  () => {
    const got = 정본있음 ? probe() : {};

    it.each([
      ["overline {AB}", "\\overline{AB}"],
      ["rm overline { AH } = it x", "\\mathrm{\\overline{AH}}=\\mathit{x}"],
      ["UNDEROVER _{0} ^{2}", "_{0}^{2}"],
      ["a RIGHTARROW b", "a\\rightarrow b"],
      ["LEFT ( 3x ^{2} +ax-5 RIGHT )", "\\left( 3x^{2}+ax-5\\right)"],
      ["{1} over {2}", "\\frac{1}{2}"],
      ["RM BAR {Q_1 H}=root 3", "\\mathrm{\\overline{Q_{1}H}}=\\sqrt{3}"],
    ])("%s → %s", (from, to) => {
      expect(got[from]).toBe(to);
    });

    it("🔴 극한은 →다 — 정본이 주는 ⇒ 를 쓰면 뜻이 다르다", () => {
      const out = got["lim _{n rarrow INF } {{a _{n}} over {n}}"];
      expect(out).toBe("\\lim _{n\\to \\infty }\\frac{a_{n}}{n}");
      // `INF` 를 어휘에서 놓치면 `\in F` 로 찢긴다 — 실제로 그랬다.
      expect(out).not.toContain("\\in F");
      expect(out).not.toContain("\\Rightarrow");
    });

    it("cases 는 정본이 이미 잘한다 — 겉포장이 망가뜨리지 않는다", () => {
      expect(got["cases{ cos x # sin x }"]).toBe(
        "\\begin{cases} \\cos x \\\\ \\sin x \\end{cases}",
      );
    });

    /**
     * 🔴 이 넷이 없으면 「어휘 떼어내기」를 **꺼도 산출물이 그대로**여서, 그 자리를
     *    시험이 구조적으로 못 본다. 실제로 변이 하네스가 「산출물이 안 바뀐다」고
     *    알려 줘서 알았다(2026-08-21).
     */
    describe("붙어 버린 낱말을 정본 어휘로 뗀다", () => {
      it.each([
        ["sintheta", "\\sin \\theta"],
        ["log2", "\\log 2"],
        ["piRIGHT )", "\\pi \\right)"],
      ])("%s → %s", (from, to) => {
        expect(got[from]).toBe(to);
      });

      it("🔴 온전한 토큰은 **찢지 않는다** — `TRIANGLE` 이 `TRI ANGLE` 이 되면 안 된다", () => {
        expect(got["TRIANGLE ABC"]).toBe("\\triangle ABC");
      });
    });
  },
);
