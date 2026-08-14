/**
 * mathgen 렌더링 하네스 이식 — 정본: `mathgen-ai/components/MarkdownRenderer.tsx`.
 *
 * mathgen 과 동일한 파이프라인(react-markdown + remark-math + rehype-katex)을 그대로 쓴다.
 * 새로 만들지 말 것 — 이미 검증된 렌더러를 가져와 쓰는 것이 이 파일의 존재 이유다.
 *
 * 원본과의 차이(우리 데이터 사정):
 *  1. 입력이 OCR 이관본이라 `decodeHtmlEntities` + `preprocessMathText`(유니코드 수학기호,
 *     `\dfrac`→`\frac` 등)를 먼저 태운다. mathgen 입력은 모델 생성물이라 필요 없었다.
 *  2. 인라인 문맥(`as="span"`)에서 문단(`<p>`)이 나오면 HTML 이 깨지므로 span 으로 낮춘다.
 *
 * ⚠️ KaTeX CSS 는 `src/app/layout.tsx`가 한 번만 로드한다 (mathgen 은 index.html 의 CDN link).
 */
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";

import {
  decodeHtmlEntities,
  preprocessMathText,
} from "@/lib/math/textPreprocess";

export interface MarkdownRendererProps {
  content: string;
  className?: string;
  /** 인라인 문맥이면 문단 대신 span 으로 렌더한다 (인쇄 정답란 등). */
  inline?: boolean;
}

export function MarkdownRenderer({
  content,
  className = "",
  inline = false,
}: MarkdownRendererProps) {
  // mathgen 원본 보정: 인라인 수식에서 lim 첨자가 옆에 붙는 문제 → 아래로 내린다.
  const processed = preprocessMathText(
    decodeHtmlEntities(content ?? ""),
  ).replace(/\\lim(?!(?:[a-zA-Z]|\s*\\limits))/g, "\\lim\\limits");

  return (
    <div
      className={`prose prose-slate max-w-none prose-p:my-2 prose-headings:my-3 ${className}`}
      style={inline ? { display: "inline" } : undefined}
    >
      <ReactMarkdown
        remarkPlugins={[remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          p: ({ children }) =>
            inline ? (
              <span>{children}</span>
            ) : (
              <p className="leading-relaxed">{children}</p>
            ),
          // mathgen 과 동일: 인용문을 <보기>/<조건> 상자로 그린다.
          blockquote: ({ children }) => (
            <div className="my-4 border border-[#8A8A88] bg-white p-4 not-italic print:border-black">
              {children}
            </div>
          ),
        }}
      >
        {processed}
      </ReactMarkdown>
    </div>
  );
}
