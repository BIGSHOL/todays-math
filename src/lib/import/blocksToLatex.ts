import type { ContentBlock } from "./types";

export interface BlocksToLatexResult {
  content: string;
  hasFigure: boolean;
}

function wrapMath(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("$") || trimmed.startsWith("\\[")) return trimmed;
  return `$${trimmed}$`;
}

export function blocksToLatex(blocks: ContentBlock[] | undefined): BlocksToLatexResult {
  if (!blocks || blocks.length === 0) {
    return { content: "", hasFigure: false };
  }

  let hasFigure = false;
  const parts: string[] = [];

  for (const block of blocks) {
    const value = block.value ?? "";
    switch (block.type) {
      case "equation":
        parts.push(wrapMath(value));
        break;
      case "figure":
        hasFigure = true;
        parts.push(`[그림] ${value}`.trim());
        break;
      case "table":
        parts.push(`[표]\n${value}`.trim());
        break;
      default:
        parts.push(value);
    }
  }

  return { content: parts.filter(Boolean).join("\n\n").trim(), hasFigure };
}
