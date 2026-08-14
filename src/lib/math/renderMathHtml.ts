/**
 * 혼합 본문(한글 + $...$ / $$...$$) → 안전한 HTML.
 *
 * Mathgen KaTeXInline.renderInlineKatex 와 같은 전처리·3단 방어를 쓰되,
 * 수식 밖 텍스트는 HTML 이스케이프한다 (원본 KaTeXInline 은 이스케이프하지 않음).
 */
import { tokenizeMath } from "./segments";
import { decodeHtmlEntities, preprocessMathText } from "./textPreprocess";
import { renderKatexSafe } from "./katexRender";

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// 줄바꿈으로 남길 지점을 표시하는 사적 센티널(본문에 절대 등장하지 않는 제어문자).
const BREAK = "";

// 선택지 시작 표식: `1.`~`19.` 또는 원문자 ①~⑮.
const CHOICE_MARKER = /(?:[1-9][0-9]?\.[ \t]|[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮])/;

/**
 * 수식 밖 텍스트 조각의 개행을 레이아웃 규약에 맞게 정규화한다.
 *
 * OCR 이관 데이터 규약(400건 표본 전수 확인):
 *  - 개행(`\n`, `\n\n`)은 대부분 인라인 토큰을 쪼갠 구분자 → 공백으로 합친다.
 *  - 단, 개행 직후 선택지 표식(`1.`, `①` …)이 오면 실제 줄바꿈이므로 유지한다.
 * 종전처럼 모든 개행을 `<br />`로 바꾸면 토막마다 세로로 쌓인다.
 */
const normalizeTextSegment = (s: string): string =>
  s
    .replace(/\r\n?/g, "\n")
    // 개행 + 선택지 표식 → 줄바꿈 센티널(앞의 공백/개행은 흡수)
    .replace(new RegExp(`\\n+[ \\t]*(?=${CHOICE_MARKER.source})`, "g"), BREAK)
    // 남은 개행은 토큰 구분자 → 공백
    .replace(/\n+/g, " ")
    // 연속 공백 정리
    .replace(/[ \t]{2,}/g, " ")
    // 구두점 앞 불필요한 공백 제거(예: "$a$ ," → "$a$,")
    .replace(/[ \t]+([,)\]?!。，、])/g, "$1");

/** 문제 본문·정답·해설을 KaTeX HTML 로 변환. katex-error 를 절대 포함하지 않는다. */
export function renderMathHtml(text: string): string {
  const pre = preprocessMathText(decodeHtmlEntities(text));
  return tokenizeMath(pre)
    .map((seg) => {
      if (seg.type === "text") {
        return escapeHtml(normalizeTextSegment(seg.value))
          .split(BREAK)
          .join("<br />");
      }
      return renderKatexSafe(seg.value.trim(), seg.type === "display");
    })
    .join("");
}
