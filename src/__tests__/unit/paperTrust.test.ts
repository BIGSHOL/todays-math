/**
 * 시험지 신뢰 가드 — **만점 100 기준** (원장님 지시 2026-08-16).
 * 근거·폐기된 가설은 src/lib/predictor/paperTrust.ts 머리주석 참조.
 */
import { describe, expect, it } from "vitest";

import type { ExamPaper } from "@/contracts/predictor.contract";
import {
  isTrustworthyPaper,
  MIN_QUESTIONS,
  paperTrust,
  partitionTrusted,
} from "@/lib/predictor/paperTrust";

let seq = 0;
const paper = (totalScore: number, questionCount = 21): ExamPaper => ({
  externalExamId: `e${++seq}`,
  series: { school: "영남고", level: "고", grade: 1, subject: "공통수학1" },
  period: { year: 2025, semester: 1, round: "중간" },
  subjectRaw: "수상",
  totalScore,
  sourceFile: null,
  questions: Array.from({ length: questionCount }, (_, i) => ({
    number: i + 1,
    score: totalScore / questionCount,
    qtype: "객관식" as const,
    difficultyLabel: null,
    topicRaw: null,
    unitId: null,
    answer: null,
    hasFigure: false,
    problemId: null,
  })),
});

describe("[T2] 만점 100 판정", () => {
  it("100점 만점으로 볼 수 있는 편은 통과한다", () => {
    // 배점이 2.5·3.75 처럼 소수인 학교가 실재해 합이 100 에서 ±1 안팎으로 흔들린다.
    for (const t of [95, 99, 100, 100.5, 100.7, 101, 105]) {
      expect(isTrustworthyPaper(paper(t))).toBe(true);
    }
  });

  it("🔴 만점이 100 이 아니면 뺀다 — 학교가 52점제라서가 아니라 원본이 잘린 것이다", () => {
    // 경북고 고2 2024 전편이 52점/13~16문인데 같은 학교 2025 는 전부 100점/20~25문이었다.
    const t = paperTrust(paper(52, 14));
    expect(t.trusted).toBe(false);
    expect(t.trusted === false && t.reason).toBe("만점 미달");
  });

  it("🔴 문항수는 멀쩡한데 총점만 모자란 편도 뺀다 (황금중 66점/22문)", () => {
    const t = paperTrust(paper(66, 22));
    expect(t.trusted).toBe(false);
    expect(t.trusted === false && t.shortfall).toBe("배점 누락");
  });

  it("총점·문항수가 같이 무너지면 면 유실로 구분해 보고한다 (대륜중 24점/6문)", () => {
    const t = paperTrust(paper(24, 6));
    expect(t.trusted).toBe(false);
    expect(t.trusted === false && t.shortfall).toBe("면 유실");
  });

  it("만점 초과는 중복 집계로 본다", () => {
    const t = paperTrust(paper(200, 27));
    expect(t.trusted).toBe(false);
    expect(t.trusted === false && t.reason).toBe("만점 초과");
  });

  it("총점이 100 이어도 문항이 너무 적으면 시험지가 아니다", () => {
    const t = paperTrust(paper(100, MIN_QUESTIONS - 1));
    expect(t.trusted).toBe(false);
    expect(t.trusted === false && t.reason).toBe("문항 과소");
  });

  it("제외 사유에 총점과 문항수가 둘 다 들어간다 — 원본을 되짚을 수 있게", () => {
    const t = paperTrust(paper(64, 19));
    expect(t.trusted === false && t.detail).toContain("64");
    expect(t.trusted === false && t.detail).toContain("19");
  });
});

describe("[T2] partitionTrusted — 조용히 버리지 않는다", () => {
  it("사유별로 세어 돌려준다", () => {
    const { trusted, excluded } = partitionTrusted([
      paper(100),
      paper(52, 14),
      paper(99),
      paper(200, 27),
    ]);
    expect(trusted).toHaveLength(2);
    expect(excluded).toHaveLength(2);
    expect(
      excluded.map((e) => e.trust.trusted === false && e.trust.reason),
    ).toEqual(["만점 미달", "만점 초과"]);
  });
});
