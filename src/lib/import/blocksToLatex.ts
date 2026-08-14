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

const ASCII_OPERAND = "[A-Za-z0-9]+(?:\\^\\{?[A-Za-z0-9+\\-]+\\}?)?";
const LOOSE_ASCII_MATH_RE = new RegExp(
  `(?<![A-Za-z0-9\\\\])(${ASCII_OPERAND}(?:\\s*[=+\\-*/]\\s*${ASCII_OPERAND})+)(?![A-Za-z0-9])`,
  "gu",
);

/** OCR text 블록에 섞인 `y=x^2+2px+q`, `p+q` 같은 명백한 대수식만 감싼다. */
function wrapLooseAsciiMath(value: string): string {
  // 이미 수식 delimiter 안인 구간은 보존한다.
  return value
    .split(/(\$\$[\s\S]*?\$\$|\$[^$\r\n]*?\$)/gu)
    .map((part, index) =>
      index % 2 === 1
        ? part
        : part.replace(
            LOOSE_ASCII_MATH_RE,
            (_match, math: string) => `$${math}$`,
          ),
    )
    .join("");
}

export function blocksToLatex(
  blocks: ContentBlock[] | undefined,
): BlocksToLatexResult {
  if (!blocks || blocks.length === 0) {
    return { content: "", hasFigure: false };
  }

  let hasFigure = false;
  const parts: string[] = [];

  for (const block of blocks) {
    const value = block.value ?? "";
    switch (block.type) {
      case "equation":
      case "equation_block":
        parts.push(wrapMath(value));
        break;
      case "figure":
      case "diagram":
      case "image_crop":
        hasFigure = true;
        parts.push(`[그림] ${value}`.trim());
        break;
      case "table":
        parts.push(`[표]\n${value}`.trim());
        break;
      default:
        parts.push(wrapLooseAsciiMath(value));
    }
  }

  return { content: parts.filter(Boolean).join("\n\n").trim(), hasFigure };
}
