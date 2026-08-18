/**
 * DB 본문 **후보정 규칙** (트랙 렌더-C) — 순수 함수만. DB·파일 IO 없음.
 *
 * 세 가지를 다룬다.
 *   1. 본문에 박힌 문항 유형 라벨 (`[서술형 3]`) — 지면 조판이 붙일 것이지 본문이 가질 것이 아니다.
 *   2. 변환이 덜 된 HWP 수식 키워드 (`aDIVIDEb`) — 원장님 스크린샷의 그 모양.
 *   3. 짝이 안 맞는 `$` — 선택지가 통째로 수식이 되거나 그 반대가 된다.
 *
 * ## 설계 원칙 — 못 자르는 것은 지우지 말고 **막는다**
 *
 * 47,152건 중 고칠 것은 8천여 건이다. 나머지를 망가뜨리면 손해다. 그래서 모든
 * 규칙이 **보류(hold) 를 먼저** 판정한다. 애매하면 바꾸지 않고 사유를 돌려준다
 * (CLAUDE.md 2026-08-16 "경계를 확실히 못 자르는 오염은 지우지 말고 막는다").
 *
 * ## ⚠️ 지표가 놓쳤던 것
 *
 * 기존 지표는 라벨을 `[서술형 3]` 모양으로만 셌다. 그런데 실측 최빈 모양은
 * **`[서술형 $2$]`**(번호가 수식으로 감싸임)이라 502건으로 보고됐다 — 실제는
 * **8,502건**. `measure-hwp-latex-residue.py` 가 `DIVIDE` 를 못 세던 것과 같은
 * 자리다(패턴이 `(?![A-Za-z])` 로 끝나 `DIV` 뒤의 `I` 에 막힘).
 * **지표가 실패를 셀 수 있는 형태인지부터 보라.**
 */

import { isUnknownCommand } from "./mathTokenCensus";
import { blockingKeyword } from "./hwpVocab";

/** 시험지가 쓰는 문항 유형 낱말. `서답형` 은 학교에 따라 단답형·서술형을 함께 가리킨다. */
export const LABEL_KINDS = [
  "서술형",
  "서답형",
  "단답형",
  "객관식",
  "주관식",
  "선택형",
] as const;
export type LabelKind = (typeof LABEL_KINDS)[number];

const KIND_ALT = LABEL_KINDS.join("|");

/**
 * 아주 넓은 그물 — 대괄호 안 어딘가에 유형 낱말이 있으면 라벨 **후보**로 본다.
 * 몇 개나 있는지를 세는 데 쓴다(둘 이상이면 문항 경계가 무너진 행이다).
 * `[도형 모양 아이콘]` 처럼 유형 낱말이 없는 대괄호는 애초에 안 걸린다.
 */
const LABEL_ANY = new RegExp(
  `[[【〔][^\\]】〕]{0,40}?(?:${KIND_ALT})[^\\]】〕]{0,40}?[\\]】〕]`,
  "g",
);

/** 문두 라벨 — 대괄호 안이 「유형 + (번호)」 **뿐**일 때만. 번호는 `$3$` 로 감싸이기도 한다. */
const HEAD_STRICT = new RegExp(
  `^\\s*\\[\\s*(${KIND_ALT})\\s*(?:\\$\\s*\\d{1,2}\\s*\\$|\\d{1,2})?\\s*\\]\\s*`,
);
/** `$[$ 서답형 $4]$` — 대괄호가 수식 구분자 안에 갇힌 변종(실측 4건). */
const HEAD_MATHWRAP = new RegExp(
  `^\\s*\\$\\[\\$\\s*(${KIND_ALT})\\s*\\$\\d{1,2}\\]\\$\\s*`,
);
/** 라벨 바로 뒤에 한 번 더 붙는 `(서술형)`. 원장님: 문제 자체에 그 글자가 있으면 안 된다. */
const TRAILING_PAREN_KIND = new RegExp(`^\\s*\\((?:${KIND_ALT})\\)\\s*`);

export type LabelHold =
  "multi-label" | "not-head" | "unknown-shape" | "empty-after";

