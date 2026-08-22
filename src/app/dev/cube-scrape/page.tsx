import { notFound } from "next/navigation";
import { connection } from "next/server";

import { PaperProblemView } from "@/components/print/PaperProblemView";
import { renderFigureSpec } from "@/lib/figure/renderFigureSpec";

import { CUBE_EXTRACT_20 } from "./extract20";
import { CUBE_RANDOM_20 } from "./random20";

/**
 * 큐브수학 개념 3-1 진도북 추출 표본.
 * 문제은행과 같은 `PaperProblemView`. 도형·초등 그림은 서버가 SVG 로 그린다.
 */
export default async function CubeScrapePage() {
  await connection();
  if (
    process.env.NODE_ENV === "production" &&
    process.env.ENABLE_RENDER_QA !== "1"
  ) {
    notFound();
  }

  const extractById = new Map(CUBE_EXTRACT_20.map((row) => [row.id, row]));
  const items = await Promise.all(
    CUBE_RANDOM_20.map(async (item) => {
      if (!item.figureSpec) {
        return { ...item, figureSvg: null as string | null, figureError: null };
      }
      const drawn = await renderFigureSpec(item.figureSpec);
      return {
        ...item,
        figureSvg: drawn.ok ? drawn.svg : null,
        figureError: drawn.ok ? null : drawn.error,
      };
    }),
  );

  return (
    <main className="mx-auto max-w-[720px] px-6 py-8">
      <p className="text-[11px] font-extrabold tracking-[0.16em] text-text-2">
        DEV · 큐브 추출
      </p>
      <h1 className="mt-2 text-xl font-black">개념 3-1 진도북 무작위 20</h1>
      <p className="mt-2 text-[13px] leading-relaxed text-text-2">
        합격 표본 16개와 이전 무작위 40개는 빼고 골랐다. 아래 회색은 PDF
        추출 원문(테스트 긁기). 적재하지 않았다.
      </p>
      <ol className="mt-8 space-y-8">
        {items.map((item, index) => {
          const raw = extractById.get(item.id);
          return (
          <li key={item.id} className="border-t border-divider pt-5">
            <p className="mb-3 text-[11px] font-extrabold tracking-wide text-text-2">
              {index + 1}. {item.genre} {item.page}쪽 · {item.title}
            </p>
            {item.figureError ? (
              <p className="mb-2 text-[12px] text-g-red-text">
                {item.figureError}
              </p>
            ) : null}
            <PaperProblemView
              content={item.content}
              figureUrls={item.figureUrls}
              figureSvg={item.figureSvg}
            />
            {raw ? (
              <div className="mt-3 border border-divider bg-[#f6f6f4] px-3 py-2">
                <p className="text-[11px] font-extrabold tracking-wide text-text-2">
                  추출 {raw.verdict}
                </p>
                <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-[12px] leading-relaxed text-text-2">
                  {raw.extract ?? "(없음)"}
                </pre>
              </div>
            ) : null}
          </li>
          );
        })}
      </ol>
    </main>
  );
}
