/**
 * 🔴 RED → 🟢 GREEN — 표시 폭 측정 (시험지변환기 `_sol_seg_width` 이식).
 *
 * 원본: F:\시험지변환기\core\content_parser.py:330 `_sol_seg_width`
 * 왜 필요한가: 넘침 판정이 **원문 글자 수**를 세면 수식이 많은 문항을 실제보다 길게 본다
 * (`$\frac{1}{2}$` 는 13자지만 지면에서는 두 글자 폭). 렌더 폭에 가깝게 세야 한다.
 */
import { describe, expect, it } from "vitest";

import { displayWidth, TWO_COLUMN_WIDTH_LIMIT } from "@/lib/math/displayWidth";

describe("표시 폭 — 한글·전각은 2, 반각은 1", () => {
  it("한글은 글자당 2로 센다", () => {
    expect(displayWidth("가나다")).toBe(6);
  });

  it("영숫자·기호는 글자당 1로 센다", () => {
    expect(displayWidth("abc123")).toBe(6);
  });

  it("섞이면 각각 더한다", () => {
    expect(displayWidth("값은 3")).toBe(2 + 2 + 1 + 1); // 값은(4) + 공백(1) + 3(1)
  });
});

describe("표시 폭 — 수식은 원문이 아니라 글리프 근사로 센다", () => {
  it("구조 명령(frac)과 중괄호는 폭 0이다", () => {
    // "$\frac{1}{2}$" 는 원문 13자지만 지면에는 1과 2 두 글자만 보인다.
    expect(displayWidth("$\\frac{1}{2}$")).toBe(2);
  });

  it("첨자 기호(^ _)는 폭 0이다", () => {
    expect(displayWidth("$x^2$")).toBe(2);
  });

  // 원본의 실측 회귀(적대검증 2026-08-10): 모든 `\명령`을 0으로 세었더니 개행 뒤에도
  // 25.5%가 한계를 넘었다. **보이는 글리프**인 명령은 1로 세야 한다.
  it("실제로 보이는 기호 명령(\\triangle, \\pi)은 폭 0이 아니다", () => {
    expect(displayWidth("$\\triangle$")).toBe(1);
    expect(displayWidth("$\\pi$")).toBe(1);
    expect(displayWidth("$\\angle$")).toBe(1);
  });

  it("수식 밖 텍스트와 수식을 함께 센다", () => {
    // "삼각형 " = 6+1, "$\triangle ABC$" = x + " ABC" = 1+4
    expect(displayWidth("삼각형 $\\triangle ABC$")).toBe(6 + 1 + 1 + 4);
  });

  it("원문 글자 수보다 훨씬 작게 나온다 — 이게 이식한 이유다", () => {
    const text = "$\\dfrac{a+b}{c+d}$";
    expect(text.length).toBe(18);
    // 글리프 `a+bc+d` 6 + 이항 연산자 `+` 두 개의 여백 3×2 = 12.
    expect(displayWidth(text)).toBe(6 + 3 * 2);
  });
});

/**
 * ── 연산자 여백 (2026-08-18 원장님 회귀 지적) ────────────────────────────────
 * "여전히 보기가 길어서 미리보기에서 줄바꿈 처리되는 문제가 있네"
 *
 * 글리프 **개수**만 세면 지면 폭을 못 본다. 브라우저 실측(12.5px 지면 글꼴):
 *   `$ab$` 14.5px · `$a+b$` 33.0px → `+` 하나가 17px (글자 하나는 7px)
 * 한글 한 글자 12.1px = 폭 2 이므로 1 단위 ≈ 6.05px → 모자란 몫 ≈ 1.8 단위.
 * 2,247개 보기 조각 실측 맞춤에서 **3 단위**가 가장 잘 갈랐다(오판 35 → 3).
 */
describe("표시 폭 — 연산자 여백은 글리프 개수로 안 보인다", () => {
  it("이항·관계 연산자는 글리프 1 말고 여백 3을 더 먹는다", () => {
    expect(displayWidth("$a+b$")).toBe(3 + 3); // a,+,b = 3 · `+` 여백 3
    expect(displayWidth("$a=b$")).toBe(3 + 3);
    expect(displayWidth("$a\\times b$")).toBe(4 + 3); // x, 공백, a, b
    expect(displayWidth("$a\\le b$")).toBe(4 + 3);
  });

  it("`\\left`·`\\int`·`\\top` 은 연산자로 오인하지 않는다", () => {
    // `\le`·`\in`·`\to` 가 앞부분과 겹친다 — 낱말 경계가 없으면 여백이 잘못 붙는다.
    expect(displayWidth("$\\left( a\\right)$")).toBe(displayWidth("$( a)$"));
    expect(displayWidth("$\\int f$")).toBe(3); // x, 공백, f
    expect(displayWidth("$\\top$")).toBe(1);
  });

  it("**부호** 마이너스는 여백을 안 먹는다 — 이항 뺄셈만 센다", () => {
    // 둘을 안 가르면 음수 보기가 부풀어 멀쩡한 2열이 1열로 내려간다.
    expect(displayWidth("$-3$")).toBe(2);
    expect(displayWidth("$a-b$")).toBe(3 + 3);
    expect(displayWidth("$(-1)$")).toBe(4);
  });

  it("평문의 `+`·`=` 는 그냥 한 글자다 — 여백은 수식 안에서만", () => {
    expect(displayWidth("a+b")).toBe(3);
  });

  it("순환소수 점 표기는 CSS 점으로 그려져 더 넓다", () => {
    // 실측 `$0.\dot{5}=0.555555555$` 185px — 근사로는 97px 로 봤다.
    // 글리프 `0`,`.`,`\dot`→x,`5` = 4 + 점 표기 보정 6.
    expect(displayWidth("$0.\\dot{5}$")).toBe(4 + 6);
  });

  it("실측 회귀 케이스 — 예전 모델보다 훨씬 넓게 센다", () => {
    // 원장님 스크린샷의 보기(실측 150px, 2열 칸 147px). 예전 모델은 14로 셌다.
    // `\times` 둘 + `=` 하나 → 여백 9 를 더해 23. 실측과 같은 자리다.
    const folded = "$0.1\\times a\\times b=0.ab$";
    expect(displayWidth(folded)).toBe(14 + 9);
  });

  it("2열 칸을 확실히 넘는 실측 보기는 1열로 내려간다", () => {
    // `$a\times(-3)\times b\times a=-3ab^{2}$` — 실측 220px, 칸 147px.
    const wide = "$a\\times \\left( -3\\right) \\times b\\times a=\\,-3ab^{2}$";
    expect(displayWidth(wide)).toBeGreaterThan(TWO_COLUMN_WIDTH_LIMIT);
  });
});
