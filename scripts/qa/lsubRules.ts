/**
 * **왼쪽 아래첨자(`LSUB`)를 순열·조합 표기로** — ₅C₁ 이 `CLSUB5_{1}` 로 나가던 자리.
 *
 * ## 무엇이 나가고 있었나
 *
 * 한국 교과서의 순열·조합은 **아래첨자가 왼쪽에** 붙는다 — ₅P₃ · ₁₀C₂ · ₄H₃ · ₅Π₃.
 * HWP 수식편집기는 그것을 `LSUB` 로 적는데 **정본 변환기가 그 키워드를 모른다**
 * (`F:\시험지변환기\core` 전체에 grep 0). 그래서 그대로 흘러나가 지면에
 * `\mathrm{C}LSUB5_{1}` 이 **글자로** 찍힌다. 실측 97문항 · 203자리.
 *
 * ## 🔴 왜 아무도 못 봤나 — 지표가 **두 겹으로** 눈이 멀었다
 *
 * ㉠ `LSUB` 가 정본 어휘에 없어 `residueRuns` 가 **0**을 냈다.
 * ㉡ 결과가 `\mathrm{LSUB}nC` 라 **라벨 명령 안**으로 들어가, 어휘에 기대지 않는
 *    발견기(`bareRuns` 의 「모르는 것」)에서도 빠졌다.
 *
 * 그래서 이 부류는 「고쳤다」고 세어지면서 그대로 나갔다. 이제 `outsideCanon`
 * 에 적어 두어 **세는 쪽이 볼 수 있다**(`build-hwp-vocab.py` §5).
 *
 * ## 🔴 「그 `\pi` 가 π 인가 Π 인가」는 글자만 보면 모른다 — **셈이 가른다**
 *
 * `\pi LSUB5_{3}-\pi LSUB4_{3}=125-64=61`. 소문자 π 로 읽으면 뜻이 없다.
 * **중복순열 Π** 로 읽으면 ₅Π₃−₄Π₃ = 5³−4³ = 125−64 = 61 — **해설이 적어 둔
 * 숫자와 맞는다.** `SMALLPROD` 도 같은 Π 다.
 *
 * 이 저장소의 규율 그대로다 — **반증은 본문 밖에서 가져와라.** 여기서는 해설이
 * 스스로 답을 적어 주므로 `verifyLsubArithmetic` 이 그 등식을 **실제로 계산해**
 * 검산한다. 글꼴이 가르는 것을 글자로 물으면 답이 없다(2026-08-19).
 */

/** `\mathit{n}`·`\mathrm{16}`·`\,` 를 벗겨 첨자 알맹이만 남긴다. */
function 알맹이(s: string): string {
  let t = s;
  for (let i = 0; i < 3; i++)
    t = t.replace(/\\math(?:it|rm|bf)\s*\{\s*([^{}]*?)\s*\}/g, "$1");
  return t.replace(/\\[,;:!]/g, "").replace(/\s+/g, "");
}

const 첨자 = (s: string) => {
  const t = 알맹이(s);
  return t.length === 1 ? t : `{${t}}`;
};

/**
 * 왼쪽 첨자를 받는 연산 기호.
 * `\pi`·`SMALLPROD` 는 **중복순열 Π** 다 — 위 주석의 셈이 근거다.
 *
 * 🔴 `[PCH]` 앞에 `\b` 를 붙이면 안 된다. 실데이터는 `LSUB4P_{2}` 처럼 **수와
 *    붙어** 있어서 낱말 경계가 없다 — 붙였다가 6자리를 도로 놓쳤다.
 */
const OP = String.raw`(?:\\mathrm\s*\{\s*(?:\\pi\s*|([PCH]))\s*\}|\\pi\s|SMALLPROD|([PCH]))`;
/**
 * 사이에 낄 수 있는 것 — 공백 · `\,` 류 얇은 칸 · `~` · HWP 의 역따옴표 칸.
 * (역따옴표는 템플릿 문자열을 끝내 버리므로 문자 코드로 넣는다.)
 */
const SP = "(?:\\s|\\\\[,;:!]|~|" + String.fromCharCode(96) + ")*";

/**
 * `\mathrm{LSUB}`·`\mathit{\mathrm{LSUB}}` 를 **맨 `LSUB`** 로 되돌린다.
 *
 * 앞머리 변종을 정규식으로 다 받으려 하면 패턴이 읽을 수 없게 된다. `\mathrm{LSUB}`
 * 는 다른 뜻이 없으니 먼저 납작하게 만든 뒤 한 가지 모양만 다룬다.
 */
const 앞정리 = (s: string) =>
  s
    .replace(
      /\\math(?:it|rm|bf)\s*\{\s*\\math(?:it|rm|bf)\s*\{\s*(LSUB|RSUB)\s*\}\s*\}/gi,
      "$1",
    )
    .replace(/\\math(?:it|rm|bf)\s*\{\s*(LSUB|RSUB)\s*\}/gi, "$1");

