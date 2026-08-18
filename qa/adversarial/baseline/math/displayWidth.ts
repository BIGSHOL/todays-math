/**
 * 표시 폭 측정 — 원문 글자 수가 아니라 **지면에 보이는 글리프 폭**을 센다.
 *
 * 이식 원본: `F:\시험지변환기\core\content_parser.py:330 _sol_seg_width`
 * (읽기 전용 저장소. 상류가 바뀌면 여기도 대조할 것 — docs/planning/tracks/README.md)
 *
 * 왜 필요한가: 넘침 판정이 `content.length` 를 쓰면 수식이 많은 문항을 실제보다 길게
 * 본다. `$\frac{1}{2}$` 는 원문 13자지만 지면에서는 두 글자 폭이다.
 *
 * 단위: 한글·전각 = 2, 반각 = 1. 원본과 같은 기준이라 원본이 쌓은 실측 임계값을
 * 그대로 해석할 수 있다.
 */

/**
 * **폭 0으로 세는 명령은 이 집합뿐이다.**
 *
 * ⚠️ 원본의 실측 회귀 기록(적대검증 2026-08-10): 예전엔 `\[a-zA-Z]+` 를 전부 지워
 * `\triangle`·`\angle`·`\times`·`\pi` 처럼 **실제로 보이는 글리프**까지 0으로 셌다.
 * 그 결과 자동 개행을 넣고도 25.5% 가 한계를 넘었다(최대 +33%). 여기에 명령을
 * 추가할 때는 그 명령이 지면에 아무것도 그리지 않는지 확인할 것.
 */
const ZERO_WIDTH_COMMANDS = new Set(
  `left right mathrm mathit mathbf text textrm rm it bf displaystyle limits nolimits
   frac dfrac tfrac begin end array cases matrix pmatrix bmatrix vmatrix
   big Big bigg Bigg bigl bigr Bigl Bigr biggl biggr quad qquad hspace
   overline underline bar vec hat tilde widehat widetilde boxed mbox`.split(
    /\s+/,
  ),
);

/** 인라인 수식 원자 — 내부는 절대 끊기지 않는다. */
const MATH_ATOM = /\$[^$]*\$/g;
const WORD_COMMAND = /\\([a-zA-Z]+)/g;
const STRUCTURE_CHARS = /[{}^_]/g;

/**
 * 이 코드포인트를 넘으면 전각(한글·한자·가나·전각기호)으로 보고 2로 센다.
 * 원본과 같은 경계값(0x2E7F = CJK 부수 보충 직전)이다.
 */
const FULLWIDTH_FROM = 0x2e7f;

function plainWidth(text: string): number {
  let width = 0;
  // 코드포인트 단위 — 서로게이트 쌍을 두 글자로 세지 않는다.
  for (const ch of text) {
    width += (ch.codePointAt(0) ?? 0) > FULLWIDTH_FROM ? 2 : 1;
  }
  return width;
}

/** 수식 내부 → 표시 글리프 근사. 구조 명령은 지우고, 기호 명령은 1글자로 본다. */
function mathGlyphs(inner: string): string {
  return inner
    .replace(WORD_COMMAND, (_, name: string) =>
      ZERO_WIDTH_COMMANDS.has(name) ? "" : "x",
    )
    .replace(STRUCTURE_CHARS, "");
}

/** 문자열의 표시 폭. 수식은 글리프 근사, 한글·전각은 2, 반각은 1. */
export function displayWidth(text: string): number {
  let width = 0;
  let pos = 0;

  MATH_ATOM.lastIndex = 0;
  for (
    let match = MATH_ATOM.exec(text);
    match !== null;
    match = MATH_ATOM.exec(text)
  ) {
    width += plainWidth(text.slice(pos, match.index));
    width += plainWidth(mathGlyphs(match[0].slice(1, -1)));
    pos = match.index + match[0].length;
  }

  return width + plainWidth(text.slice(pos));
}

/**
 * **2열 배치가 가능한 최대 표시폭.**
 *
 * 원장님 지적(2026-08-17): "보기가 보기내에서 두줄처리되잖아".
 * 지금 `ProblemContent` 는 `md:grid-cols-2 print:grid-cols-2` 로 2열을 **강제**해서
 * 조금만 긴 보기도 열 안에서 두 줄로 접힌다.
 *
 * 실측으로 뽑은 한계값 — 인쇄 지면 기준(`TestPrint.module.css`):
 *   문항 열 폭  = (210mm − 100px − 14px) × 1.15 / 2.15 ≈ 364px
 *   2열 한 칸   = (364 − gap 32px) / 2 ≈ 166px, 여기서 마커(①)와 간격 약 19px 제외 ≈ 147px
 *   본문 12.5px 한글은 한 글자 ≈ 12.5px → 약 11.8자 → 표시폭(한글=2) 약 23.6
 * 그래서 **24** 를 넘으면 2열에서 반드시 접힌다. 상자 카드도 거의 같다
 * (안쪽 폭 ≈ 330px, 2열 한 칸 ≈ 153px → 표시폭 약 24.4).
 *
 * DB 전수(보기 있는 문항 34,411건) 분포: 최장 보기 표시폭이 24를 넘는 문항은 6.0%.
 * 즉 94%는 지금처럼 2열로 남고, 접히던 6%만 1열로 내려온다.
 */
export const TWO_COLUMN_WIDTH_LIMIT = 24;

/**
 * 항목 전부가 2열 한 칸에 들어가는가. **하나라도** 넘으면 전체를 1열로 내린다 —
 * 한 칸만 두 줄이 되면 그 행 전체가 어긋나 보이기 때문이다(원장님 지적).
 */
export function fitsTwoColumns(texts: readonly string[]): boolean {
  return (
    texts.length >= 2 &&
    texts.every((text) => displayWidth(text) <= TWO_COLUMN_WIDTH_LIMIT)
  );
}
