import { fig } from "./make";
import { pick } from "./rng";
import type { Rng } from "./types";

const FILLS = [
  "#e2b48a",
  "#7eb89a",
  "#8f9fd4",
  "#d4a0c8",
  "#e0a87a",
  "#c9b56a",
] as const;

/** 그림으로 칸을 보여줄 수 있는 등분. 이보다 크면 계산 문항이지 그림 문항이 아니다. */
export const FRAC_FIG_MAX = 12;

/** 원만 쓰지 않는다. 막대·삼각형 줄·사다리꼴을 섞고 색도 고른다. */
export function fracSpec(
  rng: Rng,
  parts: number,
  filled: number,
): Record<string, unknown> {
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

/**
 * 분수 그림 스펙이 **몇 등분인가**. 만드는 쪽 바로 옆에 둔다.
 *
 * 등분 수를 어디에 적는지가 kind 마다 다르다 — `fracBars` 는 `cols`, `triRow`·`fracPie` 는
 * `n`, **`trapFour` 는 아무 데도 안 적는다**(이름이 곧 「넷」이다. 합동인 직각삼각형 넷, D-61).
 *
 * 이 규칙이 만드는 쪽과 세는 쪽에 **두 벌**로 있으면 한쪽만 고쳐도 아무도 모른다.
 * 그래서 여기 하나만 둔다 — 위 `fracSpec` 에 kind 를 더하면 이 함수도 같이 눈에 띈다.
 *
 * 모르는 kind 는 **던진다.** 조용히 `NaN` 을 내면 검사가 「그림이 없다」로 잘못 읽힌다
 * (실제로 그렇게 빨개져서 한참 헤맸다 — 2026-08-22 `trapFour`).
 */
export function fracFigParts(spec: {
  kind?: string;
  cols?: number;
  n?: number;
}): number {
  if (spec.kind === "trapFour") return 4;
  const parts = spec.cols ?? spec.n;
  if (typeof parts !== "number" || !Number.isInteger(parts)) {
    throw new Error(
      `분수 그림 「${spec.kind ?? "?"}」의 등분 수를 못 읽었습니다 — ` +
        `새 kind 를 더했으면 fracFigParts 에도 적으십시오`,
    );
  }
  return parts;
}
