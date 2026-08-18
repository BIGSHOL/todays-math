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

/* ────────────────────────────────────────────────────────────────────────
 * 연산자 여백 — 글리프를 세는 것만으로는 못 보는 폭 (2026-08-18)
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * **글리프 개수는 지면 폭이 아니다.** KaTeX 는 이항·관계 연산자 좌우에 여백을 넣는다.
 * 브라우저 실측(12.5px 지면 글꼴, `scripts/qa/measure-choice-layout.tsx`):
 *   `$ab$` 14.5px · `$a+b$` 33.0px  → `+` 하나가 **17px** (글자 하나가 7px 인데)
 *   `$a=b$` 34.6px                  → `=` 하나가 18.6px
 * 한글 한 글자가 12.1px = 표시폭 2 이므로 1 단위 ≈ 6.05px.
 * 연산자는 글리프 1(≈6px)로 이미 세고 있으니 **모자란 몫이 약 11px ≈ 1.8 단위**다.
 * 실측 맞춤(2,247 보기 조각)에서 **3 단위**가 가장 잘 갈랐다.
 *
 * ⚠️ 이 보정이 없으면 2열 판정이 «접히는 보기»를 못 본다. 원장님이 2026-08-18 에
 * 지적한 "여전히 보기가 길어서 미리보기에서 줄바꿈 처리되는 문제"가 이것이다.
 * 한계값(24)은 **그대로 두고 모델만 고쳤다** — 실측 2,247 조각에서 오판 35건 → 4건.
 * 한계값을 옮겨 맞추려 했다면 최선이 17이었고 그래도 오판 29건이 남았다.
 * 즉 문제는 문턱이 아니라 **자**였다 (CLAUDE.md 2026-08-17: 문턱이 안 갈라주면
 * 문턱을 옮기지 말고 열쇠를 바꿔라).
 */
const OPERATOR_EXTRA = 3;

/** 좌우 여백이 붙는 연산자. `\left`·`\int`·`\top` 에 걸리지 않게 낱말 경계를 둔다. */
const SPACED_OPERATOR_RE =
  /\\(?:times|div|pm|mp|cdot|le|ge|ne|neq|leq|geq|approx|equiv|sim|to|Rightarrow|rightarrow|in|subset|supset|cup|cap)\b|[+=<>×÷≤≥≠±∈⊂⊃∪∩⇨→]/g;

/**
 * **이항** 뺄셈만 센다 — 앞이 글자·숫자·닫는 괄호일 때.
 * 부호(`$-3$`)는 여백이 안 붙으므로 빼야 한다. 둘을 안 가르면 음수 보기가
 * 통째로 부풀어 멀쩡한 2열이 1열로 내려간다.
 */
const BINARY_MINUS_RE = /(?<=[A-Za-z0-9)\]}])\s*-/g;

/**
 * 순환소수 점 표기. 전처리(`textPreprocess`)가 `\dot`·숫자 `\overline` 을
 * **CSS 점 span**으로 바꿔 그리므로 KaTeX 글리프 근사보다 훨씬 넓다.
 * 실측 `$0.\dot{5}=0.555555555$` 185px · `$1.333\cdots =1.\dot{3}\dot{3}$` 233px —
 * 근사로는 각각 97px·85px 로 봤다. 표기 하나에 **6 단위**를 얹어야 실측과 맞는다.
 */
const REPEAT_DOT_RE = /\\dot\s*\{|\\overline\s*\{\s*\d/g;
const REPEAT_DOT_EXTRA = 6;

function countMatches(text: string, pattern: RegExp): number {
  pattern.lastIndex = 0;
  return text.match(pattern)?.length ?? 0;
}

/** 수식 하나가 글리프 폭 말고 더 먹는 몫. */
function mathSpacing(inner: string): number {
  return (
    OPERATOR_EXTRA *
    (countMatches(inner, SPACED_OPERATOR_RE) +
      countMatches(inner, BINARY_MINUS_RE))
  );
}

/**
 * 문자열의 표시 폭. 수식은 글리프 근사 + **연산자 여백**, 한글·전각은 2, 반각은 1.
 *
 * 연산자 여백은 **수식 안에서만** 더한다 — 평문의 `+`·`=` 는 그냥 한 글자다.
 */
export function displayWidth(text: string): number {
  let width = 0;
  let pos = 0;

  MATH_ATOM.lastIndex = 0;
  for (
    let match = MATH_ATOM.exec(text);
    match !== null;
    match = MATH_ATOM.exec(text)
  ) {
    const inner = match[0].slice(1, -1);
    width += plainWidth(text.slice(pos, match.index));
    width += plainWidth(mathGlyphs(inner)) + mathSpacing(inner);
    pos = match.index + match[0].length;
  }

  width += plainWidth(text.slice(pos));
  return width + REPEAT_DOT_EXTRA * countMatches(text, REPEAT_DOT_RE);
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
 * DB 전수(보기 있는 문항 34,421건): 1열로 내려가는 문항 **8.0%**(2,770건).
 *
 * ⚠️ 2026-08-18 이전에는 6.0%(2,063건)였다. 한계값은 **한 자도 안 바뀌었고**
 * `displayWidth` 가 연산자 여백을 세기 시작해서 늘었다. 브라우저 실측으로
 * 「실제로 칸을 넘는 보기」를 세어 보니 5.3%였는데 예전 모델은 그중 34개를
 * 「2열이어도 된다」고 봤다 — 그게 원장님이 본 접힘이다.
 * 늘어난 707건은 **지면 세로 배분이 바뀐다**(절대 규칙 6 — 실물 출력 검수 대상).
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
