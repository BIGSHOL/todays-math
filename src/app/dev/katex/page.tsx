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
    title: "\\( \\) 구분자",
    text: "값 \\( \\dfrac{a}{b} \\) 이다",
  },
];

export default function KatexDevPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-10 text-[#161616]">
      <p className="text-[11px] font-extrabold tracking-[0.16em] text-[#6a6a68]">
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
            <div className="mb-2 text-[11px] font-extrabold tracking-wide text-[#6a6a68]">
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
