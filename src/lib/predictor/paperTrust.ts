/**
 * 학습·출제에 써도 되는 시험지인가 — 추출이 불완전한 편을 걸러낸다.
 *
 * ## 규칙 (원장님 지시, 2026-08-16)
 *
 * **만점이 100 이 아닌 시험지는 출제에서 제외한다.** 학습에서도 뺀다 —
 * 잘린 시험지를 넣으면 그 학교가 "문항을 13개만 낸다"고 배운다.
 *
 * ## 폐기된 진단 3건 (같은 자리에서 세 번 틀렸다)
 *
 * 총점이 100 근처가 아닌 편이 147편(7.3%) 있었다. 원인을 세 번 잘못 짚었다.
 *
 *   1. "서술형 면이 통째로 유실됐다" → 원본 PDF 에 서술형이 멀쩡히 있었다. 반증.
 *   2. "배점 추출이 실패했다" → PUA 배점(`\ue035\ue053\ue038점` = "2.5점")도
 *      정확히 해독돼 있었다. 반증.
 *   3. "학교마다 만점이 다르다 — 경북고는 52점제다" → **이것도 틀렸다.**
 *      경북고 고2 2024 는 전편이 52~65점/13~16문인데, **같은 학교 2025 는 전부
 *      100점/20~25문**이다. 학교가 52점제를 쓰다 100점제로 바꾸지 않는다.
 *      2024 원본 묶음이 일괄로 잘린 것이다.
 *
 * 3번을 근거로 "학교별 중앙값 기준"을 만들려다 접었다. 그 기준을 세웠다면
 * 잘린 2024 묶음을 그 학교의 정상 패턴으로 학습할 뻔했다.
 *
 * ## 데이터가 갈라지는 지점 (코퍼스 2,020편 실측)
 *
 *   | 총점대   | 편수 | 평균 문항 | 정황                    |
 *   |---------|------|----------|-------------------------|
 *   | <60     |   25 |   12.0   | 면 유실 — 문항까지 급감  |
 *   | 60~79   |   53 |   18.1   | 면 유실                 |
 *   | 80~94   |  118 |   21.0   | 문항 정상 → 배점 누락    |
 *   | 95~101  | 1798 |   21.3   | **정상 (89%)**          |
 *   | >105    |   10 |   27.0   | 중복 집계               |
 *
 * 문항수는 판정에 쓰지 않고 **결손 유형을 구분해 보고**하는 데 쓴다
 * (`shortfall`). 추출을 고칠 때 어느 쪽을 먼저 볼지 정하는 정보다.
 *
 * ⚠️ 이 필터는 데이터를 지우지 않는다. **학습·채점·출제에서만 뺀다.**
 *    추출기를 고쳐 다시 뽑으면 `externalExamId` 멱등이라 그대로 들어온다.
 */
import type { ExamPaper } from "@/contracts/predictor.contract";

/** 내신 지필의 만점. 이 값이 아닌 시험지는 쓰지 않는다. */
export const EXAM_FULL_MARK = 100;

/**
 * 만점 100 으로 인정하는 폭. 배점이 2.5·3.75 처럼 소수인 학교가 실재해
 * 합이 100.5·100.7 처럼 흔들린다. 95 미만은 실측상 배점 누락 쪽이다.
 */
export const FULL_MARK_MIN = 95;
export const FULL_MARK_MAX = 105;

/** 내신 지필의 최소 문항수. 실측 분포는 p1=14, 중앙 21 — 10개 미만은 시험지가 아니다. */
export const MIN_QUESTIONS = 10;

/** 문항수가 이 아래면 면이 잘린 쪽으로 본다(정상 평균 21). 진단용이며 판정에는 안 쓴다. */
export const SHORT_QUESTION_COUNT = 19;

export type TrustReason = "만점 미달" | "만점 초과" | "문항 과소";

/** 왜 모자란가 — 추출을 고칠 때 어디를 볼지 가리킨다. */
export type Shortfall = "면 유실" | "배점 누락" | null;

export type PaperTrust =
  | { trusted: true }
  | {
      trusted: false;
      reason: TrustReason;
      shortfall: Shortfall;
      detail: string;
    };

/**
 * 학습·채점·출제 **모두** 이 판정을 쓴다. 용도별로 기준을 따로 두면
 * 한쪽만 고쳐지고 조용히 어긋난다.
 */
export function paperTrust(paper: {
  totalScore: number;
  questions: unknown[];
}): PaperTrust {
  const total = paper.totalScore;
  const count = paper.questions.length;
  const shape = `총점 ${total} · 문항 ${count}`;

  if (count < MIN_QUESTIONS) {
    return {
      trusted: false,
      reason: "문항 과소",
      shortfall: "면 유실",
      detail: `${shape} — 문항 ${MIN_QUESTIONS}개 미만, 시험지로 보기 어렵다`,
    };
  }

  if (total < FULL_MARK_MIN) {
    return {
      trusted: false,
      reason: "만점 미달",
      // 문항까지 적으면 뒷면이 잘린 것이고, 문항이 멀쩡하면 배점만 못 읽은 것이다.
      shortfall: count < SHORT_QUESTION_COUNT ? "면 유실" : "배점 누락",
      detail: `${shape} — 만점 ${EXAM_FULL_MARK} 미달, 원본 결손`,
    };
  }

  if (total > FULL_MARK_MAX) {
    return {
      trusted: false,
      reason: "만점 초과",
      shortfall: null,
      detail: `${shape} — 만점 ${EXAM_FULL_MARK} 초과, 중복 집계 의심`,
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
