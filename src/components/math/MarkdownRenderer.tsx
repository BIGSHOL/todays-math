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
 *
 * ── 성능 (2026-08-17) ────────────────────────────────────────────────────────
 * 이 파일은 문제은행 20카드·검수 30문항·인쇄 지면이 모두 지나가는 목이다.
 * react-markdown v10 은 렌더마다 unified 프로세서를 새로 조립해(createProcessor)
 * 마크다운 파싱 + KaTeX 를 전부 다시 돈다. 그래서 아래 셋을 지킨다 —
 * **출력 HTML 은 한 글자도 달라지지 않는다** (`renderParity.test.tsx` 가 잠근다).
 *  (1) 플러그인 배열·`components` 맵·인라인 style 은 모듈 스코프 상수.
 *      특히 `components` 는 매 렌더 새 함수를 넘기면 React 가 `<p>`/`<blockquote>`
 *      를 **다른 타입**으로 보고 그 아래 KaTeX DOM 을 통째로 버렸다 다시 만든다.
 *  (2) 전처리 결과는 모듈 캐시(입력 문자열 → 결과).
 *  (3) 컴포넌트 자체를 `React.memo`.
 */
import { memo, type CSSProperties } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
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

/** 렌더마다 새 배열을 넘기면 react-markdown 이 프로세서를 새로 조립한다. */
const REMARK_PLUGINS = [remarkMath];
const REHYPE_PLUGINS = [rehypeKatex];

/** mathgen 과 동일: 인용문을 <보기>/<조건> 상자로 그린다. */
const BLOCK_COMPONENTS: Components = {
  p: ({ children }) => <p className="leading-relaxed">{children}</p>,
  blockquote: ({ children }) => (
    <div className="my-4 border border-[#8A8A88] bg-white p-4 not-italic print:border-black">
      {children}
    </div>
  ),
};

const INLINE_COMPONENTS: Components = {
  p: ({ children }) => <span>{children}</span>,
  blockquote: BLOCK_COMPONENTS.blockquote,
};

const INLINE_STYLE: CSSProperties = { display: "inline" };

/** mathgen 원본 보정: 인라인 수식에서 lim 첨자가 옆에 붙는 문제 → 아래로 내린다. */
const BARE_LIM = /\\lim(?!(?:[a-zA-Z]|\s*\\limits))/g;

/**
 * 전처리 결과 캐시. `preprocessMathText` 는 순수 함수(같은 입력 → 같은 출력)라
 * 캐시가 결과를 바꾸지 않는다. 정규식 64패스 + 수식당 약 59패스를 아낀다.
 *
 * `useMemo` 가 아니라 모듈 캐시인 이유:
 *  - 이 렌더러는 서버 컴포넌트(`/dev/katex` 등)에서도 쓰인다.
 *  - 같은 본문을 문제은행 카드·검수 발췌·인쇄 지면이 각각 그리므로
 *    인스턴스를 넘어 재사용돼야 이득이 크다.
 * 서버 프로세스에서 무한히 자라지 않도록 오래된 항목부터 버린다.
 */
const PREPROCESS_CACHE_LIMIT = 256;
const preprocessCache = new Map<string, string>();

function preprocess(content: string): string {
  const cached = preprocessCache.get(content);
  if (cached !== undefined) return cached;

  const result = preprocessMathText(decodeHtmlEntities(content)).replace(
    BARE_LIM,
    "\\lim\\limits",
  );

  if (preprocessCache.size >= PREPROCESS_CACHE_LIMIT) {
    const oldest = preprocessCache.keys().next().value;
    if (oldest !== undefined) preprocessCache.delete(oldest);
  }
  preprocessCache.set(content, result);
  return result;
}

/**
 * 이 저장소의 첫 `React.memo` 다. 여기에 쓰는 이유:
 * props 가 전부 원시값(문자열/불리언)이라 얕은 비교가 정확하고, 막아 주는 일이
 * 마크다운 파싱 + KaTeX 조판이라 한 번 막을 때 아끼는 양이 크다. 문제은행은
 * 패널·안내문 상태 하나만 바뀌어도 20카드가 다시 렌더되는 구조라 실제로 막힌다.
 * (장식용 컴포넌트에 memo 를 뿌리지 말 것 — 비교 비용만 늘어난다.)
 */
export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
  className = "",
  inline = false,
}: MarkdownRendererProps) {
  const processed = preprocess(content ?? "");

  return (
    <div
      className={`prose prose-slate max-w-none prose-p:my-2 prose-headings:my-3 ${className}`}
      style={inline ? INLINE_STYLE : undefined}
    >
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        components={inline ? INLINE_COMPONENTS : BLOCK_COMPONENTS}
      >
        {processed}
      </ReactMarkdown>
    </div>
  );
});