/** 첨자로 올 수 있는 알갱이 — 수·홑글자, 또는 그것을 감싼 `\mathit{}`. */
const ATOM = String.raw`(?:\\math(?:it|rm|bf)\s*\{\s*[^{}]*?\s*\}|\d+|[A-Za-z])`;
/** 왼쪽 첨자 — 알갱이 하나, 또는 `n-1`·`4+r` 같은 한 번의 덧뺄셈. */
const SUB = `(${ATOM}(?:\\s*[+-]\\s*${ATOM})?)`;
/**
 * 🔴 **패턴 끝에 오는** 왼쪽 첨자는 더 좁게 잡는다.
 *
 * 뒤에 아무것도 안 오면 정규식이 되돌아갈 이유가 없어 **탐욕스럽게 다음 항을
 * 삼킨다.** 실제로 `\mathrm{C}_{0}LSUBn+\mathrm{C}_{1}` 에서 첨자가 `n+\mathrm{C}`
 * 로 잡혀 `{}_{n+C}\mathrm{C}_0_{1}…` 라는 **엉터리**가 나왔다.
 * 부호 뒤에는 **수만** 허용한다(`n-1`·`400` 은 되고 `n+C` 는 안 된다).
 */
const SUB_TAIL = `(${ATOM}(?:\\s*[+-]\\s*\\d+)?)`;
/** 오른쪽 첨자 `_{…}` — 중괄호 **한 겹 중첩**까지 본다(`_{2\mathit{k}+1}`). */
const RSUB = String.raw`_\s*(?:\{((?:[^{}]|\{[^{}]*\})*)\}|(\d|[A-Za-z]))`;

/** `\pi`·`SMALLPROD` 는 Π 로, 나머지는 그 글자 그대로 로만체. */
function opLatex(whole: string, g1?: string, g2?: string): string {
  const g = g1 ?? g2;
  if (g) return String.raw`\mathrm{` + g + "}";
  return String.raw`\Pi `;
}

export interface LsubFix {
  out: string;
  /** 무엇을 바꿨는지 — 조용하지 않게 한다. */
  hits: string[];
}

/**
 * 한 수식 덩어리에서 `LSUB` 표기를 고친다. 다루는 모양은 전부 실데이터에서 왔다:
 *
 * | 들어온 것 | 나가는 것 |
 * | --- | --- |
 * | `\mathrm{C}LSUB5_{1}` · `CLSUB5_{1}` | `{}_{5}\mathrm{C}_{1}` |
 * | `\mathrm{LSUB}4P_{2}` · `\,LSUBn\mathrm{P}_{r}` | `{}_{4}\mathrm{P}_{2}` |
 * | `\mathrm{H}_{3}lsub4` (뒤집힌 꼴) | `{}_{4}\mathrm{H}_{3}` |
 * | `\pi LSUB5_{3}` (중복순열) | `{}_{5}\Pi_{3}` |
 * | `C LSUB {5} _{1}` (날 HWP) | `{}_{5}\mathrm{C}_{1}` |
 *
 * 못 가르는 것은 **손대지 않는다** — `aLSUBn`(수열 aₙ 인지 ₙa 인지 모른다) ·
 * `LSUBCLSUBn_{r}`(LSUB 가 겹쳐 깨졌다) · `LSUP`(자리가 어긋났다).
 */
export function fixLsub(input: string): LsubFix {
  const hits: string[] = [];
  let out = 앞정리(input);
  const 적기 = (m: string) => hits.push(m.replace(/\s+/g, " ").trim());
  const 짓기 = (
    n: string,
    whole: string,
    g1: string | undefined,
    g2: string | undefined,
    rb: string | undefined,
    rp: string | undefined,
  ) => `{}_${첨자(n)}${opLatex(whole, g1, g2)}_${첨자(rb ?? rp ?? "")}`;

  // ⑴ 날 HWP: `C LSUB {5} _{1}` — 중괄호가 살아 있는 꼴.
  out = out.replace(
    new RegExp(`${OP}${SP}LSUB${SP}\\{${SP}${SUB}${SP}\\}${SP}${RSUB}`, "gi"),
    (m, g1, g2, n: string, rb: string, rp: string) => {
      적기(m);
      return 짓기(n, m, g1, g2, rb, rp);
    },
  );

  // ⑵ 연산자 **앞**에 붙은 꼴: `LSUB4P_{2}` · `\,LSUBn\mathrm{P}_{r}`
  out = out.replace(
    new RegExp(`LSUB${SP}${SUB}${SP}${OP}${SP}${RSUB}`, "gi"),
    (m, n: string, g1: string, g2: string, rb: string, rp: string) => {
      적기(m);
      return 짓기(n, m, g1, g2, rb, rp);
    },
  );

  // ⑶ 연산자 **뒤**에 붙은 꼴: `\mathrm{C}LSUB5_{1}` · `CLSUB5_{1}` · `\pi LSUB5_{3}`
  out = out.replace(
    new RegExp(`${OP}${SP}LSUB${SP}${SUB}${SP}${RSUB}`, "gi"),
    (m, g1: string, g2: string, n: string, rb: string, rp: string) => {
      적기(m);
      return 짓기(n, m, g1, g2, rb, rp);
    },
  );

  // ⑷ 첨자가 **뒤에** 오는 뒤집힌 꼴: `\mathrm{H}_{3}lsub4` · `\mathrm{C}_{k}LSUB400`
  out = out.replace(
    new RegExp(`${OP}${SP}${RSUB}${SP}LSUB${SP}${SUB_TAIL}`, "gi"),
    (m, g1: string, g2: string, rb: string, rp: string, n: string) => {
      적기(m);
      return 짓기(n, m, g1, g2, rb, rp);
    },
  );

  return { out, hits };
}

