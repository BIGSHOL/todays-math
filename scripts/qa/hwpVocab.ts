/**
 * HWP 수식 키워드 **정본 어휘** — 세는 쪽과 고치는 쪽이 함께 읽는 한 곳.
 *
 * ## 왜 이 파일이 있나
 *
 * 잔재를 세는 쪽(`measure-hwp-latex-residue.py`)도, 고치는 쪽(`hwpeq_unglue.py`)도
 * 키워드를 **손으로 나열**했다. 그래서 둘이 **같이 눈이 멀었다** —
 *   · 2026-08-17 `DIVIDE` 를 둘 다 못 봤다 (지면에 `aDIVIDEb` 가 나갔다).
 *   · 2026-08-18 `le`·`ge`·소문자 `times` 를 둘 다 못 봤다 (원장님 스크린샷).
 * **손 목록은 반드시 샌다.** 그래서 목록을 사람이 쓰지 않는다.
 *
 * 어휘의 출처는 `scripts/qa/hwp-vocab.json` 이고, 그 파일은
 * `scripts/qa/build-hwp-vocab.py` 가 변환기 정본(`F:\시험지변환기\core`)의
 * 맵을 **import 해서** 만든다. 정본이 바뀌면 스크립트를 다시 돌린다.
 *
 * ## 정본도 못 보는 것이 있다
 *
 * 정본 `SYMBOL_MAP` 은 `\le`·`\leq` → `LEQ` **한 방향**이라 역매핑 키가 `LEQ` 뿐이다.
 * HWP 가 실제로 쓰는 짧은꼴 `le`·`ge` 는 역매핑에 없어 토큰째 흘러나간다.
 * 그러니 정본만 믿어도 샌다 — 그래서 `census-math-tokens.ts` 가 **실측으로**
 * 정본 밖 잔재를 계속 새로 찾고, 확정된 것만 `outsideCanon` 에 실린다.
 */
import vocab from "./hwp-vocab.json";

/** 변환기 맵의 HWP 쪽 토큰 (알파벳만). `TIMES` · `LEQ` · `sin` … */
export const HWP_TOKENS: readonly string[] = vocab.hwpTokens;

/** HWP 토큰 → LaTeX 역매핑. 변환기가 **되돌릴 수 있는** 것들. */
export const HWP_REVERSE: Readonly<Record<string, string>> = vocab.reverse;

/** 구조 키워드 — 되돌리려면 피연산자 경계를 알아야 하는 것들 (`over` · `pile` …). */
export const HWP_STRUCT: readonly string[] = vocab.struct;

/** HWP 가 붙여 쓰는 접두 (`RMABC` · `TIMES5`). */
export const HWP_GLUE_PREFIX: readonly string[] = vocab.gluePrefix;

/** 정본 역매핑에 **없는데** 실데이터에 있는 잔재. 근거는 census 다. */
export const OUTSIDE_CANON: Readonly<
  Record<string, { latex: string; why: string }>
> = vocab.outsideCanon;

const TOKEN_SET = new Set(HWP_TOKENS.map((t) => t.toLowerCase()));
const STRUCT_SET = new Set(HWP_STRUCT.map((t) => t.toLowerCase()));

/** 이 낱말이 정본 어휘에 있는 HWP 키워드인가 (대소문자 무시). */
export function isCanonicalHwpToken(token: string): boolean {
  const t = token.toLowerCase();
  return TOKEN_SET.has(t) || STRUCT_SET.has(t);
}

/**
 * `le`/`ge` 치환을 **막아야 하는** 키워드가 이 영문 덩어리 안에 있는가.
 *
 * 실측 근거: DB 에 `\left( rpile-1&&1#0&&-3\right)` 이 있다. `rpile` 은 HWP 의
 * 우정렬 행렬 키워드이고 그 `le` 는 부등호가 아니다. 원장님이 지목한
 * `angle`·`double`·`large` 도 같은 부류다.
 *
 * ⚠️ **두 글자 키워드는 쓰지 않는다.** `in`·`to`·`of`·`it`·`pi` 를 부분 문자열로
 *    쓰면 어지간한 덩어리가 다 걸려 규칙이 통째로 무력해진다. 세 글자 이상만 본다
 *    (`pile`·`left`·`angle`·`arch` 는 전부 네 글자 이상이라 손해가 없다).
 */
const BLOCKING = [...TOKEN_SET, ...STRUCT_SET]
  .filter((t) => t.length >= 3)
  // 긴 것부터 봐야 `triangle` 이 `angle` 보다 먼저 잡힌다(보고서가 읽기 쉬워진다).
  .sort((a, b) => b.length - a.length);

export function blockingKeyword(run: string): string | null {
  const lower = run.toLowerCase();
  for (const kw of BLOCKING) {
    if (lower.includes(kw)) return kw;
  }
  return null;
}
