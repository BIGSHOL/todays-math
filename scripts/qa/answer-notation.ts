/**
 * 정답 문자열의 **표기 차이를 걷어내는 정규화 규칙**.
 *
 * 왜 따로 두나: `audit-answers-vs-official.ts` 의 `normalize()` 는 대조 한 곳에서만
 * 쓰는 얕은 규칙이라 값 형태 불일치 1,019건을 못 걷어냈다. 표기 규칙은
 * 분류기(`classify-answer-mismatch.ts`)와 표기 복구(`repair-answer-glyphs.ts`)가
 * 같이 쓰므로 한 곳에 둔다. **규칙마다 왜 안전한지 근거를 적을 것.**
 *
 * ⚠️ 규칙은 **답의 뜻을 바꾸면 안 된다.** 뜻을 바꿀 여지가 있는 것(한글 낱말 제거,
 * 이름표 제거)은 따로 빼서 분류에서 별도 갈래로 보고한다.
 */

const PUA_LO = 0xf081;
const PUA_HI = 0xf085;
const PUA_RANGE = new RegExp(
  `[${String.fromCodePoint(PUA_LO)}-${String.fromCodePoint(PUA_HI)}]`,
  "g",
);

/**
 * HWP 수식·기호폰트의 사용자영역(PUA) 잔재를 원문자 번호로.
 *
 * `U+F081`~`U+F085` 는 ①~⑤ 다. 추측이 아니라 **원본 지면으로 확인했다** —
 * 해당 문항이 있는 시험지 7편의 정답면을 렌더해 96건을 전수 대조했고 전부 일치했다
 * (3369 16건 · 3391 17건 · 3424 18건 · 3798 7건 · 3959 15건 · 4558 14건 · 4767 9건).
 * 그대로 두면 학생 시험지에 **네모 상자(tofu)** 로 인쇄된다.
 */
export function repairGlyphs(value: string): string {
  return value.replace(PUA_RANGE, (ch) =>
    String.fromCodePoint(0x2460 + (ch.codePointAt(0) as number) - PUA_LO),
  );
}

/** 우리 정답에 PUA 원문자가 남아 있는지. 표기 복구 대상 판별용. */
export function hasBrokenGlyph(value: string): boolean {
  return new RegExp(PUA_RANGE.source).test(value);
}

/**
 * 공식 정답면 텍스트가 **글꼴 인코딩 그대로** 흘러나왔는지.
 *
 * 정답면의 기호가 폰트 자체 인코딩으로 박혀 있으면 PyMuPDF 가 제어문자나
 * cp1252 잔재(`ƒ‚„…`)로 뱉는다. 우리 쪽 PUA 와 같은 글리프인데 인코딩만 다르다.
 */
export function hasJunkGlyph(value: string): boolean {
  return /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u0192\u201A\u201E\u2026\uFFFD\uE000-\uF8FF]/.test(
    value,
  );
}

/**
 * LaTeX 표기를 평문 수식으로.
 *
 * 우리 DB 정답 1,492건이 `$...$` 를 달고 있다(AI 백필 산출물). 공식 정답면은
 * 평문이라 그대로 대조하면 전부 어긋난 것으로 잡힌다.
 */
