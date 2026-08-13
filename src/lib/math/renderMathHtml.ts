/**
 * 혼합 본문(한글 + $...$ / $$...$$) → 안전한 HTML.
 *
 * Mathgen KaTeXInline.renderInlineKatex 와 같은 전처리·3단 방어를 쓰되,
 * 수식 밖 텍스트는 HTML 이스케이프한다 (원본 KaTeXInline 은 이스케이프하지 않음).
 */
import { decodeHtmlEntities, preprocessMathText } from "./textPreprocess";
import { renderKatexSafe } from "./katexRender";

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

type Segment =
  | { type: "text"; value: string }
  | { type: "inline" | "display"; value: string };

function tokenizeMath(input: string): Segment[] {
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

/** 문제 본문·정답·해설을 KaTeX HTML 로 변환. katex-error 를 절대 포함하지 않는다. */
export function renderMathHtml(text: string): string {
  const pre = preprocessMathText(decodeHtmlEntities(text));
  return tokenizeMath(pre)
    .map((seg) => {
      if (seg.type === "text") {
        return escapeHtml(seg.value).replace(/\r\n|\n|\r/g, "<br />");
      }
      return renderKatexSafe(seg.value.trim(), seg.type === "display");
    })
    .join("");
}
