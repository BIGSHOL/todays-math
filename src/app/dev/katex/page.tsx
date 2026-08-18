import { notFound } from "next/navigation";
import { connection } from "next/server";

import { MathText } from "@/components/math/MathText";
import {
  MOCK_PROBLEM_WITH_EXPONENT,
  MOCK_PROBLEM_WITH_FRACTION,
  MOCK_PROBLEM_WITH_GEOMETRY_SYMBOL,
  MOCK_PROBLEM_WITH_SQRT,
} from "@/mocks/data";

const CASES: { title: string; text: string }[] = [
  { title: "분수", text: MOCK_PROBLEM_WITH_FRACTION.content },
  { title: "지수", text: MOCK_PROBLEM_WITH_EXPONENT.content },
  { title: "루트", text: MOCK_PROBLEM_WITH_SQRT.content },
  { title: "도형", text: MOCK_PROBLEM_WITH_GEOMETRY_SYMBOL.content },
  {
    title: "해설(분수)",
    text: MOCK_PROBLEM_WITH_FRACTION.solution ?? "",
  },
  {
    title: "모델 typo \\left\\left",
    text: "식 $\\left\\left( x+1 \\right\\right)$ 의 값",
  },
  {
    title: "구분 없이 흘러나온 raw LaTeX",
    text: "\\frac{1}{2} + \\sqrt{3}의 값은?",
  },
  {
    title: "유니코드",
    text: "각도가 90° 이하이고 $x² × y ≤ 3$ 일 때",
  },
  {
    title: "호",
    text: "호 $\\overparen{AB}$ 의 길이",
  },
  {
    title: "순환소수",
    text: "순환소수 $0.\\overline{3}$, $0.4\\overline{5}$, $1.2\\overline{34}$",
  },
  {
    title: "\\( \\) 구분자",
    text: "값 \\( \\dfrac{a}{b} \\) 이다",
  },
];

export default async function KatexDevPage() {
  await connection();

  // 이웃 dev 페이지(dev/transfer-qa)와 **같은 가드**다. 이게 없어서 이 페이지만
  // 프로덕션에 프리렌더됐고(.next/server/app/dev/katex.html 87KB), 목 픽스처 배럴
  // (@/mocks/data, 10개 모듈 188KB)을 그대로 끌고 들어갔다.
  if (
    process.env.NODE_ENV === "production" &&
    process.env.ENABLE_KATEX_QA !== "1"
  ) {
    notFound();
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 text-ink">
      <p className="text-[11px] font-extrabold tracking-[0.16em] text-text-2">
        DEV · KATEX
      </p>
      <h1 className="mt-2 text-xl font-black">수식 렌더 검수</h1>
      <p className="mt-2 text-[13px] leading-relaxed text-[#3a3a40]">
        붉은 글씨(.katex-error)가 보이면 실패다. 복구 불가면 회색 .math-raw 만
        허용한다.
      </p>
      <ul className="mt-8 space-y-6">
        {CASES.map((c) => (
          <li key={c.title} className="border-b border-[#c2c2c0] pb-5">
            <div className="mb-2 text-[11px] font-extrabold tracking-wide text-text-2">
              {c.title}
            </div>
            <div className="text-[15px] leading-8">
              <MathText text={c.text} />
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
