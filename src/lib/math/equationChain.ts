/**
 * 계산 과정 다단 등식 — `A = B = C` 를 단계마다 줄바꿈한다.
 *
 * 원장님(2026-08-18): "이런 문제는 좀 심각하네. 다음 계산 과정이 너무 줄바꿈 하나도
 * 처리 안되어있음". 교과서는 이런 계산을 `=` 앞에서 줄을 바꿔 세로로 쌓는다.
 *
 * ── 이 규칙의 위험은 «자르면 안 되는 것»이다 ───────────────────────────────
 * 전수 실측(47,152건). 「한 수식에 `=` 가 2개 이상」으로 세면 2,724건(5.78%)인데
 * 표본을 눈으로 보니 **거의 전부 오탐**이었다 — 나열(`$y=ax,~y=bx$`)·연립방정식·
 * 주어진 조건(`$\overline{AE}=\overline{BF}=a$`). 거기서 줄을 바꾸면 **문제가
 * 달라 보인다.** 쉼표로 갈리는 것을 빼면 970건(2.06%), 여기에 아래 두 조건을
 * 더하면 실제 대상은 **수식 40개 남짓**이다.
 *
 * 그래서 넷을 **동시에** 요구한다:
 *  ① 쉼표로 갈리지 않고 **잇따르는** `=` 가 있다 (나열·연립은 쉼표가 가른다)
 *  ② 그 `=` 가 괄호·중괄호·`\left…\right` **밖**이다 (`(x=0,1,2)` 는 첨언이다)
 *  ③ HWP 변환 잔재가 없다 — **이미 깨진 수식을 자르면 더 깨진다.**
 *  ④ **본문과 독립인 근거**가 하나 있다(CLAUDE.md 2026-08-17) — 둘 중 하나:
 *     · 문항이 스스로 «계산 과정»이라고 말한다 (`…하는 과정이다`, `isWorkedProcess`)
 *     · 또는 수식이 문항 열보다 넓어 **어차피 아무 데서나 접힌다**
 *    이 근거가 없으면 이음이 있어도 두 손 뗀다. `$\overline{AE}=\overline{BF}=a$`
 *    처럼 «주어진 조건»인 이음이 훨씬 많기 때문이다.
 *
 * 자르는 자리는 언제나 수식 span **경계를 새로 만드는 것**이라, 조각마다 `$` 짝이
 * 맞고 중괄호가 균형을 이룬다. 균형이 안 맞으면 아예 자르지 않는다.
 */
import { displayWidth } from "@/lib/math/displayWidth";

/**
 * 문항 열 한 줄에 들어가는 표시폭.
 * ⚠️ `printOverflow.ts` 의 `COLUMN_UNITS` 와 같은 값이어야 한다 — 둘이 갈라지면
 * 「판정은 넘친다는데 지면은 안 넘친다」가 된다.
 */
export const CHAIN_COLUMN_UNITS = 59;

/**
 * HWP 수식 스크립트가 LaTeX 로 못 옮겨진 흔적. 남아 있으면 이미 깨진 수식이다.
 * (CLAUDE.md 2026-08-16 «KaTeX 가 초록이라고 지면이 멀쩡한 게 아니다» — 이 부류는
 *  KaTeX 가 오류로 보지 않고 날 문자로 그대로 그린다.)
 */
const HWP_RESIDUE_RE =
  /\bbox\s*\{|(?<!\\)\bover\b|(?<!\\)\btimes\b|(?<!\\)\bsqrt\b|HK\||JLM|LSUB|CDOTS|``/;

interface Mark {
  index: number;
  kind: "equals" | "comma";
}

/**
 * 최상위(모든 괄호 밖)의 `=` 와 `,` 자리. 균형이 깨지면 null.
 *
 * 괄호를 **네 종류 다** 세는 것이 핵심이다. 중괄호만 세면
 * `\mathrm{P}(X=x)=f(x)~(x=0,1,2)` 의 마지막 `=` 가 최상위로 보여 첨언을 계산
 * 단계로 자른다. `\{`·`\left\{` 도 마찬가지다 — 집합 표기 안이 최상위로 보였다.
 */
function scanTopLevel(inner: string): Mark[] | null {
  const marks: Mark[] = [];
  let depth = 0;
  let leftDepth = 0;

  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i]!;

    if (ch === "\\") {
      if (inner.startsWith("\\left", i)) {
        leftDepth += 1;
        i += "\\left".length - 1;
      } else if (inner.startsWith("\\right", i)) {
        leftDepth -= 1;
        i += "\\right".length - 1;
      } else if (inner[i + 1] === "{" || inner[i + 1] === "[") {
        depth += 1;
        i += 1;
      } else if (inner[i + 1] === "}" || inner[i + 1] === "]") {
        depth -= 1;
        i += 1;
      } else {
        i += 1; // 그 밖의 이스케이프는 한 글자 건너뛴다 (`\,` `\;` `\\`)
      }
      if (depth < 0 || leftDepth < 0) return null;
      continue;
    }

    if (ch === "{" || ch === "(" || ch === "[") depth += 1;
    else if (ch === "}" || ch === ")" || ch === "]") {
      depth -= 1;
      if (depth < 0) return null;
    } else if (depth !== 0 || leftDepth !== 0) continue;
    else if (ch === ",") marks.push({ index: i, kind: "comma" });
    else if (ch === "=") {
      // `\ne`·`<=`·`:=` 같은 합성 기호의 일부는 계산 단계가 아니다.
      const prev = inner[i - 1];
      const next = inner[i + 1];
      if (prev === "<" || prev === ">" || prev === "!" || prev === ":")
        continue;
      if (next === "=") return null; // `==` 는 OCR 잔재다 — 손대지 않는다
      marks.push({ index: i, kind: "equals" });
    }
  }

  return depth === 0 && leftDepth === 0 ? marks : null;
}