export interface LabelStripResult {
  /** 라벨을 뗀 본문. 보류거나 뗄 것이 없으면 입력 그대로. */
  content: string;
  /** 뗀 라벨이 말하던 유형. 안 뗐으면 null. */
  kind: LabelKind | null;
  /** 왜 안 뗐는지. 뗐거나 애초에 라벨이 없으면 null. */
  hold: LabelHold | null;
}

/**
 * 문두의 문항 유형 라벨을 뗀다.
 *
 * 뗀 자리는 **시험지 조판이 채운다**(`essayLabels`) — 원장님 지시
 * "문제 배치될 때 알아서 스마트하게 [서술형 n]".
 */
export function stripQuestionLabel(content: string): LabelStripResult {
  const text = content ?? "";
  const found = [...text.matchAll(LABEL_ANY)];
  if (found.length === 0) return { content: text, kind: null, hold: null };

  // 한 행에 라벨이 둘 이상 = 문항 여러 개가 한 행에 붙어 있다(실측 49건).
  // 앞 라벨만 떼면 "두 문항이 붙은 행"이라는 사실만 감춰져 더 나빠진다.
  if (found.length > 1)
    return { content: text, kind: null, hold: "multi-label" };

  const strict = HEAD_STRICT.exec(text);
  const wrapped = strict ? null : HEAD_MATHWRAP.exec(text);
  const match = strict ?? wrapped;

  if (!match) {
    const at = found[0].index ?? 0;
    // 문두가 아닌 라벨은 **다음 문항**의 것이다 — 본문 중간을 건드리지 않는다.
    return {
      content: text,
      kind: null,
      hold: at > 2 ? "not-head" : "unknown-shape",
    };
  }

  let rest = text.slice(match[0].length);
  const paren = TRAILING_PAREN_KIND.exec(rest);
  if (paren) rest = rest.slice(paren[0].length);

  if (rest.trim().length === 0)
    return { content: text, kind: null, hold: "empty-after" };

  return { content: rest, kind: match[1] as LabelKind, hold: null };
}

/**
 * 이 행은 **변환기를 통째로 안 거쳤다** — HWP 수식 스크립트가 날것으로 들어 있다.
 *
 * 이런 행에 키워드 치환을 하면 안 된다. `over` 는 분자·분모 경계를 잡아야 하고
 * (`{a} over {b}` vs `1over5x`), 선택지 자리표시자 `{BOX{ 1. }}` 는 문항 구조까지
 * 무너져 있다. 규칙으로 못 고친다 — **막고 목록으로 남긴다.**
 *
 * 표지는 전부 "정상 LaTeX 에는 절대 안 나오는 것"만 골랐다. 백슬래시가 붙은
 * 정상 명령(`\overline`, `\cdots`, `\left(`)은 lookbehind 로 걸러진다.
 */
