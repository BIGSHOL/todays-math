import { renderMathHtml } from "@/lib/math/renderMathHtml";
import { preprocessMathText } from "@/lib/math/textPreprocess";

import type {
  CorpusMathCandidate,
  MathCorpusInventory,
} from "./mathCorpusInventory";

export interface RenderedCorpusSpecimen extends CorpusMathCandidate {
  html: string;
  safe: boolean;
  coveredKeys: string[];
}

export interface MathRenderQa {
  inventory: MathCorpusInventory;
  specimens: RenderedCorpusSpecimen[];
  missingUnicodeSymbols: string[];
  missingLatexCommands: string[];
  renderedUnicodeSymbols: number;
  renderedLatexCommands: number;
}

function renderCandidate(
  candidate: CorpusMathCandidate,
): RenderedCorpusSpecimen {
  const html = renderMathHtml(candidate.renderText);
  const visibleText = preprocessMathText(candidate.renderText).replace(
    /\$\$[\s\S]*?\$\$|\$[^$\r\n]*?\$/gu,
    "",
  );
  const hasVisibleLatex = /\\(?:[A-Za-z]+|[{},.;:!%#$&_ |\\])/u.test(
    visibleText,
  );
  return {
    ...candidate,
    html,
    safe:
      !html.includes("katex-error") &&
      !html.includes("math-raw") &&
      !/#cc0000/iu.test(html) &&
      !hasVisibleLatex,
    coveredKeys: [
      ...candidate.commands.map((token) => `command:${token}`),
      ...candidate.unicodeSymbols.map((token) => `unicode:${token}`),
    ],
  };
}

function greedyCover(
  candidates: RenderedCorpusSpecimen[],
  universe: Set<string>,
): RenderedCorpusSpecimen[] {
  const uncovered = new Set(universe);
  const remaining = [...candidates];
  const selected: RenderedCorpusSpecimen[] = [];
  while (uncovered.size > 0) {
    let bestIndex = -1;
    let bestCoverage = 0;
    for (let index = 0; index < remaining.length; index += 1) {
      const coverage = remaining[index].coveredKeys.filter((key) =>
        uncovered.has(key),
      ).length;
      if (coverage > bestCoverage) {
        bestCoverage = coverage;
        bestIndex = index;
      }
    }
    if (bestIndex < 0 || bestCoverage === 0) break;
    const [best] = remaining.splice(bestIndex, 1);
    selected.push(best);
    best.coveredKeys.forEach((key) => uncovered.delete(key));
  }
  return selected;
}

export function buildMathRenderQa(
  inventory: MathCorpusInventory,
): MathRenderQa {
  const rendered = inventory.candidates.map(renderCandidate);
  const universe = new Set([
    ...inventory.latexCommands.map((item) => `command:${item.token}`),
    ...inventory.unicodeSymbols.map((item) => `unicode:${item.token}`),
  ]);
  // 시각 표본에는 이미 fallback으로 판정된 후보를 선택하지 않는다. 같은 토큰을
  // 안전하게 그리는 다른 실제 코퍼스 문맥이 있으면 그 문맥만 greedy cover에 쓴다.
  const specimens = greedyCover(
    rendered.filter((candidate) => candidate.safe),
    universe,
  );

  const missingLatexCommands = inventory.latexCommands
    .filter(
      ({ token }) =>
        !rendered.some(
          (item) =>
            item.commands.includes(token) &&
            item.safe &&
            item.html.includes("katex"),
        ),
    )
    .map(({ token }) => token);
  const missingUnicodeSymbols = inventory.unicodeSymbols
    .filter(({ token, mathContextCount }) => {
      if (mathContextCount === 0) return false;
      return !rendered.some(
        (item) =>
          item.unicodeSymbols.includes(token) &&
          item.safe &&
          item.html.includes("katex"),
      );
    })
    .map(({ token }) => token);

  return {
    inventory,
    specimens,
    missingUnicodeSymbols,
    missingLatexCommands,
    renderedUnicodeSymbols:
      inventory.unicodeSymbols.length - missingUnicodeSymbols.length,
    renderedLatexCommands:
      inventory.latexCommands.length - missingLatexCommands.length,
  };
}
