// 추출 결손(서술형 면 유실) 시험지를 학습에서 빼는 가드 — 2026-08-16 실측 근거는
// src/lib/predictor/paperTrust.ts 머리주석 참조.
import { describe, expect, it } from "vitest";

import type { ExamPaper } from "@/contracts/predictor.contract";
import {
  isTrustworthyPaper,
  paperTrust,
  partitionTrusted,
} from "@/lib/predictor/paperTrust";

const paper = (totalScore: number, questionCount = 20): ExamPaper => ({
  externalExamId: `e${totalScore}`,
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

describe("[T2] 시험지 신뢰 가드", () => {
  it("총점 100 근처는 통과한다", () => {
    for (const t of [90, 95, 100, 100.4, 101]) {
      expect(isTrustworthyPaper(paper(t))).toBe(true);
    }
  });

  it("🔴 총점 미달은 서술형 면 유실로 보고 뺀다", () => {
    // 실측: 영남고 총점 64, 대진중 69 — 부족분 중앙값이 정확히 30점(서술형 비중)이었다.
    const t = paperTrust(paper(64));
    expect(t.trusted).toBe(false);
    expect(t.trusted === false && t.reason).toBe("총점 미달");
  });

  it("총점 초과는 중복 집계로 보고 뺀다", () => {
    const t = paperTrust(paper(200));
    expect(t.trusted).toBe(false);
    expect(t.trusted === false && t.reason).toBe("총점 초과");
  });

  it("제외 사유를 세어 돌려준다 — 조용히 버리지 않는다", () => {
    const { trusted, excluded } = partitionTrusted([
      paper(100),
      paper(64),
      paper(96),
      paper(200),
    ]);
    expect(trusted).toHaveLength(2);
    expect(excluded).toHaveLength(2);
    expect(excluded[0].trust.trusted).toBe(false);
    // 사유에 실제 숫자가 들어가야 원본을 되짚을 수 있다.
    expect(
      excluded[0].trust.trusted === false && excluded[0].trust.detail,
    ).toContain("64");
  });
});
