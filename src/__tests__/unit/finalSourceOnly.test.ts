/**
 * 기출 추출은 완료본(원본) 한정 — D-37.
 *
 * 배경(2026-08-14): exam_index.db 9,173문항 전수 실측 결과 워드→PDF 변환본(`(완료)` 표기)은
 * 텍스트 레이어가 살아 있어 OCR 훼손 0.3%, 정답 결손 9.4%. 스캔 원본은 각각 1.6% / 20.0%.
 * 원장님 지시로 **추출 대상을 완료본으로 못박았다**(docs/planning/08-import-ledger.md §5.1).
 *
 * 방침을 문서에만 두면 다음 세션의 이관 작업에서 조용히 새어나간다. 적재 단계에서 막는다.
 * 예외가 필요하면 `ALLOW_NON_FINAL_SOURCE=1` 로 명시적으로 연다(완료본이 아예 없는 시험지).
 */
import { afterEach, describe, expect, it } from "vitest";

import { isFinalSource } from "@/lib/import/finalSource";
import { toLoadRows } from "@/lib/import/toLoadRows";

const BASE = {
  unitId: "11111111-1111-4111-8111-111111111111",
  source: "past_exam" as const,
  difficulty: "easy" as const,
  problemType: "계산" as const,
  content: "본문",
  answer: "3",
  solution: null,
  directUseAllowed: true,
  externalId: "exam-1",
  unitHint: "일차방정식",
  hasFigure: false,
};
const USER = "22222222-2222-4222-8222-222222222222";

const FINAL_PDF = String.raw`N:\개인\기출\HWP 2 PDF\중등\23 기출\[신라중][1][22-1-기말] (완료).PDF`;
const SCAN_HWP = String.raw`N:\개인\기출\[기출]\대구동중학교_1학년_2020_1학기중간_수학_문제.hwp`;

afterEach(() => {
  delete process.env.ALLOW_NON_FINAL_SOURCE;
});

describe("[이관] 완료본 판별", () => {
  it("`(완료)` 표기 파일만 완료본이다", () => {
    expect(isFinalSource(FINAL_PDF)).toBe(true);
    expect(isFinalSource(SCAN_HWP)).toBe(false);
  });

  it("공백·전각 변형(`（완료）`, `(완료 )`)도 완료본으로 본다", () => {
    expect(isFinalSource(String.raw`N:\개인\기출\a （완료）.PDF`)).toBe(true);
    expect(isFinalSource(String.raw`N:\개인\기출\b (완료 ).pdf`)).toBe(true);
  });

  it("경로 정보가 없으면(null) 판별하지 않는다 — 기존 이관분을 막지 않는다", () => {
    expect(isFinalSource(null)).toBe(true);
    expect(isFinalSource(undefined)).toBe(true);
  });
});

describe("[이관] 비완료 원본 적재 차단", () => {
  it("비완료 원본에서 온 문항은 적재하지 않고 사유를 남긴다", () => {
    const { rows, skipped } = toLoadRows(
      [{ ...BASE, sourceFile: SCAN_HWP }],
      USER,
    );

    expect(rows).toHaveLength(0);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.reason).toContain("완료본");
  });

  it("완료본 원본은 그대로 적재한다", () => {
    const { rows, skipped } = toLoadRows(
      [{ ...BASE, sourceFile: FINAL_PDF }],
      USER,
    );

    expect(skipped).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.sourceFile).toBe(FINAL_PDF);
  });

  it("경로가 없는 기존 이관분은 계속 적재된다(회귀 방지)", () => {
    const { rows } = toLoadRows([{ ...BASE }], USER);
    expect(rows).toHaveLength(1);
  });

  it("ALLOW_NON_FINAL_SOURCE=1 이면 비완료도 허용한다(완료본 부재 시 예외)", () => {
    process.env.ALLOW_NON_FINAL_SOURCE = "1";
    const { rows, skipped } = toLoadRows(
      [{ ...BASE, sourceFile: SCAN_HWP }],
      USER,
    );

    expect(skipped).toHaveLength(0);
    expect(rows).toHaveLength(1);
  });

  it("자작·RPM(past_exam 아님)은 완료본 규칙 대상이 아니다", () => {
    const { rows } = toLoadRows(
      [{ ...BASE, source: "manual" as const, sourceFile: SCAN_HWP }],
      USER,
    );
    expect(rows).toHaveLength(1);
  });
});
