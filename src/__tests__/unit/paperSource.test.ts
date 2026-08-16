/**
 * 🔴 RED — 시험지 출처 판정 (학교 기출 vs 학원 대비 자료).
 *
 * ## 왜 이 구분이 필요한가
 *
 * 코퍼스에 원장님이 **직접 만드신 '내신 대비' 자료 144편**이 학교 기출과 구분 없이
 * 섞여 있었다. PDF 표지에 학원 로고와 "○○고 25년 2학기 중간고사 대비"가 찍혀 있고,
 * 문항마다 `[소단원]`·`[난이도]` 라벨이 붙어 있으며, 144편 전부 정답·해설이 딸려 있다.
 *
 * **내용도 기출이 아니다** — 대비 문항 3,410개 중 어떤 실제 기출과도 일치하지 않는 것이
 * 3,385개(99.3%)다. 기출을 재편집한 것이 아니라 그 회차를 겨냥해 새로 만든 문항이다.
 *
 * 이걸 "그 학교 기출"로 학습하면 **엔진이 원장님의 과거 추측을 학교의 출제 패턴으로
 * 배운다.** 자기가 낸 답을 정답지로 삼는 되먹임이다. 실제 피해도 실측됐다:
 *   - 다음 회차 예상 문항 수가 평균 +1.2문, 최대 +3.1문 부풀려진다
 *     (대비는 25문 템플릿, 실제 기출은 21.2±2.0문)
 *   - 달서고·비슬고·영남고·영신고 고1은 **실제 기출이 0편**이라 그 학교 "패턴"이
 *     100% 원장님 추측에서 나온다
 *   - 신뢰 가드(D-45)가 오히려 대비를 선호한다 — 템플릿이라 81%가 정확히 100.00점이다
 *
 * ## 그래도 버리지 않는다
 *
 * 시험 범위 판단·사람이 붙인 라벨·예측 문제지 생성기의 대조군으로 값이 크다.
 * **지우지 않고 출처만 갈라, 학교 출제 패턴 학습에서만 뺀다.**
 */
import { describe, expect, it } from "vitest";

import {
  classifyPaperSource,
  isSchoolExam,
  PAPER_SOURCE_HINT,
} from "@/lib/predictor/paperSource";

describe("[T7.16] 시험지 출처 판정", () => {
  it("파일명에 '대비'가 있으면 학원 대비 자료로 본다", () => {
    for (const p of [
      String.raw`N:\개인\기출\HWP 2 PDF\기출\24 기출\2학기 중간\고1\[경상고][1][공수2][24-2-중간대비][와이비엠] (완료).PDF`,
      String.raw`N:\...\[시지고][1][공수1][25-1-기말고사대비][미래엔] (완료).PDF`,
      String.raw`N:\...\[영송여고][1][공수2][25-2-기말 대비][동아] (완료).PDF`,
    ]) {
      expect(classifyPaperSource(p)).toBe("대비");
      expect(isSchoolExam(p)).toBe(false);
    }
  });

  it("실제 기출은 학교 기출로 본다", () => {
    for (const p of [
      String.raw`N:\개인\기출\HWP 2 PDF\기출\23 기출\2학기 기말\중2\[강동중][2][중2][23-2-기말][비상] (완료).PDF`,
      String.raw`N:\개인\기출\2025 기출모음\...\[경북고][2][수2][25-1-중간][천재] (완료).PDF`,
    ]) {
      expect(classifyPaperSource(p)).toBe("기출");
      expect(isSchoolExam(p)).toBe(true);
    }
  });

  it("🔴 출처를 모르면 기출이라고 우기지 않는다", () => {
    // 경로가 없으면 판정 근거가 없다. '기출'로 단정하면 대비 자료가 조용히 섞인다.
    expect(classifyPaperSource(null)).toBe("미상");
    expect(classifyPaperSource("")).toBe("미상");
    expect(isSchoolExam(null)).toBe(false);
  });

  it("학습에 쓰는 것은 **기출로 확인된 것뿐**이다 — 미상은 넣지 않는다", () => {
    expect(
      isSchoolExam(String.raw`N:\...\[강동중][2][중2][23-2-기말][비상].PDF`),
    ).toBe(true);
    expect(isSchoolExam("")).toBe(false);
  });

  it("판정 근거를 문자열로 남긴다 — 나중에 사람이 되짚을 수 있어야 한다", () => {
    expect(PAPER_SOURCE_HINT).toContain("대비");
  });
});
