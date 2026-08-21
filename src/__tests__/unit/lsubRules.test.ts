/**
 * 🔴 **왼쪽 아래첨자(`LSUB`)** — ₅C₁ 이 `CLSUB5_{1}` 로 지면에 나가던 자리.
 *
 * 정본 변환기가 이 키워드를 모르고(`core` 전체 grep 0), 잔재 지표도 **두 겹으로**
 * 못 봤다. 그래서 「고쳤다」고 세어지면서 그대로 나갔다 — 실측 97문항 · 203자리.
 */
import { describe, expect, it } from "vitest";

import {
  fixLsub,
  lsubLeft,
  verifyLsubArithmetic,
} from "../../../scripts/qa/lsubRules";
import { judgeLsubSpan } from "../../../scripts/qa/repair-lsub";

const B = String.fromCharCode(92);
const mrm = (c: string) => `${B}mathrm{${c}}`;

describe("fixLsub — 실데이터에서 나온 모양들", () => {
  it.each([
    // 연산자 뒤에 붙은 꼴
    [`${mrm("C")}LSUB5_{1}`, `{}_5${mrm("C")}_1`],
    [`CLSUB5_{1}`, `{}_5${mrm("C")}_1`],
    // 연산자 앞에 붙은 꼴 — 🔴 `4P` 는 낱말 경계가 **없다**
    [`${mrm("LSUB")}4P_{2}`, `{}_4${mrm("P")}_2`],
    // 앞의 `\,`(얇은 칸)은 **그대로 둔다** — 원문 간격을 안 바꾼다.
    [`${B},LSUBn${mrm("P")}_{r}`, `${B},{}_n${mrm("P")}_r`],
    // 날 HWP — 중괄호가 살아 있는 꼴
    [`C LSUB {5} _{1}`, `{}_5${mrm("C")}_1`],
    // 첨자가 뒤에 오는 뒤집힌 꼴
    [`${mrm("H")}_{3}lsub4`, `{}_4${mrm("H")}_3`],
    [`${mrm("C")}_{k}LSUB400`, `{}_{400}${mrm("C")}_k`],
    // 첨자를 `\mathit{}` 이 감싼 꼴 · 두 자리 수
    [`CLSUB${mrm("16")}_{3}`, `{}_{16}${mrm("C")}_3`],
    [`CLSUBn-1_{r-1}`, `{}_{n-1}${mrm("C")}_{r-1}`],
  ])("%s → %s", (from, to) => {
    expect(fixLsub(from).out).toBe(to);
  });

  /**
   * 🔴 그 `\pi` 는 소문자 π 가 **아니라 중복순열 Π** 다.
   *
   * 글자만 보면 못 가른다 — **셈이 가른다.** 해설이 스스로 적어 두었다:
   * `₄H₅ - ₃Π₂ = ₈C₅ - 3²` — 즉 ₃Π₂ 를 **3²** 이라고 쓴다. ₃Π₂=3²=9 다.
   */
  it("`\\pi LSUB` 와 `SMALLPRODLSUB` 는 중복순열 Π 다", () => {
    expect(fixLsub(`${B}pi LSUB5_{3}`).out).toBe(`{}_5${B}Pi _3`);
    expect(fixLsub(`SMALLPRODLSUB3_{n}`).out).toBe(`{}_3${B}Pi _n`);
  });

  /**
   * 🔴 패턴 끝에 오는 첨자가 **탐욕스러우면 다음 항을 삼킨다.**
   *    실제로 `{}_{n+C}\mathrm{C}_0_{1}…` 라는 엉터리가 나왔다.
   */
  it("뒤집힌 꼴의 첨자가 **다음 항을 삼키지 않는다**", () => {
    const got = fixLsub(`${mrm("C")}_{0}LSUBn+${mrm("C")}_{1}lsubn`).out;
    expect(got).not.toContain("n+C");
    expect(got).toContain(`{}_n${mrm("C")}_0`);
  });

  it("못 가르는 것은 **손대지 않는다**", () => {
    for (const s of [`aLSUBn`, `LSUP {2}3`, `LSUBCLSUBn_{r}`])
      expect(lsubLeft(fixLsub(s).out)).toBeGreaterThan(0);
  });
});

describe("verifyLsubArithmetic — 본문 밖 근거", () => {
  it("맞는 등식은 통과한다 — ₅P₃=60 · ₄H₃=₆C₃=20", () => {
    expect(verifyLsubArithmetic(`{}_5${mrm("P")}_3=60`)).toMatchObject({
      checked: true,
      ok: true,
    });
    expect(
      verifyLsubArithmetic(`{}_4${mrm("H")}_3={}_6${mrm("C")}_3=20`),
    ).toMatchObject({ checked: true, ok: true });
  });

  /** 🔴 **일부러 틀린 입력** — 이게 빨개지지 않으면 이 가드는 장식이다. */
  it("틀린 값은 잡아낸다 — ₅P₃ 는 60 인데 61 이라 적으면", () => {
    const v = verifyLsubArithmetic(`{}_5${mrm("P")}_3=61`);
    expect(v).toMatchObject({ checked: true, ok: false });
    expect(v.why).toContain("60");
  });

  /**
   * 🔴 **거짓 경보를 안 낸다.** 처음엔 「항 뒤에 `=수`」만 봤다가 10건이 거짓으로
   *    걸렸다 — `₅Π₃-₄Π₃=125-64=61` 의 125 는 **앞 항**의 값이다.
   *    거짓 경보는 침묵하는 가드보다 나쁘다(다음 사람이 가드를 끈다).
   */
  it("한 변 전부가 아니면 견주지 않는다 — `A-B=125-64=61`", () => {
    const v = verifyLsubArithmetic(`{}_5${B}Pi _3-{}_4${B}Pi _3=125-64=61`);
    expect(v.ok).toBe(true);
    expect(v.checked).toBe(false);
  });

  it("곱한 결과와 견주지 않는다 — `3×₃H₅=63`", () => {
    expect(
      verifyLsubArithmetic(`3${B}times {}_3${mrm("H")}_5=63`),
    ).toMatchObject({ ok: true, checked: false });
  });
});

describe("judgeLsubSpan — 덩어리를 바꿔도 되는가", () => {
  it("셈이 맞으면 통과하고 무엇으로 확인했는지 말한다", () => {
    const v = judgeLsubSpan(`${mrm("P")}LSUB5_{3}=60`);
    expect(v.ok).toBe(true);
    expect(v.ok && v.why).toContain("셈 확인");
  });

  it("LSUB 가 남으면 그 덩어리는 안 바꾼다", () => {
    expect(judgeLsubSpan(`aLSUBn`)).toMatchObject({ ok: false });
  });

  it("🔴 셈이 안 맞으면 버린다", () => {
    expect(judgeLsubSpan(`${mrm("P")}LSUB5_{3}=61`)).toMatchObject({
      ok: false,
    });
  });

  it("수를 잃으면 버린다", () => {
    // 규칙이 첨자를 떨어뜨리면 수가 준다 — 그 자체를 잠근다.
    const v = judgeLsubSpan(`${mrm("C")}LSUB5_{1}`);
    expect(v.ok).toBe(true);
    expect(v.ok && v.out).toContain("5");
    expect(v.ok && v.out).toContain("1");
  });
});
