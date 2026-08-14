/**
 * 문제 본문(지문 + 보기) 렌더러 — mathgen `ProblemDisplay` 의 question/choices 레이아웃 이식.
 *
 * mathgen 정본: 보기는 `①②③④⑤` 마커 + 2열 그리드, 각 보기는 MarkdownRenderer 로 렌더.
 * 문제은행·검수·인쇄가 모두 이 컴포넌트를 쓴다 (렌더 경로 분기 금지).
 *
 * 보기 마커가 없는 문항(OCR 유실 등)은 지문만 렌더한다 — 임의로 쪼개지 않는다.
 */
import { MarkdownRenderer } from "@/components/math/MarkdownRenderer";
import { parseProblemContent } from "@/lib/problem/parseProblemContent";

const CHOICE_MARKS = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];

export interface ProblemContentProps {
  content: string;
  className?: string;
}

export function ProblemContent({
  content,
  className = "",
}: ProblemContentProps) {
  const { question, choices } = parseProblemContent(content);

  return (
    <div className={className}>
      <MarkdownRenderer content={question} />
      {choices.length > 0 ? (
        <div className="mt-4 grid grid-cols-1 gap-x-8 gap-y-2 md:grid-cols-2 print:grid-cols-2">
          {choices.map((choice, index) => (
            <div
              key={index}
              className="flex items-start gap-1.5 print:break-inside-avoid"
            >
              <span className="flex-shrink-0 leading-relaxed">
                {CHOICE_MARKS[index] ?? `(${index + 1})`}
              </span>
              <div className="min-w-0 flex-1">
                <MarkdownRenderer content={choice} className="[&_p]:my-0" />
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
