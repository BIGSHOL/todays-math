import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { MathText } from "@/components/math/MathText";
import { PaperProblemView } from "@/components/print/PaperProblemView";
import {
  elementaryChapters,
  generateElementaryChapter,
} from "@/lib/elementary/generate";
import { ELEM_GRADES } from "@/lib/elementary/types";
import { renderFigureSpec } from "@/lib/figure/renderFigureSpec";

/**
 * 초3-1~초6-2 자체 출제 엔진 QA.
 * 공유 DB 에 넣지 않는다. 조작형(그리세요)은 같은 개념의 읽기·계산 문항이다.
 */
export default async function ElemEnginePage({
  searchParams,
}: {
  searchParams: Promise<{ grade?: string; chapter?: string }>;
}) {
  await connection();
  if (
    process.env.NODE_ENV === "production" &&
    process.env.ENABLE_RENDER_QA !== "1"
  ) {
    notFound();
  }

  const query = await searchParams;
  const chapters = elementaryChapters();
  const grade =
    query.grade && (ELEM_GRADES as readonly string[]).includes(query.grade)
      ? query.grade
      : "초3";
  const inGrade = chapters.filter((c) => c.grade === grade);
  const chapter =
    inGrade.find((c) => c.chapter === query.chapter)?.chapter ??
    inGrade[0]?.chapter ??
    "1-1 덧셈과 뺄셈";

  const items = generateElementaryChapter(grade, chapter, 20260821);
  const drawn = await Promise.all(
    items.map(async (item) => {
      if (!item.figureSpec) {
        return { ...item, figureSvg: null as string | null, figureError: null as string | null };
      }
      const svg = await renderFigureSpec(item.figureSpec);
      return {
        ...item,
        figureSvg: svg.ok ? svg.svg : null,
        figureError: svg.ok ? null : svg.error,
      };
    }),
  );

  return (
    <main className="mx-auto max-w-[720px] px-6 py-8">
      <p className="text-[11px] font-extrabold tracking-[0.16em] text-text-2">
        DEV · 초등 엔진
      </p>
      <h1 className="mt-2 text-xl font-black">초3-1 ~ 초6-2 자체 출제</h1>
      <p className="mt-2 text-[13px] leading-relaxed text-text-2">
        소단원 230개 전량 생성. 정답은 계산기가 같은 숫자로 검산한다. 적재하지
        않았다. 「그리세요」는 같은 개념의 읽기·계산으로 바꿨다.
      </p>
      <nav className="mt-4 flex flex-wrap gap-2" aria-label="학년">
        {ELEM_GRADES.map((g) => (
          <Link
            key={g}
            href={`/dev/elem-engine?grade=${encodeURIComponent(g)}`}
            className={
              g === grade
                ? "border border-ink bg-ink px-2 py-1 text-[12px] font-bold text-white"
                : "border border-divider px-2 py-1 text-[12px] text-text-1"
            }
          >
            {g}
          </Link>
        ))}
      </nav>
      <nav className="mt-3 flex flex-col gap-1" aria-label="대단원">
        {inGrade.map((c) => (
          <Link
            key={c.chapter}
            href={`/dev/elem-engine?grade=${encodeURIComponent(grade)}&chapter=${encodeURIComponent(c.chapter)}`}
            className={
              c.chapter === chapter
                ? "border border-ink bg-paper px-2 py-1 text-[12px] font-bold"
                : "border border-divider px-2 py-1 text-[12px] text-text-1"
            }
          >
            {c.chapter}
          </Link>
        ))}
      </nav>
      <ol className="mt-8 space-y-8">
        {drawn.map((item, index) => (
          <li key={item.orderIndex} className="border-t border-divider pt-5">
            <p className="mb-3 text-[11px] font-extrabold tracking-wide text-text-2">
              {index + 1}. {item.section}
            </p>
            {item.figureError ? (
              <p className="mb-2 text-[12px] text-g-red-text">{item.figureError}</p>
            ) : null}
            <PaperProblemView
              content={item.content}
              figureSvg={item.figureSvg}
            />
            <div className="mt-2 text-[12px] text-text-1">
              <span className="font-extrabold tracking-wide text-text-2">정답</span>{" "}
              <MathText as="span" text={item.answer} />
            </div>
            <div className="mt-1 text-[12px] text-text-2">
              <p className="mb-1 font-extrabold tracking-wide">해설</p>
              <PaperProblemView content={item.solution} framed={false} />
            </div>
          </li>
        ))}
      </ol>
    </main>
  );
}
