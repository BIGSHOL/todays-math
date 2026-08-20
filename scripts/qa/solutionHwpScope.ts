/**
 * **어느 수식 덩어리를 변환해도 되는가** — 해설의 날 HWP 스크립트 트랙의 첫 가드.
 *
 * ## 🔴 이미 LaTeX 인 덩어리를 다시 변환하면 **부서진다**
 *
 * 정본 변환기에 이미 변환된 LaTeX 를 넣어 보면(실측):
 *
 * | 넣은 것 | 나온 것 |
 * | --- | --- |
 * | `\frac{5}{16}` | `\frac516` — **중괄호가 사라진다** |
 * | `\triangle \mathrm{ABC}` | `\\triangle \mathrmABC` — 역슬래시가 겹친다 |
 * | `\begin{cases}…` | 통째로 뭉개진다 |
 * | `\lim _{x\to 0}` | `\lim _{x\^{0}}` |
 *
 * **에러는 하나도 안 난다.** 그리고 대상 행은 **섞여 있다** — 한 해설 안에
 * 이미 LaTeX 인 덩어리와 날 HWP 인 덩어리가 같이 있다.
 *
 * ## 가르는 열쇠는 «역슬래시가 있는가»
 *
 * HWP 수식 스크립트에는 역슬래시가 없다(`LEFT ( 3x ^{2} +ax-5 RIGHT )`).
 * 그러니 **역슬래시가 하나라도 있으면 이미 손댄 덩어리**이고, 변환기의 파괴
 * 모드가 정확히 그 자리에서 일어난다. 문턱이 아니라 **파괴 조건 그 자체**다.
 *
 * 못 가르는 것(둘이 섞인 덩어리)은 **버리는 쪽**으로 둔다 — 2026-08-18 근호와
 * 같은 규율이다. 멀쩡한 한 건을 못 고치더라도 부서진 한 건을 만들지 않는다.
 */
import { blockingKeyword, isCanonicalHwpToken } from "./hwpVocab";
import { bareRuns } from "./mathTokenCensus";

/** 수식 안의 «두 글자 이상 영문 덩어리». 어휘에 기대지 않고 전부 센다. */
const RUNS = /(?<![\\A-Za-z])([A-Za-z]{2,})(?![A-Za-z])/g;

export type SpanVerdict =
  | { convert: true; keywords: string[] }
  | { convert: false; why: "latex" | "잔재없음" };

/** 이 덩어리를 변환해도 되는가. */
export function judgeSpan(body: string): SpanVerdict {
  if (body.includes("\\")) return { convert: false, why: "latex" };
  const keywords: string[] = [];
  for (const m of body.matchAll(RUNS)) {
    const run = m[1]!;
    if (isCanonicalHwpToken(run) || blockingKeyword(run)) keywords.push(run);
  }
  if (keywords.length === 0) return { convert: false, why: "잔재없음" };
  return { convert: true, keywords };
}

export interface ScopeResult {
  /** 변환할 덩어리가 하나라도 있는가. */
  any: boolean;
  convert: number;
  latex: number;
  clean: number;
  keywords: string[];
}

/** 한 컬럼 전체를 훑어 «변환 대상 덩어리»를 센다. */
export function scopeOf(text: string): ScopeResult {
  let convert = 0;
  let latex = 0;
  let clean = 0;
  const keywords: string[] = [];
  for (const m of text.matchAll(/\$([^$]*)\$/g)) {
    const v = judgeSpan(m[1]!);
    if (v.convert) {
      convert++;
      keywords.push(...v.keywords);
    } else if (v.why === "latex") latex++;
    else clean++;
  }
  return { any: convert > 0, convert, latex, clean, keywords };
}

/**
 * **고친 뒤**에 잔재가 남았는가 — `scopeOf` 와 **다른 질문**이다.
 *
 * 🔴 왜 따로 있나: `scopeOf` 는 「역슬래시가 있으면 이미 LaTeX」로 본다. 그 규칙을
 *    결과에 그대로 대면 **구조적으로 0**이 된다 — 변환한 덩어리에는 역슬래시가
 *    반드시 있기 때문이다. 실제로 `sqrt {3} of 3` → `\sqrt{3}of3` 의 날 `of` 를
 *    못 잡았다(2026-08-21). 「지표가 실패를 셀 수 있는 형태인가」의 그 자리다.
 *
 *    그래서 결과는 **명령 이름을 지우고 남은 맨 글자 덩어리**로 본다 —
 *    잔재 계량기(`census-math-tokens.ts`)가 쓰는 것과 **같은 `bareRuns`** 다.
 *    세는 쪽과 고치는 쪽이 한 함수를 본다.
 */
export function residueRuns(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\$([^$]*)\$/g)) {
    for (const r of bareRuns(m[1]!)) {
      if (r.inLabelCommand) continue; // `\mathrm{AB}` 안의 라벨은 잔재가 아니다
      if (isCanonicalHwpToken(r.run) || blockingKeyword(r.run)) out.push(r.run);
    }
  }
  return out;
}
