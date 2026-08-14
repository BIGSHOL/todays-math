/**
 * 혼합 본문(한글 + `$...$` / `$$...$$`)을 텍스트/수식 조각으로 나눈다.
 *
 * renderMathHtml(문자열 HTML 경로)과 parseProblemContent(지문/보기 분해)가 같은
 * 토크나이저를 쓴다 — 수식 경계 판정이 두 곳에서 갈리면 침묵 회귀가 난다.
 */

export type Segment =
  | { type: "text"; value: string }
  | { type: "inline" | "display"; value: string };

export function tokenizeMath(input: string): Segment[] {
  const parts: Segment[] = [];
  let i = 0;
  const n = input.length;

  while (i < n) {
    if (input.startsWith("$$", i)) {
      const end = input.indexOf("$$", i + 2);
      if (end === -1) {
        parts.push({ type: "text", value: input.slice(i) });
        break;
      }
      parts.push({ type: "display", value: input.slice(i + 2, end) });
      i = end + 2;
      continue;
    }

    if (input[i] === "$" && input[i - 1] !== "\\") {
      let end = i + 1;
      while (end < n) {
        if (input[end] === "$" && input[end - 1] !== "\\") break;
        end += 1;
      }
      if (end >= n) {
        parts.push({ type: "text", value: input.slice(i) });
        break;
      }
      parts.push({ type: "inline", value: input.slice(i + 1, end) });
      i = end + 1;
      continue;
    }

    let j = i + 1;
    while (j < n) {
      if (input.startsWith("$$", j)) break;
      if (input[j] === "$" && input[j - 1] !== "\\") break;
      j += 1;
    }
    parts.push({ type: "text", value: input.slice(i, j) });
    i = j;
  }

  return parts;
}
