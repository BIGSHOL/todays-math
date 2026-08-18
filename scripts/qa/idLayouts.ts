/**
 * 문항번호 **지면 서식**(D안 계열)의 CSS 를 한 곳에 둔다 — 재는 쪽·그리는 쪽·
 * 채점하는 쪽이 **같은 문자열**을 본다.
 *
 * 왜 따로 있나: 이 저장소가 되풀이해 당한 결함이 「목록을 손으로 쓰면 세는 쪽과
 * 고치는 쪽이 같이 눈이 먼다」(CLAUDE.md 2026-08-18)이다. 배치 CSS 를 스크립트마다
 * 옮겨 적으면 **재는 배치와 찍는 배치가 갈라져도 아무도 모른다** — 스크린샷은
 * 「선이 있는 느낌」을 보여 주는데 표의 px 는 다른 배치의 값이 된다.
 *
 * ⚠️ **제품 CSS 가 아니다.** 지면 형태는 D-07(원장님 확정)이라 여기 값이 정본이
 *    아니고, `TestPrint.module.css` 는 한 글자도 안 바뀐다. 이 CSS 는 탐침 문서
 *    (`paperProbe`) 뒤에 `<style>` 로 덧붙여 **덮어쓰는** 것뿐이다.
 */

/** 지면에 찍힐 식별자 **표본 문자열**(자리를 보이려고 넣는다 — 체계는 미확정). */
export const SAMPLE_ID = "5123-7";

/** pt → px (인쇄 매체에서 pt 는 절대 단위 — 1pt = 96/72 px). */
export const pt = (v: number) => `${((v * 96) / 72).toFixed(3)}px`;

/** 번호 줄 오른쪽 끝에 붙는 식별자 조각의 CSS (D·D-tight 공통). */
const MARK_CSS = `.idMark{font-family:var(--paper-font-sans);font-size:${pt(7)};color:#a0a0a8;letter-spacing:.04em}
          .idRight{margin-left:auto;font-weight:500}`;

export interface NumberLayout {
  name: string;
  /** 보고서에 그대로 실을 한 줄 설명. */
  label: string;
  /** 탐침 문서 뒤에 덧붙일 CSS. 없으면 지금 지면 그대로. */
  css?: string;
  /** 번호 줄 오른쪽 끝에 식별자를 주입하는가 (가드 ①이 개수를 센다). */
  injectsMark: boolean;
  /**
   * 브라우저에서 **되읽어 대조할** 값. CSS 가 안 먹어도 표는 초록이 되므로
   * (기준선과 똑같이 그려진다) 매 실행 확인한다 — 가드 ②.
   */
  expect?: {
    fontSizePx: number;
    paddingBottomPx: number;
    marginBottomPx: number;
    borderBottomPx: number;
  };
}

/**
 * `.questionNumber` 를 「순번 + 금색 구분선」 별개 서식으로 만드는 CSS.
 *
 * 세 값이 세로를 정한다 — 글자(26px) · 선 위 여백(`padding-bottom`) ·
 * 선 아래 여백(`margin-bottom`). 선 자체는 1px 이다.
 * 기준선은 18px + margin 6px = **24px** 이므로 Δ = (26 + p + 1 + m) − 24.
 */
function ruleCss(paddingBottomPx: number, marginBottomPx: number): string {
  return `.questionNumber{display:flex;align-items:baseline;font-size:26px;padding-bottom:${paddingBottomPx}px;margin-bottom:${marginBottomPx}px;border-bottom:1px solid var(--paper-gold)}
          ${MARK_CSS}`;
}

const rule = (
  name: string,
  label: string,
  paddingBottomPx: number,
  marginBottomPx: number,
): NumberLayout => ({
  name,
  label,
  css: ruleCss(paddingBottomPx, marginBottomPx),
  injectsMark: true,
  expect: {
    fontSizePx: 26,
    paddingBottomPx,
    marginBottomPx,
    borderBottomPx: 1,
  },
});

export const BASE_LAYOUT: NumberLayout = {
  name: "base",
  label: "지금 그대로 (문 N 18px · line-height 1 · margin-bottom 6px)",
  injectsMark: false,
};

/**
 * **D안** — 원장님이 말씀하신 「상단에 번호 / 아래에 문제」가 선으로 갈린 모양.
 * `id-print-review.md` §8 D안과 **같은 CSS** 다(`num-26-rule-mark`).
 * 실측 Δ +18~20px · 넘침 +673 / +1,145.
 */
export const D_LAYOUT: NumberLayout = rule(
  "d",
  "D안 — 순번 26px + 금색 구분선(선 위 5px · 선 아래 10px) + 식별자 7pt",
  5,
  10,
);

/**
 * **D-tight 후보들** — D 의 선은 살리되 «선 둘레의 빈 자리»만 줄인다.
 * §3 이 「늘어난 18px 중 10px 이 선 둘레의 빈 자리」라고 했으므로 여기를 줄이면
 * 값이 절반쯤이 될 것이다 — **몇 px 인지는 재서 정한다.**
 */
export const D_TIGHT_CANDIDATES: NumberLayout[] = [
  rule("dtight-a", "D-tight ⓐ — 선 위 2px · 선 아래 3px", 2, 3),
  rule(
    "dtight-b",
    "D-tight ⓑ — 선 위 0px · 선 아래 5px (선이 숫자에 붙는다)",
    0,
    5,
  ),
  rule(
    "dtight-c",
    "D-tight ⓒ — 선 위 3px · 선 아래 6px (기준선과 같은 아래 여백)",
    3,
    6,
  ),
  rule(
    "dtight-d",
    "D-tight ⓓ — 선 위 0px · 선 아래 0px (극단 — 한계 확인용)",
    0,
    0,
  ),
];

/** 번호 줄 안에 식별자 조각을 끼워 넣는다. */
export function injectMark(html: string): string {
  const marker = '<div class="questionNumber">';
  const start = html.indexOf(marker);
  if (start < 0)
    throw new Error("questionNumber 를 못 찾았다 — 지면 DOM 이 바뀌었다.");
  const end = html.indexOf("</div>", start);
  return (
    html.slice(0, end) +
    `<span class="idMark idRight">${SAMPLE_ID}</span>` +
    html.slice(end)
  );
}

export const ALL_LAYOUTS: NumberLayout[] = [
  BASE_LAYOUT,
  D_LAYOUT,
  ...D_TIGHT_CANDIDATES,
];

export function layoutByName(name: string): NumberLayout {
  const found = ALL_LAYOUTS.find((l) => l.name === name);
  if (!found)
    throw new Error(
      `모르는 배치다: ${name} (${ALL_LAYOUTS.map((l) => l.name).join(", ")})`,
    );
  return found;
}