const WHOLESALE_MARKERS: Array<[string, RegExp]> = [
  // 선택지 자리표시자 — `{BOX{~~ 1. ~~}}`, `box{~③~}`
  ["BOX", /(?<![\\A-Za-z])(?:BOX|box)\s*\{/],
  // 맨 분수 키워드 — `1 over {2}`, `1over5x`, `}over{`
  ["over", /(?<![\\A-Za-z])over(?![A-Za-z])/],
  // 맨 괄호 키워드 — `LEFT ( … RIGHT )`. `\mathit{LEFT}(` 는 `}` 가 뒤에 와 안 걸린다.
  ["LEFT/RIGHT", /(?<![\\A-Za-z])(?:LEFT|RIGHT)\s*[()]/],
  // 맨 생략기호 — `cdots`, `cdotscdots`, `CDOTS`
  ["cdots", /(?<![\\A-Za-z])cdots|(?<!\\)CDOTS/],
  ["cases", /(?<![\\A-Za-z])cases\s*\{/],
  ["atop/pile", /(?<![\\A-Za-z])(?:atop|pile)(?![A-Za-z])/],
  // 수식 **안**의 맨 `rm ` — HWP 의 로만체 지시자다(`$rm A$$25$`). 바깥 한글 지문에
  // 우연히 섞이는 걸 막으려고 `$...$` 안으로 한정한다. 이게 있는 행은 공백까지
  // 뭉개져 있어(`$$이때$rm B$반에수학점수가`) 키워드 치환으로는 살릴 수 없다.
  ["rm", /\$[^$]*(?<![\\A-Za-z])(?:rm|RM)\s[^$]*\$/],
  // HWP 의 폭 조절 백틱. 정상 LaTeX 본문에는 쓰이지 않는다.
  ["backtick", /`/],
  // 원본 시험지 꼬리말이 본문에 딸려 들어온 행 — 구조가 이미 무너져 있다.
  ["footer", /대구광역시내신수학연구회/],
];

export function isWholesaleHwpScript(content: string): boolean {
  return WHOLESALE_MARKERS.some(([, re]) => re.test(content ?? ""));
}

/** 어떤 표지에 걸렸는지 — 보고서용. */
export function wholesaleMarkers(content: string): string[] {
  return WHOLESALE_MARKERS.filter(([, re]) => re.test(content ?? "")).map(
    ([name]) => name,
  );
}

/**
 * 되돌릴 자리가 **하나로 정해지는** 잔재만 옮긴다.
 *
 * `over`/`sqrt`/`root`/`bar` 는 여기 없다 — 피연산자 경계를 잡아야 하고
 * 그 경계는 이 행들에서 이미 무너져 있다. 그건 재추출로 풀 일이다.
 */
const RESIDUE_RULES: Array<[string, RegExp, string]> = [
  ["DIVIDE", /(?<!\\)DIVIDE/g, "\\div "],
  ["divide", /(?<!\\)divide/g, "\\div "],
  ["TIMES", /(?<!\\)TIMES/g, "\\times "],
  // `\mathrm{P}\mathit{LEFT}(t,~t\right)` — 짝 없는 `\right` 가 KaTeX 를 깨뜨린다.
  [String.raw`\mathit{LEFT}`, /\\mathit\{LEFT\}/g, "\\left"],
  [String.raw`\mathit{RIGHT}`, /\\mathit\{RIGHT\}/g, "\\right"],
  // `\mathit{ANGLEx}` → `\angle x`. RM/IT 가 삼킨 기호(hwpeq_unglue §3)의 잔여분.
  [String.raw`\mathit{ANGLE}`, /\\mathit\{ANGLE([A-Za-z]*)\}/g, "\\angle $1"],
  // `veca` → `\vec{a}`. **한 글자짜리만** 옮긴다 — `vecab` 는 `ab` 가 한 벡터인지
  // `a` 다음에 `b` 인지 정할 수 없으므로 건드리지 않고 목록에 남긴다.
  ["vec", /(?<![\\A-Za-z])vec([A-Za-z0-9])(?![A-Za-z0-9])/g, "\\vec{$1}"],
];

export interface ResidueFixResult {
  content: string;
  /** 적용한 규칙 이름들. 아무것도 안 바뀌었으면 빈 배열. */
  applied: string[];
  hold: "wholesale" | null;
}

/** 수식 구간(`$...$`) 안에서만 바꾼다 — 바깥 한글 지문은 건드리지 않는다. */
export function fixHwpResidue(content: string): ResidueFixResult {
  const text = content ?? "";
  if (isWholesaleHwpScript(text))
    return { content: text, applied: [], hold: "wholesale" };

  const applied = new Set<string>();
  const out = text.replace(/\$([^$]*)\$/g, (_whole, expr: string) => {
    let e = expr;
    for (const [name, pattern, replacement] of RESIDUE_RULES) {
      const next = e.replace(pattern, replacement);
      if (next !== e) {
        applied.add(name);
        e = next;
      }
    }
    return `$${e}$`;
  });
  return { content: out, applied: [...applied], hold: null };
}

/** 수식 구간이 **말이 되는가** — 짝이 맞고, 안에 줄바꿈도 한글도 없다. */
function spansLookLikeMath(text: string): boolean {
  const parts = text.split("$");
  // 짝이 맞으면 조각 수가 홀수다(바깥, 안, 바깥, 안, … 바깥).
  if (parts.length % 2 === 0) return false;
  for (let i = 1; i < parts.length; i += 2) {
    if (parts[i].includes("\n")) return false;
    if (/[가-힣]/.test(parts[i])) return false;
  }
  return true;
}

/** `$` 하나(와 붙은 공백)를 지운 결과. 제 줄에 홀로 있으면 그 줄까지 지운다. */
function removeDollarAt(text: string, index: number): string {
  let start = index;
  while (start > 0 && (text[start - 1] === " " || text[start - 1] === "\t"))
    start -= 1;
  let end = index + 1;
  if (text[start - 1] === "\n" && text[end] === "\n") end += 1;
  return text.slice(0, start) + text.slice(end);
}

export interface StrayDollarResult {
  content: string;
  applied: "trailing-dollar" | "stray-LEFT" | null;
  hold: "unresolved" | null;
}

/**
 * 짝이 안 맞는 `$` 를 걷어낸다 — **지울 자리가 하나로 정해질 때만**.
 *
 * 지금 화면에서 벌어지는 일: 떠돌이 `$` 가 수식 구간을 열어 버려 뒤따르는
 * 선택지 `⏎⏎1. ` 이 통째로 수식으로 조판된다.
 */
export function fixStrayDollar(content: string): StrayDollarResult {
  const text = content ?? "";
  const count = (text.match(/\$/g) ?? []).length;
  if (count % 2 === 0) return { content: text, applied: null, hold: null };
  // 통째로 안 변환된 행은 `$` 만 맞춰도 지면이 안 산다 — 손대지 않는다.
  if (isWholesaleHwpScript(text))
    return { content: text, applied: null, hold: "unresolved" };

  // 1) 피연산자 없이 떠도는 `$LEFT` — `$` 와 잔재를 한 번에 없앤다.
  const withoutLeft = text.replace(/[ \t]*\$LEFT(?![A-Za-z])/, "");
  if (withoutLeft !== text && spansLookLikeMath(withoutLeft))
    return { content: withoutLeft, applied: "stray-LEFT", hold: null };

  // 2) `$` 를 하나씩 지워 보고 **정확히 하나만** 말이 되면 그것을 택한다.
  const candidates: string[] = [];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== "$") continue;
    const next = removeDollarAt(text, i);
    if (spansLookLikeMath(next)) candidates.push(next);
  }
  const unique = [...new Set(candidates)];
  if (unique.length === 1)
    return { content: unique[0], applied: "trailing-dollar", hold: null };

  return { content: text, applied: null, hold: "unresolved" };
}
/* ══════════════════════════════════════════════════════════════════════════
 * 지면에 **날 글자로 나가는 수식** 후보정 (트랙 수식잔재, 2026-08-18)
 *
 * 원장님이 화면에서 직접 찾은 것들 — 전부 스크린샷 근거:
 *   `\htmlClass` · `\overarc` 가 붉은 글씨 · `2^2 × 3times5^3` · `xle-7` · `age2`
 *
 * ## 왜 지금까지 안 잡혔나
 *
 * 1. **세는 쪽과 고치는 쪽이 둘 다 손 목록이었다.** `measure-hwp-latex-residue.py`
 *    도 `hwpeq_unglue.py` 도 키워드를 사람이 적었다. 그래서 `DIVIDE` 를 같이 놓쳤고
 *    (2026-08-17), 이번엔 `le`·`ge`·소문자 `times` 를 같이 놓쳤다.
 *    → 이제 어휘는 `hwpVocab`(정본에서 추출) 하나를 둘이 함께 읽고,
 *      **정본에 없는 잔재는 `census-math-tokens.ts` 가 실측으로 찾는다.**
 * 2. **붉은 글씨는 실패율로 안 잡힌다.** KaTeX 0.16 은 모르는 명령을
 *    `.katex-error` 가 아니라 `color:#cc0000` 으로 그린다. 그래서 이 규칙들은
 *    명령 목록이 아니라 **실제 렌더**(`isUnknownCommand`)로 판정한다.
 *
 * ## 설계 — 못 자르는 것은 지우지 말고 막는다
 *
 * 모든 규칙이 **보류를 먼저** 본다. 특히 `le`/`ge` 는 영어 낱말과 HWP 구조
 * 키워드(`rpile`·`left`)에 그대로 들어 있어 두 겹으로 막는다 —
 *   ① 덩어리 전체가 «한두 글자 + le/ge» 로 **분해되는가**
 *   ② 분해되더라도 정본 키워드(`pile`·`angle`…)를 품고 있지 않은가
 * 실측으로 분해되는 87종을 **전량** 눈으로 봤다. 전부 부등호였다.
 * 분해에 실패한 것 중 `rpilea`·`ballet` 은 부등호가 아니었다 — 검사가 일했다.
 * ══════════════════════════════════════════════════════════════════════════ */

export interface RenderResidueResult {
  content: string;
  /** 적용한 규칙 이름들 (중복 없음, 정렬 안 됨). */
  applied: string[];
  /** 손대지 않고 남긴 사유들. 보고서가 이 목록으로 후속 과제를 만든다. */
  holds: string[];
}

/** 라벨·환경 인자 — 여기 안은 잔재가 아니라 내용이다. */
const PROTECTED_ARG_COMMANDS = [
  "text",
  "mathrm",
  "mathit",
  "mathbf",
  "mathbb",
  "mathcal",
  "mathfrak",
  "mathsf",
  "mathtt",
  "operatorname",
  "mbox",
  "begin",
  "end",
  "htmlClass",
  "htmlId",
  "htmlStyle",
];

const PROTECTED_RE = new RegExp(
  `\\\\(?:${PROTECTED_ARG_COMMANDS.join("|")})\\s*\\{[^{}]*\\}`,
  "g",
);

const SENTINEL = "\u{E010}";

/**
 * 보호 구간(`\text{…}` 등)을 잠시 치우고 나머지에만 `fn` 을 적용한다.
 *
 * 지우는 게 아니라 **가리는** 것이다 — 경계를 확실히 못 자르는 것을 지우면
 * 근거가 사라진다(2026-08-16 교훈).
 */
function outsideProtected(expr: string, fn: (s: string) => string): string {
  const kept: string[] = [];
  const masked = expr.replace(PROTECTED_RE, (whole) => {
    kept.push(whole);
    return `${SENTINEL}${kept.length - 1}${SENTINEL}`;
  });
  return fn(masked).replace(
    new RegExp(`${SENTINEL}(\\d+)${SENTINEL}`, "g"),
    (_m, i: string) => kept[Number(i)]!,
  );
}

/* ── 붉은 글씨: KaTeX 가 못 그리는 명령 ───────────────────────────────── */

/** `\overarc{AB}` — 정본이 `\overarc ↔ arch` 로 맵을 둬 역변환이 내놓지만 KaTeX 엔 없다. */
const OVERARC_RE = /\\overarc(?=\s*\{)/g;
/** `\leftvert x \rightvert` — `LEFT vert` 가 한 낱말로 붙은 잔재. */
const LEFT_VERT_RE = /\\leftvert(?![A-Za-z])/g;
const RIGHT_VERT_RE = /\\rightvert(?![A-Za-z])/g;
/** `120\,\cm` — 단위가 명령이 돼 버린 것. */
const CM_RE = /\\cm(?![A-Za-z])/g;
/** `\A` `\ABCD` — 대문자 라벨에 백슬래시가 붙었다. **아는 명령은 건드리면 안 된다.** */
const UPPER_COMMAND_RE = /\\([A-Z]+)(?![A-Za-z])/g;

/**
 * KaTeX 가 **아는데 뜻이 다른** 명령 — 붉지 않아 렌더 판정이 못 잡는다.
 *
 * `\P` 는 ¶(문단기호), `\S` 는 §(절기호)로 그려진다. 그런데 이 말뭉치에서
 * `\P` 23곳은 **전량이 확률 P(…) 아니면 점 라벨 P** 였다(전수 확인).
 * 지면에는 `¶(1≤Y≤4)=3/8` 이 찍히고 있다 — 붉지 않으니 아무 지표도 안 울렸다.
 *
 * ⚠️ 그래도 무턱대고 바꾸지 않는다. **본문과 독립인 근거**를 하나 요구한다 —
 *    ① 바로 뒤가 `(` · `\left(` (¶ 는 함수 적용을 못 한다), 또는
 *    ② 같은 행에 백슬래시가 붙은 **모르는** 대문자 라벨이 이미 있다(`\A`·`\O`).
 *    둘 다 아니면 손대지 않고 목록에 남긴다.
 */
const TEXT_SYMBOL_COMMAND_RE = /\\([PS])(?![A-Za-z])/g;
const APPLIED_TO_ARGUMENT = /^\s*(?:\(|\\left\s*\()/;

/* ── 조용히 틀리게 그려지는 글자 ──────────────────────────────────────── */

/**
 * 덩어리 전체가 «한두 글자 + le/ge» 로 분해되는가.
 *
 * 두 글자까지 허용하는 이유는 `xyle0`(xy≤0)·`acge0`(ac≥0) 같은 실측 때문이고,
 * 세 글자를 막는 이유는 `rpile`(r·p·i + le) 때문이다. 실측 87종 전량 확인.
 */
const LEGE_DECOMPOSABLE = /^(?:[A-Za-z]{0,2}(?:le|ge))+[A-Za-z]{0,2}$/i;
const LEGE_TOKEN = /le|ge/gi;

/** 맨 곱셈 키워드. 앞뒤가 영문자면 낱말의 일부일 수 있어 건드리지 않는다. */
const TIMES_RE = /(?<![\\A-Za-z])times(?![A-Za-z])/g;
/** HWP `vert` — 정본이 왕복 때문에 일부러 안 되돌린다(`hwpeq_to_latex` 주석). */
const VERT_RE = /(?<![\\A-Za-z])vert(?![A-Za-z])/g;
/** 섭씨·화씨 — `10 CENTIGRADE`, `\left( FAHRENHEIT\right)`. 한 문항에 짝으로 나온다. */
const CENTIGRADE_RE = /(?<![\\A-Za-z])CENTIGRADE(?![A-Za-z])/g;
const FAHRENHEIT_RE = /(?<![\\A-Za-z])FAHRENHEIT(?![A-Za-z])/g;

/**
 * 맨 함수 이름. 정본 `FUNC_MAP` 이 아는 것 중 **글자만으로 이루어지고
 * 변수로 오해될 수 없는** 것만 고른다.
 *
 * 뒤는 제한하지 않는다 — 실측에 `sinx`(붙음) · `cos 30^\circ`(띄움) ·
 * `sin^{2}a`(첨자) · `\dfrac{7}{sin}`(끊김)이 다 있고, **뒤가 영숫자가 아닌 82곳을
 * 전량 눈으로 봤는데 `ln` 을 뺀 전부가 삼각비였다.** 긴 이름을 먼저 둬야
 * `sinh` 가 `sin` 에 먼저 먹히지 않는다.
 */
const FUNCTIONS = [
  "arcsin",
  "arccos",
  "arctan",
  "sinh",
  "cosh",
  "tanh",
  "sin",
  "cos",
  "tan",
  "sec",
  "csc",
  "cot",
  "log",
];
const FUNCTION_RE = new RegExp(
  `(?<![\\\\A-Za-z])(${FUNCTIONS.join("|")})`,
  "g",
);

/**
 * `ln` 만 **뒤에 영숫자가 올 때만** 옮긴다 — `l` 은 흔한 변수라 `l_n` 과 부딪친다.
 *
 * 실측 145곳 중 3곳이 자연로그가 **아니었다**: `n(ln)2` · `y=ln` ·
 * `\dfrac{ln+1}{l_{n}}` — 전부 수열 `l_n` 이다. 반대로 `ln2`·`lnx`·`lnt` 142곳은
 * 전부 자연로그였다(서로 다른 모양 28종 전량 확인). 그래서 경계를 여기에 둔다.
 * ⚠️ 이 lookahead 를 «다른 함수와 통일하려고» 떼지 말 것 — 뜻이 바뀐다.
 */
const LN_RE = /(?<![\\A-Za-z])ln(?=[A-Za-z0-9])/g;
/** 앞 글자에 **붙은** 함수 이름 — 계수인지 변수 이름의 일부인지 못 가른다. */
const GLUED_FUNCTION_RE = new RegExp(
  `(?<![\\\\])[A-Za-z](${FUNCTIONS.join("|")})(?![A-Za-z])`,
  "g",
);

/**
 * 지면에 날 글자로 나가는 수식을 후보정한다. **수식 구간(`$…$`) 안에서만.**
 *
 * 문항의 뜻을 바꾸지 않는다 — 옮기는 자리가 하나로 정해지는 것만 옮기고,
 * 애매하면 `holds` 에 사유를 남기고 그대로 둔다.
 */
export function fixRenderResidue(content: string): RenderResidueResult {
  const text = content ?? "";
  const applied = new Set<string>();
  const holds = new Set<string>();

  if (isWholesaleHwpScript(text)) {
    holds.add("wholesale");
    return { content: text, applied: [], holds: [...holds] };
  }

  // 행 단위 근거 — 이 행에 «백슬래시 붙은 모르는 대문자 라벨»이 하나라도 있으면
  // 같은 행의 `\P`·`\S` 도 같은 이관 사고의 결과로 본다(위 주석 ②).
  UPPER_COMMAND_RE.lastIndex = 0;
  const rowHasLostLabel = [...text.matchAll(UPPER_COMMAND_RE)].some((m) =>
    isUnknownCommand(m[1]!),
  );

  const out = text.replace(/\$([^$]*)\$/g, (_whole, expr: string) => {
    // 라벨·환경 인자를 **가린 채로** 모든 규칙을 돌린다. 지우는 게 아니라 가리는 것이다 —
    // 경계를 확실히 못 자르는 것을 지우면 근거가 사라진다(2026-08-16 교훈).
    const fixed = outsideProtected(expr, (bare) => {
      let e = bare;
      const swap = (
        name: string,
        pattern: RegExp,
        replacement: string | ((...args: string[]) => string),
      ) => {
        const next = e.replace(
          pattern,
          replacement as unknown as (
            substring: string,
            ...args: unknown[]
          ) => string,
        );
        if (next !== e) {
          applied.add(name);
          e = next;
        }
      };

      // 1) 붉은 명령 — 옮길 자리가 하나로 정해지는 것만.
      swap("overarc", OVERARC_RE, "\\overset{\\frown}");
      swap("left/right-vert", LEFT_VERT_RE, "\\left\\vert");
      swap("left/right-vert", RIGHT_VERT_RE, "\\right\\vert");
      swap("cm", CM_RE, "\\mathrm{cm}");

      // 2) 대문자 라벨에 붙은 백슬래시 — **렌더가 모르는 것만** 뗀다.
      //    손 목록을 쓰면 `\Delta`·`\Re`·`\S` 처럼 멀쩡한 명령까지 떼어 더 망친다.
      swap("upper-label", UPPER_COMMAND_RE, (whole: string, name: string) =>
        isUnknownCommand(name) ? name : whole,
      );

      // 2-1) KaTeX 가 아는데 뜻이 다른 `\P`(¶) · `\S`(§) — 근거가 있을 때만.
      {
        const source = e;
        const next = source.replace(
          TEXT_SYMBOL_COMMAND_RE,
          (whole: string, name: string, offset: number) => {
            const after = source.slice(offset + whole.length);
            if (rowHasLostLabel || APPLIED_TO_ARGUMENT.test(after)) return name;
            holds.add("text-symbol-command");
            return whole;
          },
        );
        if (next !== e) {
          applied.add("upper-label");
          e = next;
        }
      }

      // 3) 맨 키워드.
      swap("times", TIMES_RE, "\\times ");
      swap("vert", VERT_RE, "\\vert ");
      swap("centigrade", CENTIGRADE_RE, "^\\circ\\mathrm{C}");
      swap("centigrade", FAHRENHEIT_RE, "^\\circ\\mathrm{F}");
      swap("function", FUNCTION_RE, (_m: string, fn: string) => `\\${fn} `);
      swap("function", LN_RE, "\\ln ");

      GLUED_FUNCTION_RE.lastIndex = 0;
      if (GLUED_FUNCTION_RE.test(e)) holds.add("glued-function");
      GLUED_FUNCTION_RE.lastIndex = 0;

      // 4) `le`/`ge` — 덩어리 단위로 본다. 두 겹으로 막는다(위 주석 참조).
      e = e.replace(/(?<![\\A-Za-z])[A-Za-z]{2,}/g, (run) => {
        if (!/le|ge/i.test(run)) return run;
        if (!LEGE_DECOMPOSABLE.test(run)) {
          holds.add("lege-shape");
          return run;
        }
        const blocked = blockingKeyword(run);
        if (blocked) {
          holds.add(`lege-keyword:${blocked}`);
          return run;
        }
        applied.add("le/ge");
        return run.replace(LEGE_TOKEN, (kw) =>
          kw.toLowerCase() === "le" ? "\\leq " : "\\geq ",
        );
      });

      return e;
    });

    return `$${fixed}$`;
  });

  return { content: out, applied: [...applied], holds: [...holds] };
}