function stripLatex(value: string): string {
  let out = value.replace(/\$/g, "");
  // \frac{a}{b} → (a)/(b) — 중첩은 얕게만 푼다(정답은 대개 한 겹이다).
  for (let i = 0; i < 3; i += 1) {
    out = out.replace(
      /\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g,
      (_m, a: string, b: string) => `(${a})/(${b})`,
    );
    out = out.replace(/\\sqrt\s*\{([^{}]*)\}/g, (_m, a: string) => `√(${a})`);
  }
  out = out
    .replace(/\\(?:times|TIMES)/g, "×")
    .replace(/\\cdot/g, "·")
    .replace(/\\div/g, "÷")
    .replace(/\\pi/g, "π")
    .replace(/\\theta/g, "θ")
    .replace(/\\alpha/g, "α")
    .replace(/\\beta/g, "β")
    .replace(/\\leq?\b/g, "≤")
    .replace(/\\geq?\b/g, "≥")
    .replace(/\\neq\b/g, "≠")
    .replace(/\\pm/g, "±")
    .replace(/\\infty/g, "∞")
    .replace(
      /\\(?:left|right|,|;|!|:|quad|qquad|displaystyle|text|mathrm|rm|bf|it)/g,
      "",
    )
    .replace(/\\sqrt/g, "√")
    .replace(/\\overline/g, "")
    .replace(/\\[a-zA-Z]+/g, "");
  // `x^{2}` `x^2` `x^(12-5r)` `a_{n}` `a_n` → `x2` `x12-5r` `an`
  // 공식 정답면은 위첨자가 통째로 평문이 되어 나오므로 우리 쪽도 평문으로 낮춰야 맞춰진다.
  out = out
    .replace(/[\^_]\s*\{([^{}]*)\}/g, "$1")
    .replace(/[\^_]\s*\(([^()]*)\)/g, "$1")
    .replace(/[\^_]\s*([0-9a-zA-Z+-]+)/g, "$1");
  // HWP→텍스트 변환이 남긴 중괄호·백틱·물결 — 값에는 뜻이 없다.
  return out.replace(/[{}`~]/g, "").replace(/(?<=[0-9])rm(?=[0-9])/g, "");
}

/**
 * 정답 뒤에 붙은 **출처 주석**을 뗀다.
 *
 * 학원이 문항을 재사용하며 `③ 현풍고 23-1-기말 12번` 처럼 출처를 적어 둔 편이 있다.
 * `출처:` 접두어가 있는 것도 없는 것도 있어 학교명+회차+번 꼴을 통째로 본다.
 * 실측 24건. 답 자체에 `학교명 24-2-중간 6번` 꼴이 나올 수 없어 오탐 여지가 없다.
 */
export function stripSourceNote(value: string): string {
  return value
    .replace(/\s*출처\s*[:：].*$/, "")
    .replace(
      /\s*[가-힣]{2,10}\s*\d{2}\s*-\s*\d\s*-\s*(?:중간|기말)[^0-9]{0,4}\d{1,2}\s*번\s*$/,
      "",
    )
    .trim();
}

/**
 * 표기 차이만 걷어낸 비교용 문자열. **뜻은 그대로 둔다.**
 *
 * 흡수하는 것 — 근거는 전부 실측 표본이다:
 * - PUA 원문자(`U+F083` ↔ `③`)
 * - 분수 가로선 잔재(`√⁄5` ↔ `√5`). 정답면의 근호 윗줄이 별도 글리프(U+2044)로 빠진다.
 * - 도·퍼센트가 다른 글리프로 나온 것(`12≅` ↔ `12°`, `114≠` ↔ `114%`)
 * - 위·아래 첨자(`x²`↔`x2`, `aₙ`↔`an`, `x^{2}`↔`x2`) — NFKC 가 흡수한다
 * - LaTeX 래퍼(`$2e^{2}+1$` ↔ `2e2+1`)
 * - 공백·쉼표·마침표·콜론, 곱셈점
 *
 * ⚠️ NFKC 는 원문자도 평문으로 바꾼다(`③`→`3`, `⑴`→`(1)`). 대조에는 그게 편하지만
 * **원문자 개수를 세려면 `canon` 을 쓰면 안 된다** — `circledSet` 은 원문을 본다.
 */
export function canon(value: string): string {
  let out = repairGlyphs(value);
  // 정답면 글꼴에서 도(°)가 `≅`, 퍼센트(%)가 `≠` 로 나온다. 실측 7건.
  // 숫자 바로 뒤일 때만 바꾼다 — `a≠-1` 같은 진짜 부등호를 건드리면 안 된다.
  out = out.replace(/(?<=[0-9])≅/g, "°").replace(/(?<=[0-9])≠(?![0-9])/g, "%");
  out = out.normalize("NFKC");
  out = stripLatex(out);
  // 근호 뒤의 분수 가로선 잔재. 근호가 아닌 자리의 `⁄` 는 진짜 나눗셈이라 `/` 로 둔다.
  out = out.replace(/√\s*⁄/g, "√").replace(/⁄/g, "/");
  out = out.replace(/[·⋅∙×]/g, "*");
  out = stripSourceNote(out);
  return out
    .replace(/[,\s:：]/g, "")
    .replace(/[.]+$/, "")
    .trim();
}

/** 원문자 정답의 집합. `③, ④` → `["③","④"]`. NFKC 를 거치지 않는다. */
export function circledSet(value: string): string[] {
  return (repairGlyphs(value).match(/[①②③④⑤⑥⑦⑧⑨⑩]/g) ?? []).sort();
}

/**
 * `-0` `+3` 같은 부호 표기와 `1.0`/`1`, 분수와 소수를 흡수한 수치 비교용.
 *
 * `1/25` 와 `0.04`, `85/2` 와 `42.5` 는 같은 답이다 — 공식면은 소수로,
 * 우리는 분수로 적은 편이 있다.
 */
export function numericKey(value: string): string | null {
  const t = canon(value).replace(/^\+/, "");
  const frac = /^([-+]?\d+)\/(\d+)$/.exec(t);
  if (frac) {
    const n = Number(frac[1]) / Number(frac[2]);
    return Number.isFinite(n) ? String(Number(n.toPrecision(10))) : null;
  }
  if (!/^[-+]?\d+(?:\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? String(Number(n.toPrecision(10))) : null;
}

/**
 * 뒤에 붙은 **단위**를 뗀다. 값 자체는 건드리지 않는다.
 *
 * `4π cm²` ↔ `4π`, `2π cm^3/s` ↔ `2π`, `258개` ↔ `258`.
 * 공식 정답면은 단위를 자주 생략하고 우리 답은 붙여 쓴다. 단위 유무는 표기 차이지만
 * **지면에 인쇄되는 형식**이라 통일 여부는 원장님 판단이다(여기선 분류만 한다).
 */
const LATIN_UNIT =
  "(?:cm|mm|km|kg|mg|mL|ml|[a-zA-Z]?m|[a-zA-Z]?g|[a-zA-Z]?L|s|°|%)(?:[23])?(?:/s)?";
const KOREAN_UNIT =
  "(?:개월|가지|시간|자루|그루|마리|켤레|송이|개|명|권|장|번|회|쪽|원|점|초|분|일|년|도|배|편|살)+";
export function stripUnits(value: string): string {
  let out = canon(value);
  for (let i = 0; i < 2; i += 1) {
    out = out
      // 괄호로 묶은 단위 — `3√3-3(cm)`, `342(명)`
      .replace(new RegExp(`(?<=[0-9)πθ√])\\((?:${LATIN_UNIT}|${KOREAN_UNIT})\\)$`), "")
      .replace(new RegExp(`(?<=[0-9)πθ√])${LATIN_UNIT}$`), "")
      .replace(new RegExp(`(?<=[0-9)πθ√])${KOREAN_UNIT}$`), "")
      .trim();
  }
  return out;
}

/** 식 전체를 감싼 겉괄호를 뗀다. `(3√3-3)` ↔ `3√3-3` — 값은 같다. */
export function stripOuterParens(value: string): string {
  let out = canon(value);
  for (let i = 0; i < 3; i += 1) {
    if (!/^\(.*\)$/.test(out)) break;
    // 겉괄호가 정말 한 쌍인지 — `(a+b)(c+d)` 를 잘못 벗기면 안 된다.
    let depth = 0;
    let wraps = true;
    for (let k = 0; k < out.length; k += 1) {
      if (out[k] === "(") depth += 1;
      if (out[k] === ")") depth -= 1;
      if (depth === 0 && k < out.length - 1) {
        wraps = false;
        break;
      }
    }
    if (!wraps) break;
    out = out.slice(1, -1);
  }
  return out;
}

/**
 * 부등호가 이어진 답을 **한 방향으로** 맞춘다. `2⁵⁰<7²⁰<3⁴⁰<5³⁰` ↔ `5³⁰>3⁴⁰>7²⁰>2⁵⁰`.
 *
 * 크기 비교 문항은 어느 쪽에서 읽어도 같은 답이다. 방향이 섞인 것(`a<b>c`)은
 * 뜻이 다르므로 건드리지 않는다.
 */
export function normalizeInequalityChain(value: string): string | null {
  const t = canon(value);
  const hasLt = /</.test(t);
  const hasGt = />/.test(t);
  if (hasLt === hasGt) return null;
  const terms = t.split(/[<>]/);
  if (terms.length < 3) return null;
  return (hasGt ? terms.reverse() : terms).join("<");
}

/** 단위·조사 등 **한글 낱말**까지 떼어낸 느슨한 비교용. 뜻을 바꿀 수 있어 갈래를 나눠 보고한다. */
export function canonLoose(value: string): string {
  let out = canon(value);
  // 범위·집합 표기의 뜻을 담은 낱말은 기호로 바꾼 뒤에 한글을 뗀다.
  out = out.replace(/또는|이거나|혹은/g, "|");
  out = out.replace(/그리고|이고/g, "&");
  // 한글이 든 괄호 묶음은 부연 설명이다 — `42(a=32,b=10)` 이 아니라 `50(분)후`.
  out = out.replace(/\([^()]*[가-힣][^()]*\)/g, "");
  out = out.replace(/[가-힣]+/g, "");
  return out.trim();
}

/**
 * `f(x)=3x+1` 을 이름표(`f(x)`)와 값(`3x+1`)으로 가른다. 이름표가 없으면 `label` 이 빈 문자열.
 *
 * ⚠️ **이름표를 그냥 떼면 `x=4` 와 `y=4` 가 같아진다.** 그래서 떼는 판단은
 * 짝을 지어서 한다(`labelAwareEqual`) — 여기서는 가르기만 한다.
 */
export function splitLabel(value: string): { label: string; body: string } {
  const t = canon(value);
  const none = { label: "", body: t };
  // 부등식·범위(`0≤a<2`)는 등호 왼쪽이 답의 일부다.
  if (/[<>≤≥≠]/.test(t)) return none;
  const eq = t.split("=");
  if (eq.length !== 2) return none;
  const [lhs, rhs] = eq;
  if (!lhs || !rhs) return none;
  // 왼쪽이 짧고 글자를 품은 식일 때만 이름표로 본다 (`a+b=8`, `∠x-∠y=66°`, `A∪B={…}`).
  if (lhs.length > 12) return none;
  if (!/[A-Za-z가-힣∠△∪∩㉠-㉻]/.test(lhs)) return none;
  // 숫자로 시작하면 이름표가 아니라 식이다 — `8x=49` 의 답은 49 가 아니라 49/8 이다.
  if (/^\d/.test(lhs)) return none;
  return { label: lhs, body: rhs };
}

export function stripLabel(value: string): string {
  return splitLabel(value).body;
}

/**
 * 이름표를 고려한 같음 판정.
 *
 * 값이 같아도 **양쪽 다 이름표가 있고 그 이름표가 다르면 다른 답이다**
 * (`x=4` ↔ `y=4`). 한쪽에만 이름표가 있으면 표기 차이로 본다 (`4` ↔ `k=4`).
 */
export function labelAwareEqual(a: string, b: string): boolean {
  const left = splitLabel(a);
  const right = splitLabel(b);
  if (left.body === "" || left.body !== right.body) return false;
  if (left.label && right.label) return left.label === right.label;
  return true;
}

/**
 * 쉼표·`또는` 으로 갈린 답을 조각으로 쪼갠다.
 *
 * 괄호 안의 쉼표는 좌표(`(2,-12)`)라 쪼개면 안 된다 — **괄호 밖 쉼표만** 본다.
 */
export function answerPieces(
  value: string,
): Array<{ label: string; body: string }> {
  const t = stripSourceNote(value.normalize("NFKC")).replace(
    /또는|이거나|혹은/g,
    ",",
  );
  const raw: string[] = [];
  let depth = 0;
  let buf = "";
  for (const ch of t) {
    if (ch === "(" || ch === "{" || ch === "[") depth += 1;
    if (ch === ")" || ch === "}" || ch === "]") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      raw.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  raw.push(buf);
  return raw
    .map((piece) => splitLabel(stripUnits(piece)))
    .filter((piece) => piece.body !== "");
}

/**
 * 여러 값으로 이뤄진 답이 **순서만 다른지**.
 *
 * `x=3 또는 x=-3` ↔ `x=-3 또는 x=3`, `3+√3, 7-4√3` ↔ `x=7-4√3, y=3+√3`.
 * 양쪽 다 이름표가 붙어 있으면 이름표까지 맞춰 본다 — 안 그러면
 * `x=4,y=2` 와 `x=2,y=4` 가 같아진다(값을 맞바꾼 진짜 오답이 숨는다).
 */
export function pieceSetEqual(a: string, b: string): boolean {
  const left = answerPieces(a);
  const right = answerPieces(b);
  if (left.length < 2 || left.length !== right.length) return false;
  const bothLabeled = left.every((p) => p.label) && right.every((p) => p.label);
  const key = (p: { label: string; body: string }) =>
    bothLabeled ? `${p.label}=${p.body}` : p.body;
  const l = left.map(key).sort();
  const r = right.map(key).sort();
  return l.every((v, i) => v === r[i]);
}

/**
 * 소문항(`⑴ … ⑵ …`)을 번호별로 가른다. 번호가 없으면 빈 Map.
 *
 * 공식 정답면은 `⑴ 64 ⑵ 225` 처럼 값만 적고 우리 답은 `⑴ x²=64` 처럼 식을 적는다.
 * 번호별로 맞춰 봐야 **어느 소문항이** 어긋났는지 알 수 있다.
 */
export function parts(value: string): Map<string, string> {
  // ⚠️ 쪼개기는 `canon` **앞에서** 한다. canon 이 공백을 지우면 `1) A=30 2) B=6` 의
  // 둘째 머리가 `A=302)` 에 묻혀 소문항이 하나로 보인다(실측 오판정).
  const t = repairGlyphs(value).normalize("NFKC").replace(/\$/g, "");
  const out = new Map<string, string>();
  const head = /(?:^|[\s,、])\(?(\d{1,2}(?:-\d{1,2})?)\)/g;
  const hits = [...t.matchAll(head)];
  for (let i = 0; i < hits.length; i += 1) {
    const start = (hits[i].index ?? 0) + hits[i][0].length;
    const end = i + 1 < hits.length ? (hits[i + 1].index ?? t.length) : t.length;
    out.set(hits[i][1], canon(t.slice(start, end)));
  }
  return out;
}

/** 그 소문항의 답이 지면에 안 실렸다는 뜻인지 — `풀이 참조` `해설참조`. */
export function isSeeSolution(value: string): boolean {
  return /(?:풀이|해설)\s*참[조고]|^\s*참조|생략/.test(value);
}

/**
 * `$답$$풀이…` 처럼 **답 뒤에 풀이가 붙어 버린** 우리 정답에서 답만 떼어낸다.
 *
 * AI 백필 산출물 일부가 그렇다 — `$12$$f(x)=3x+`, `$2 sqrt {6}$풀이)`.
 * 첫 `$…$` 안이 답이고 뒤는 잘린 풀이다. 첫 묶음이 없으면 null.
 */
export function firstLatexAtom(value: string): string | null {
  const m = /^\s*\$([^$]{1,40})\$(?=\s*(?:\$|풀이))/.exec(value);
  return m ? m[1] : null;
}
