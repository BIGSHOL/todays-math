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
 *  3. `<보기>`·`<조건>` 상자는 문단 단위로 항목을 잡는다 (아래 `BoxQuote` 주석).
 *
 * ⚠️ KaTeX CSS 는 `src/app/layout.tsx`가 한 번만 로드한다 (mathgen 은 index.html 의 CDN link).
 *
 * ── 성능 (2026-08-17) ────────────────────────────────────────────────────────
 * 이 파일은 문제은행 20카드·검수 30문항·인쇄 지면이 모두 지나가는 목이다.
 * react-markdown v10 은 렌더마다 unified 프로세서를 새로 조립해(createProcessor)
 * 마크다운 파싱 + KaTeX 를 전부 다시 돈다. 그래서 아래 셋을 지킨다 —
 * **성능 수리로는 출력 HTML 이 한 글자도 달라지지 않는다**
 * (`renderParity.test.tsx` 가 잠근다. 상자 렌더처럼 **의도한** 변경은 그 파일의
 *  변경 이력에 무엇이 왜 달라졌는지 적고 새 케이스를 추가한 뒤에만 갱신한다).
 *  (1) 플러그인 배열·`components` 맵·인라인 style 은 모듈 스코프 상수.
 *      특히 `components` 는 매 렌더 새 함수를 넘기면 React 가 `<p>`/`<blockquote>`
 *      를 **다른 타입**으로 보고 그 아래 KaTeX DOM 을 통째로 버렸다 다시 만든다.
 *  (2) 전처리 결과는 모듈 캐시(입력 문자열 → 결과).
 *  (3) 컴포넌트 자체를 `React.memo`.
 */
import {
  Children,
  cloneElement,
  isValidElement,
  memo,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import type { PluggableList } from "unified";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";

import { UI_KATEX_OPTIONS } from "@/lib/math/katexRender";
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
/**
 * ⚠️ **옵션을 반드시 넘긴다.** 안 넘기면 `trust` 가 없어 KaTeX 가 `\htmlClass` 를
 * 거부하는데, 예외가 아니라 **붉은 날문자**(`color:#cc0000`)로 그린다.
 * 그런데 `\htmlClass` 는 **우리 전처리가 스스로 만든다**(순환마디 점·호 ⌒) —
 * 즉 우리가 만든 글자를 우리 렌더가 거부하고 있었다. 실측 320행 · 수식 787곳.
 * 근거와 옵션 내용은 `katexRender.ts` 의 `UI_KATEX_OPTIONS` 주석.
 */
const REHYPE_PLUGINS: PluggableList = [[rehypeKatex, UI_KATEX_OPTIONS]];

/* ──────────────────────────────────────────────────────────────────────────
 * `<보기>` · `<조건>` 상자 카드 — mathgen MarkdownRenderer 1011~1028행 이식.
 *
 * 정본과 같은 판정: **명시적 마커가 첫 줄에 있을 때만** 그리드로 바꾼다.
 * 마커가 없는 인용문(다단계 계산식 등)은 종전 테두리 div 그대로다 —
 * 그래야 상자 아닌 문항의 렌더가 한 글자도 안 바뀐다.
 *
 * 정본과 다른 두 가지, 이유:
 *  1. **항목을 `<br>` 이 아니라 «문단» 단위로 잡는다.** 정본은 `remark-breaks` 로
 *     부드러운 줄바꿈을 `<br>` 로 만든 뒤 그걸 잘라 항목을 센다. 이 저장소는
 *     remark-breaks 를 안 쓰고(새 의존성 금지) 넣을 이유도 없다 —
 *     `parseProblemContent` 가 항목마다 빈 `>` 줄을 넣어 문단으로 만들어 준다.
 *  2. **열 수를 `:cols=N` 이 아니라 라벨 뒤 숫자로 싣는다** (`<보기2>`).
 *     정본 표기 `<보기:cols=1>` 은 이 저장소의 `preprocessMathText`(Step 9 자동
 *     wrap)가 `cols=1` 을 수식으로 감싸 KaTeX 로 그려 버린다 — 실측으로 확인했다.
 *     숫자만 붙인 형태는 전처리를 그대로 통과한다.
 * ────────────────────────────────────────────────────────────────────────── */

/** 인용문 첫 문단이 이 모양이면 상자다. 숫자는 열 수(1~3), 없으면 1열. */
const BOX_HEADER_RE = /^<(보기|조건|상자)([1-3])?>/;

const QUOTE_CLASS =
  "my-4 border border-[#8A8A88] bg-white p-4 not-italic print:border-black";
/** 넓은 수식이 카드를 밀어내지 않게 — 정본 1040행의 오버플로 보정과 같은 취지. */
const BOX_CARD_CLASS = `${QUOTE_CLASS} max-w-full overflow-hidden print:break-inside-avoid [&_.katex-display]:overflow-x-auto`;

/** 문단 안의 글자만 이어 붙인다. 헤더 판정은 **맨 앞** 글자만 보면 되므로 충분하다. */
function textOf(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode };
    return textOf(props.children);
  }
  return "";
}

/** 헤더에서 열 수 지정자를 지운다 — 지면에는 `<보기>` 만 나가야 한다. */
function stripColumnHint(node: ReactNode, label: string): ReactNode {
  if (typeof node === "string")
    return node.replace(BOX_HEADER_RE, `<${label}>`);
  if (Array.isArray(node))
    return node.map((child) => stripColumnHint(child, label));
  if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode };
    if (props.children === undefined) return node;
    return cloneElement(
      node as ReactElement<{ children?: ReactNode }>,
      undefined,
      stripColumnHint(props.children, label),
    );
  }
  return node;
}

function childrenOf(node: ReactNode): ReactNode {
  if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode };
    return props.children;
  }
  return node;
}

function BoxQuote({ children }: { children?: ReactNode }) {
  // 인용문 자식에는 문단 사이의 개행 문자열이 섞여 온다 — 그것부터 걸러야
  // 첫 문단이 헤더 자리에 온다(안 거르면 헤더 판정이 항상 빗나간다).
  const blocks = Children.toArray(children).filter(
    (block) => !(typeof block === "string" && block.trim() === ""),
  );
  const header = BOX_HEADER_RE.exec(textOf(blocks[0]).trim());
  // 마커가 없으면 예전 인용문 그대로 — 여기서 갈라야 렌더 회귀가 없다.
  if (!header) return <div className={QUOTE_CLASS}>{children}</div>;

  const label = header[1]!;
  const columns = header[2] === "2" ? 2 : header[2] === "3" ? 3 : 1;
  const items = blocks.slice(1);
  const gridClass =
    columns === 3
      ? "grid grid-cols-1 gap-x-6 gap-y-1 md:grid-cols-3 print:grid-cols-3"
      : columns === 2
        ? "grid grid-cols-1 gap-x-6 gap-y-1 md:grid-cols-2 print:grid-cols-2"
        : "space-y-1";

  return (
    <div data-box-card className={BOX_CARD_CLASS}>
      <div data-box-header className="mb-2 font-semibold [&>p]:my-0">
        {stripColumnHint(childrenOf(blocks[0]), label)}
      </div>
      {items.length > 0 ? (
        <div className={gridClass}>
          {items.map((item, index) => (
            <div
              key={index}
              data-box-item
              className="min-w-0 break-words [&>p]:my-0"
            >
              {item}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const BLOCK_COMPONENTS: Components = {
  p: ({ children }) => <p className="leading-relaxed">{children}</p>,
  blockquote: ({ children }) => <BoxQuote>{children}</BoxQuote>,
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
