/**
 * 소단원 분류용 본문 특징 추출 (트랙 G).
 *
 * 시험지가 소단원명을 적어 주지 않은 문항을 본문만 보고 분류하기 위한 것이다.
 * `src/lib/import/mapUnit.ts` 는 **시험지가 적어 준 이름**을 트리에 붙이는 규칙이고,
 * 여기는 **적어 준 게 없을 때** 쓰는 별도 기준이다. 둘은 서로를 대체하지 않는다.
 */

/** 수식 명령(\sin, \log, \int …)은 단원을 강하게 가른다 — 별도 토큰으로 남긴다. */
const LATEX_COMMAND = /\\[a-zA-Z]+/g;

/**
 * 본문 → 특징 목록.
 *
 * 한글 2·3-gram 과 LaTeX 명령을 쓴다. 같은 특징이 한 문항에 여러 번 나와도
 * 한 번으로 센다(실측: 중복 계수보다 0.3%p 높다 — 긴 문항이 과대 대표되는 것을 막는다).
 */
export function extractFeatures(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(LATEX_COMMAND)) out.push(`C${m[0]}`);

  // 수식 구간을 걷어낸 산문에서만 한글 n-gram 을 뽑는다.
  const korean = text
    .replace(/\$[^$]*\$/g, " ")
    .replace(/[^가-힣]+/g, " ")
    .trim();
  for (const word of korean.split(/\s+/)) {
    if (!word) continue;
    for (let i = 0; i + 2 <= word.length; i += 1) out.push(`K${word.slice(i, i + 2)}`);
    for (let i = 0; i + 3 <= word.length; i += 1) out.push(`T${word.slice(i, i + 3)}`);
  }
  return [...new Set(out)];
}

/** 문항 본문 조립 — 본문과 선택지를 같이 본다(선택지에 단원 단서가 자주 있다). */
export function problemText(stem: unknown, choices: unknown): string {
  const body = String(stem ?? "");
  const options = Array.isArray(choices) ? choices.join(" ") : String(choices ?? "");
  return `${body} ${options}`.trim();
}
