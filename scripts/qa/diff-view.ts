/**
 * 「형식을 바꾸면 **화면이 달라지나**」를 실제로 찍어 본다 (읽기 전용).
 *
 *   npx tsx scripts/qa/diff-view.ts
 *
 * 기존 말뭉치와 우리 AI 문항은 보기 마커(`1.` vs `①`)와 보기 앞 빈 줄에서 갈린다.
 * 그런데 **파서가 마커를 떼고 렌더러가 ①②③ 를 다시 붙인다.** 그러면 저장된 글자는
 * 달라도 화면은 같을 수 있다 — 「다르다」와 「달라 보인다」는 다른 말이다.
 *
 * 그래서 규칙을 정하기 전에 **제품 파서·렌더러를 그대로 불러** 두 형식의 산출물을
 * 글자까지 대조한다. 같으면 그 축은 고칠 이유가 없고(고치면 일만 는다),
 * 다르면 무엇이 다른지 그 자리에서 보인다.
 */
import { parseProblemContent } from "../../src/lib/problem/parseProblemContent";
import { renderMathHtml } from "../../src/lib/math/renderMathHtml";

/** 우리 형식(원문자, 빈 줄 없음) → 기존 형식(`1.`, 보기 앞 빈 줄). */
export function toCorpusShape(content: string): string {
  const MARKS = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮";
  let first = true;
  const out = content.replace(
    /(\n)([ \t]*)([①-⑮])([ \t]*)/g,
    (_all, _nl, indent: string, mark: string, tail: string) => {
      const n = MARKS.indexOf(mark) + 1;
      // 첫 보기 앞에만 빈 줄을 넣는다 — 기존 말뭉치 4,000건 전량이 그 모양이다.
      const lead = first ? "\n\n" : "\n";
      first = false;
      return `${lead}${indent}${n}.${tail || " "}`;
    },
  );
  // 이미 빈 줄이 있었으면 세 줄이 된다.
  return out.replace(/\n{3,}(\d{1,2}\.)/, "\n\n$1");
}

const 우리 = [
  "다음은 모든 자연수 $n$에 대하여 등식 $1+2+2^{2}+\\cdots+2^{n-1}=2^{n}-1$ 이 성립함을 수학적 귀납법으로 증명한 것이다.\n\n(i) $n=1$일 때, (좌변)$=1$, (우변)$=2^{1}-1=1$ 이므로 등식이 성립한다.\n\n(가)에 알맞은 식은?\n① $2^{k+1}-1$\n② $2^{k+1}-2$\n③ $2^{k}-1$\n④ $2^{k+1}+1$\n⑤ $2^{k+2}-1$",
  "$\\angle \\mathrm{C}=90^{\\circ}$인 직각삼각형 $\\mathrm{ABC}$에서 $\\overline{\\mathrm{AB}}=13$, $\\overline{\\mathrm{BC}}=5$ 일 때, $\\sin A$의 값은?\n① $\\dfrac{5}{13}$\n② $\\dfrac{12}{13}$\n③ $\\dfrac{5}{12}$\n④ $\\dfrac{12}{5}$\n⑤ $\\dfrac{13}{12}$",
];

let 다름 = 0;
for (const [i, mine] of 우리.entries()) {
  const theirs = toCorpusShape(mine);
  const a = parseProblemContent(mine);
  const b = parseProblemContent(theirs);
  const render = (p: { question: string; choices: string[] }) =>
    [renderMathHtml(p.question), ...p.choices.map(renderMathHtml)].join("");
  const same = render(a) === render(b);
  console.log(
    `  #${i}  발문 ${a.question.length}자 vs ${b.question.length}자 · 보기 ${a.choices.length} vs ${b.choices.length} · 렌더 ${same ? "같다" : "다르다"}`,
  );
  if (!same) {
    다름 += 1;
    const [x, y] = [render(a), render(b)];
    let k = 0;
    while (k < x.length && x[k] === y[k]) k += 1;
    console.log(`     처음 갈리는 자리 ${k}`);
    console.log(
      `     우리: ${JSON.stringify(x.slice(Math.max(0, k - 40), k + 60))}`,
    );
    console.log(
      `     기존: ${JSON.stringify(y.slice(Math.max(0, k - 40), k + 60))}`,
    );
  }
}
console.log(`\n  형식만 바꿔 렌더가 달라진 것: ${다름}/${우리.length}`);

// `\dfrac` 은 별개다 — 표기 자체가 다르면 당연히 다르게 그려진다.
const d = renderMathHtml("$\\dfrac{5}{13}$");
const f = renderMathHtml("$\\frac{5}{13}$");
console.log(
  `  \\dfrac vs \\frac 렌더: ${d === f ? "같다" : "다르다"} (길이 ${d.length} vs ${f.length})`,
);