/** 남은 `LSUB` 류가 있는가 — 고친 뒤 확인용. */
export const lsubLeft = (s: string) =>
  (s.match(/LSUB|RSUB|LSUP|RSUP/gi) ?? []).length;

/* ────────────────────────────────────────────────────────────────────────
 * 셈으로 검산 — **본문 밖 근거**
 * ──────────────────────────────────────────────────────────────────────── */

const fact = (n: number): number => (n <= 1 ? 1 : n * fact(n - 1));
const P = (n: number, r: number) => (r > n ? NaN : fact(n) / fact(n - r));
const C = (n: number, r: number) =>
  r > n ? NaN : fact(n) / (fact(r) * fact(n - r));
/** 중복조합 ₙHᵣ = ₙ₊ᵣ₋₁Cᵣ */
const H = (n: number, r: number) => C(n + r - 1, r);
/** 중복순열 ₙΠᵣ = nʳ */
const PI = (n: number, r: number) => n ** r;

export interface ArithCheck {
  /** 검산할 수 있었나 — 수만 든 항이 하나 이상 있고 `=` 뒤에 수가 있나. */
  checked: boolean;
  ok: boolean;
  why: string;
}

/**
 * 고친 결과가 **해설이 적어 둔 값과 맞는가**를 실제로 계산해 본다.
 *
 * 🔴 이것이 이 트랙의 유일한 «본문 밖 근거»다. `\pi` 가 π 인지 Π 인지,
 *    왼쪽 첨자가 n 인지 r 인지는 글자만 봐서는 못 가른다 — 셈이 가른다.
 *    검산할 수 없으면 `checked:false` 다(그 자체는 결함이 아니다).
 */
export function verifyLsubArithmetic(latex: string): ArithCheck {
  // `{}_{5}\mathrm{C}_{1}` 처럼 **양쪽이 다 수**인 항만 계산할 수 있다.
  const TERM =
    /\{\}_\{?(\d+)\}?\s*(?:\\mathrm\{([PCH])\}|\\Pi\s*)_\{?(\d+)\}?/g;
  const terms: { text: string; value: number }[] = [];
  for (const m of latex.matchAll(TERM)) {
    const n = Number(m[1]);
    const r = Number(m[3]);
    const f = m[2] === "P" ? P : m[2] === "C" ? C : m[2] === "H" ? H : PI;
    terms.push({ text: m[0], value: f(n, r) });
  }
  if (terms.length === 0)
    return { checked: false, ok: true, why: "수 항이 없다" };

  /**
   * 🔴 **항이 등식의 «한 변 전부»일 때만** 견준다.
   *
   * 처음엔 「항 바로 뒤에 `=수` 가 오면」으로 했다가 **거짓 경보가 10건** 났다.
   * `₅Π₃-₄Π₃=125-64=61` 에서 `₄Π₃` 뒤에 `=125` 가 오지만 그 125 는 **앞 항의
   * 값**이고, `3\times{}_3H_5=63` 에서도 63 은 곱한 결과다.
   *
   * 거짓 경보는 침묵하는 가드보다 나쁘다 — 다음 사람이 가드를 끈다
   * (CLAUDE.md 2026-08-20). 그래서 **앞도 본다**: 항 왼쪽이 시작·`=`·`#` 일 때만
   * 「이 항 = 저 수」로 읽는다.
   */
  let 검산 = 0;
  let from = 0;
  for (const t of terms) {
    const i = latex.indexOf(t.text, from);
    if (i < 0) continue;
    from = i + t.text.length;
    const head = latex.slice(0, i).replace(/[\s$]|\\[,;:!]|~/g, "");
    if (head !== "" && !/[=#]$/.test(head)) continue; // 한 변 전부가 아니다
    const eq = /^\s*=\s*(\d+)\s*(?:$|[#,.\s])/.exec(latex.slice(from));
    if (!eq) continue;
    검산++;
    if (Number(eq[1]) !== t.value)
      return {
        checked: true,
        ok: false,
        why: `${t.text} 는 ${t.value} 인데 해설은 ${eq[1]} 라고 적었다`,
      };
  }
  return 검산 > 0
    ? { checked: true, ok: true, why: `등식 ${검산}개가 맞는다` }
    : { checked: false, ok: true, why: "견줄 등식이 없다" };
}
