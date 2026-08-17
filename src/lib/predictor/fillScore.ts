/**
 * 배점이 안 읽힌 문항을 무엇으로 메울 것인가.
 *
 * ## 왜 이게 시험지를 통째로 날렸나
 *
 * 추출기는 객관식의 `[3점]` 표기는 잘 읽지만 서술형의 `[합 10점]`·`[총 9점]` 형태는
 * 놓친다. 그러면 서술형 문항만 배점이 비는데, 예전에는 그 자리를 **편 전체 중앙값**으로
 * 메웠다. 객관식이 문항 수를 지배하니 중앙값은 3~4점이고, 실제 10점짜리 서술형 자리에
 * 4점이 들어가 총점이 6점 모자라게 된다.
 *
 * 그 결과 만점 100 신뢰 가드(D-45)에 걸려 **원본이 멀쩡한 시험지가 통째로 버려졌다.**
 * 원본 PDF 를 열어 확인한 실측:
 *
 *   강동중 중2 — 객관식 16문 합 60 + 서술형 4문 × 10점 = **정확히 100**
 *                (추출 90점 → 서술형 배점을 못 읽음)
 *   범일중 중2 — 객관식 66 + 서술형 [총 9][총 8][총 8][총 9] = **정확히 100**
 *                (추출 83점)
 *
 * ## 고친 규칙 — **같은 유형의 중앙값**으로 메운다
 *
 * 서술형 배점이 비면 그 시험지의 **다른 서술형** 배점으로 메운다. 유형별 배점은
 * 유형 안에서 훨씬 고르기 때문이다. 그 유형에 배점이 읽힌 문항이 하나도 없으면
 * 어쩔 수 없이 편 전체 중앙값으로 떨어진다(그것도 없으면 메우지 않는다).
 *
 * 적대적 리뷰 실측: 채움 방식만 바꿔 **25편이 되살아나고 5편이 새로 걸린다**(순 +20).
 * 그중 2편은 원본 PDF 실측치와 정확히 일치했다.
 *
 * ⚠️ 이건 **추정치다.** 진짜 해법은 추출기가 `[합 N점]` 을 읽는 것이고, 이 함수는
 *    그때까지의 보정이다. 메운 문항 수를 세어 보고하는 이유가 그것이다.
 */

/** 배점을 메울 때 쓴 근거. 어느 쪽으로 메웠는지 세어 보고한다. */
export type FillBasis = "본문표기" | "같은유형" | "편전체" | "없음";

/**
 * 서술형 머리표의 배점 표기 — `[합 10점]` · `[총 9 점]`.
 * 추출기가 이 형태를 배점으로 인식하지 못해 문항 배점이 비지만, **본문 텍스트에는
 * 남아 있는 경우가 있다**(실측 4편). 남아 있으면 그건 추정이 아니라 **실제 값**이므로
 * 중앙값보다 먼저 쓴다.
 */
const HEADER_SCORE = /\[\s*(?:합|총)\s*([0-9]+(?:\.[0-9]+)?)\s*점\s*\]/;

/** 문항 본문에 적힌 배점을 읽는다. 없으면 null. */
export function scoreFromText(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = text.match(HEADER_SCORE);
  if (!m) return null;
  const value = Number(m[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export interface ScoredQuestion {
  qtype: string;
  score: number | null;
  /** 문항 본문. `[합 N점]` 표기가 남아 있으면 추정보다 먼저 쓴다. */
  text?: string | null;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** 유효한 배점만 센다 — 0 이나 음수는 "읽혔다"고 보지 않는다. */
function valid(scores: Array<number | null>): number[] {
  return scores.filter((s): s is number => typeof s === "number" && s > 0);
}

/**
 * 한 문항의 배점을 메운다. 같은 유형 → 편 전체 순으로 근거를 찾는다.
 *
 * 이미 배점이 있으면 그대로 둔다 — 읽힌 값을 추정치로 덮지 않는다.
 */
export function fillScore(
  target: ScoredQuestion,
  all: readonly ScoredQuestion[],
): { score: number | null; basis: FillBasis } {
  const fromText = scoreFromText(target.text);

  if (typeof target.score === "number" && target.score > 0) {
    // "읽힌 값은 덮지 않는다"의 **예외** — 본문에 `[합/총 N점]` 이 있는데 기록 배점이
    // 그보다 작으면, 추출기가 `합` 을 몰라 첫 소문항의 `[2점]` 을 집은 것이다
    // (15 §A.0 실측 53문항 · 범물중 "추출 78점 / 원본 100점"의 경로). 표기가 증거다.
    // 같거나 크면 건드리지 않는다 — 증거 없는 정정은 하지 않는다.
    if (fromText !== null && target.score < fromText) {
      return { score: fromText, basis: "본문표기" };
    }
    return { score: target.score, basis: "없음" };
  }

  // 본문에 배점이 적혀 있으면 그건 **추정이 아니라 실제 값**이다. 중앙값보다 먼저.
  if (fromText !== null) return { score: fromText, basis: "본문표기" };

  const sameType = median(
    valid(all.filter((q) => q.qtype === target.qtype).map((q) => q.score)),
  );
  if (sameType !== null) return { score: sameType, basis: "같은유형" };

  const whole = median(valid(all.map((q) => q.score)));
  if (whole !== null) return { score: whole, basis: "편전체" };

  // 그 시험지에서 배점이 하나도 안 읽혔다. 지어내지 않는다.
  return { score: null, basis: "없음" };
}
