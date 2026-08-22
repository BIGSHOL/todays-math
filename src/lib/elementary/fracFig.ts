import { fig } from "./make";
import { pick } from "./rng";
import type { Rng } from "./types";

const FILLS = ["#e2b48a", "#7eb89a", "#8f9fd4", "#d4a0c8", "#e0a87a", "#c9b56a"] as const;

/** 그림으로 칸을 보여줄 수 있는 등분. 이보다 크면 계산 문항이지 그림 문항이 아니다. */
export const FRAC_FIG_MAX = 12;

/** 원만 쓰지 않는다. 막대·삼각형 줄·사다리꼴을 섞고 색도 고른다. */
export function fracSpec(rng: Rng, parts: number, filled: number): Record<string, unknown> {
  if (!Number.isInteger(parts) || parts < 2 || parts > FRAC_FIG_MAX) {
    throw new Error(`분수 그림 등분은 2 이상 ${FRAC_FIG_MAX} 이하여야 합니다`);
  }
  if (!Number.isInteger(filled) || filled < 0 || filled > parts) {
    throw new Error("색칠 칸이 등분 범위 밖입니다");
  }
  const fill = pick(rng, FILLS);
  const kinds: string[] = ["fracBars", "fracPie"];
  if (parts <= 8) kinds.push("triRow");
  if (parts === 4) kinds.push("trapFour");
  const kind = pick(rng, kinds);
  if (kind === "fracBars") {
    return fig("fracBars", { cols: parts, rows: 1, filled, fill });
  }
  if (kind === "triRow") {
    return fig("triRow", { n: parts, filled, fill });
  }
  if (kind === "trapFour") {
    return fig("trapFour", { filled, fill });
  }
  return fig("fracPie", { n: parts, filled, fill });
}