/**
 * 잇따르는 `=` 가 2개 이상이고 **최상위 쉼표가 하나도 없는가.**
 *
 * ⚠️ 처음엔 「쉼표가 **사이에** 없으면 이음」으로 느슨하게 봤다. 그랬더니
 * `$\overline{AE}=\overline{EG}=\square (마),~\overline{ED}=\overline{FC}=\square$`
 * 를 잘라 **`=\square (마),~\overline{ED}`** 라는 조각이 나왔다 — 앞 문장의 꼬리와
 * 뒤 문장의 머리가 한 줄에 붙는다(실측 0ab25c6b). 쉼표가 하나라도 있으면
 * 그 수식은 **여러 문장**이므로 통째로 손대지 않는다.
 */
function hasChain(marks: readonly Mark[]): boolean {
  if (marks.some((m) => m.kind === "comma")) return false;
  return marks.filter((m) => m.kind === "equals").length >= 2;
}

/**
 * 계산 단계라면 어느 한 단계는 **볼 만한 크기**여야 한다.
 *
 * `$\overline{BF}=\overline{FH}=x$` 처럼 원자 기호만 잇따르는 것은 «계산 과정»이
 * 아니라 **주어진 관계**다. 세 줄로 쌓으면 오히려 읽기 나빠진다(실측 0ab25c6b).
 * 반대로 `$\frac{9}{250}=\frac{9}{2\times 5^{3}}=\cdots$` 는 단계마다 분수가 있어
 * 한 줄에 다 넣으면 못 읽는다. 가장 넓은 단계의 표시폭으로 가른다.
 */
const MIN_WIDEST_STEP = 8;

/** 조각 하나가 계산 단계로 쓸 만한가 — 빈 조각·기호뿐인 조각은 안 된다. */
function usableStep(body: string): boolean {
  return body.replace(/[\s~=]|\\[,;:!]/g, "").length > 0;
}

/**
 * 문항이 스스로 «계산 과정»이라고 말하는가.
 *
 * 이것이 이 수리의 **독립 근거**다. 이음만 보고 자르면 주어진 조건까지 쪼개진다.
 * 실측: 「…과정이다」류 문구가 있는 문항 456건(0.97%).
 */
/**
 * ⚠️ `계산 과정` 이라는 낱말만으로 판정하면 안 된다 — 「**풀이 과정을** 자세히
 * 서술하시오」·「계산 과정을 반드시 적을 것」은 학생에게 시키는 **지시문**이지
 * 지면에 실린 계산이 아니다. 자기 서술형 종결(`…과정이다`)만 근거로 쓴다.
 */
const WORKED_PROCESS_RE =
  /과정이다|과정을\s*나타낸\s*것이다|과정이\s*다음과\s*같다/;

export function isWorkedProcess(question: string): boolean {
  return WORKED_PROCESS_RE.test(question);
}

export interface ChainOptions {
  /**
   * 문항이 스스로 «계산 과정»이라고 말했는가(`isWorkedProcess`).
   * true 면 폭이 좁아도 자른다 — 교과서는 계산 과정을 단계마다 줄바꿈한다.
   */
  workedProcess?: boolean;
}

/**
 * 인라인 수식 span 하나를 계산 단계로 나눈다. 나눌 게 없으면 **null**.
 *
 * 돌려주는 조각은 각각 완결된 `$…$` 다 — 두 번째부터는 `=` 로 시작한다
 * (교과서 조판: 등호를 줄머리에 둔다).
 */
export function splitEquationChain(
  span: string,
  options: ChainOptions = {},
): string[] | null {
  if (!span.startsWith("$") || !span.endsWith("$")) return null;
  if (span.startsWith("$$")) return null; // 블록 수식은 이미 제 줄을 가진다
  const inner = span.slice(1, -1);
  if (inner.length === 0) return null;

  if (/\\begin\{/.test(inner)) return null; // 여러 줄 환경은 이미 제 줄을 가진다
  if (HWP_RESIDUE_RE.test(inner)) return null; // 이미 깨진 수식

  const marks = scanTopLevel(inner);
  if (marks === null) return null;
  if (!hasChain(marks)) return null;
  // 독립 근거 — 문항이 계산 과정이라고 말했거나, 어차피 열을 넘어 접힌다.
  if (!options.workedProcess && displayWidth(span) <= CHAIN_COLUMN_UNITS)
    return null;

  const cuts = marks.filter((m) => m.kind === "equals").map((m) => m.index);
  const bounds = [0, ...cuts, inner.length];
  const pieces: string[] = [];
  for (let i = 0; i < bounds.length - 1; i += 1) {
    const body = inner.slice(bounds[i]!, bounds[i + 1]!);
    // 맨 앞 조각이 비어 있으면(수식이 `=` 로 시작) 건너뛴다 — 잘못이 아니다.
    if (i === 0 && body.trim().length === 0) continue;
    if (!usableStep(body)) return null;
    pieces.push(`$${body.trim()}$`);
  }
  if (pieces.length < 2) return null;
  // 원자 기호만 잇따르는 «주어진 관계»는 쌓지 않는다.
  const widest = Math.max(...pieces.map((p) => displayWidth(p)));
  if (widest < MIN_WIDEST_STEP) return null;
  return pieces;
}
