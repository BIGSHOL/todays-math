/**
 * 학습에 써도 되는 시험지인가 — 추출 결손을 걸러낸다.
 *
 * 배경(2026-08-16 실측, 코퍼스 2,020편):
 * 총점이 100 근처가 아닌 편이 147편(7.3%) 있었다. 조사해 보니 문항이 드문드문 빠진 게
 * 아니라 **서술형 면이 통째로 유실**된 것이었다.
 *
 *   - 번호 결번 0/147 — 1..N 이 연속이다. 중간이 빠진 게 아니라 뒤가 잘렸다.
 *   - 총점 미달편의 37%가 **서술형 0개**(정상편은 3.6%)
 *   - 부족분 중앙값이 정확히 **30.0점** — 서술형이 차지하는 배점 비중과 일치
 *   - 학교로 몰린다: 영남고 14편 중 13편, 구남중 5편 전부
 *
 * 이걸 그대로 학습하면 단순 결손이 아니라 **편향**이 된다 —
 * 그 학교가 "서술형을 거의 안 낸다" 고 배우고, 하필 유형 배분은
 * 학교 고유성이 가장 확인된 항목(51.1%)이라 **가장 믿는 지표가 가장 틀린다.**
 *
 * ⚠️ 이 필터는 데이터를 지우지 않는다. **학습에서만 뺀다.**
 *    추출기를 고쳐 서술형을 되찾으면 `externalExamId` 멱등이라 다시 넣으면 된다.
 */
import type { ExamPaper } from "@/contracts/predictor.contract";

/** 내신은 100점 만점이다. 반올림·배점 표기 오차를 감안한 신뢰 구간. */
export const TRUSTED_TOTAL_MIN = 90;
export const TRUSTED_TOTAL_MAX = 101;

/** 이 위로는 문항이 중복 집계됐을 가능성이 크다(실측 최대 200). */
export const SUSPICIOUS_TOTAL_MAX = 120;

export type PaperTrust =
  | { trusted: true }
  | { trusted: false; reason: "총점 미달"; detail: string }
  | { trusted: false; reason: "총점 초과"; detail: string };

export function paperTrust(paper: {
  totalScore: number;
  questions: unknown[];
}): PaperTrust {
  const total = paper.totalScore;
  if (total < TRUSTED_TOTAL_MIN) {
    return {
      trusted: false,
      reason: "총점 미달",
      detail: `총점 ${total} (문항 ${paper.questions.length}) — 서술형 면 유실 의심`,
    };
  }
  if (total > TRUSTED_TOTAL_MAX) {
    return {
      trusted: false,
      reason: "총점 초과",
      detail: `총점 ${total} (문항 ${paper.questions.length}) — 중복 집계 의심`,
    };
  }
  return { trusted: true };
}

export function isTrustworthyPaper(paper: {
  totalScore: number;
  questions: unknown[];
}): boolean {
  return paperTrust(paper).trusted;
}

/** 학습용/제외용으로 가른다. 제외분을 세어 보고하는 것까지가 이 함수의 일이다. */
export function partitionTrusted<T extends ExamPaper>(
  papers: T[],
): { trusted: T[]; excluded: Array<{ paper: T; trust: PaperTrust }> } {
  const trusted: T[] = [];
  const excluded: Array<{ paper: T; trust: PaperTrust }> = [];
  for (const paper of papers) {
    const trust = paperTrust(paper);
    if (trust.trusted) trusted.push(paper);
    else excluded.push({ paper, trust });
  }
  return { trusted, excluded };
}
