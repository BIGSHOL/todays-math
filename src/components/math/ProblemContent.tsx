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
  /**
   * 원본 시험지에서 오려 온 그림 경로들 (`/figures/<examId>/qNN.jpg`).
   * 여러 장인 이유: 선택지마다 그림인 문항이 있다(실측 한 문항 최대 6장).
   * 순서는 지면에 나온 순서다. 참조: docs/planning/09-figure-engine-guide.md
   */
  figureUrls?: string[];
  className?: string;
}

export function ProblemContent({
  content,
  figureUrls,
  className = "",
}: ProblemContentProps) {
  const { question, choices } = parseProblemContent(content);
  const figures = figureUrls ?? [];

  return (
    <div className={className}>
      <MarkdownRenderer content={question} />
      {figures.length > 0 ? (
        // 발문 뒤·보기 앞 — 원본 지면 순서 그대로.
        // 장식 없음(05 §0: 유리·그림자·그라데이션 금지). 그림 자체가 내용이다.
        <div className="mt-3 flex flex-wrap items-start gap-4 print:break-inside-avoid">
          {figures.map((url, index) => (
            // 원본 비율·자연 크기를 그대로 써야 인쇄물이 원본 시험지와 같아진다.
            // next/image 는 리사이즈·포맷 변환을 하므로 여기선 쓰지 않는다.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={url}
              src={url}
              alt={figures.length > 1 ? `문항 그림 ${index + 1}` : "문항 그림"}
              // 원본이 최대 1,423px 이라 자연 크기로 두면 본문을 압도한다(실측 표시폭 1,178px).
              // 작은 그림은 그대로 두고 큰 것만 줄인다.
              className="h-auto w-auto max-w-full sm:max-w-[360px] print:max-w-[70mm]"
            />
          ))}
        </div>
      ) : null}
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
