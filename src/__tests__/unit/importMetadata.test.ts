/**
 * 이관 메타데이터 보존 — 원본 시험지 역추적용.
 *
 * 배경(2026-08-14): 추출기는 school/grade/subject/exam_id/문항번호/배점을 이미 받고
 * `externalId`(= exam_id-문항번호)까지 만들어 두었는데, `toLoadRows`가 10개 필드만
 * 넘겨 DB 적재 순간 전부 버려졌다. 그 결과 그림 참조 2,155건·OCR 훼손 1,136건을
 * 원본 시험지로 되짚을 방법이 사라졌다(본문 전수 확인 결과 학교명·문항번호 0건).
 *
 * 이 테스트는 메타데이터가 draft → load row 까지 살아남는 것을 고정한다.
 */
import { describe, expect, it } from "vitest";

import { convertPastExamQuestion } from "@/lib/import/convertPastExam";
import { toLoadRows } from "@/lib/import/toLoadRows";

const PAPER = {
  meta: {
    exam_id: "2023-donmun-2-1",
    school: "동문고등학교",
    grade: 2,
    subject: "확률과 통계",
    unit: "경우의 수",
  },
} as const;

const QUESTION = {
  number: 7,
  score: 3.5,
  type: "객관식",
  topic: "순열",
  difficulty: "중",
  contents: [
    { type: "text", value: "서로 다른 5개를 일렬로 배열하는 경우의 수는?" },
  ],
} as const;

describe("[이관] 원본 역추적 메타데이터 보존", () => {
  it("convertPastExamQuestion이 학교·과목·시험·문항번호·배점을 draft에 담는다", () => {
    const draft = convertPastExamQuestion(
      QUESTION as never,
      undefined,
      PAPER as never,
    );

    expect(draft.externalId).toBe("2023-donmun-2-1-7");
    expect(draft.school).toBe("동문고등학교");
    expect(draft.subject).toBe("확률과 통계");
    expect(draft.examId).toBe("2023-donmun-2-1");
    expect(draft.questionNumber).toBe(7);
    expect(draft.score).toBe(3.5);
  });

  it("toLoadRows가 메타데이터를 DB 적재 행까지 넘긴다", () => {
    const draft = convertPastExamQuestion(
      QUESTION as never,
      undefined,
      PAPER as never,
    );
    const { rows } = toLoadRows(
      [{ ...draft, unitId: "11111111-1111-4111-8111-111111111111" }],
      "22222222-2222-4222-8222-222222222222",
    );

    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.externalId).toBe("2023-donmun-2-1-7");
    expect(row.school).toBe("동문고등학교");
    expect(row.subject).toBe("확률과 통계");
    expect(row.questionNumber).toBe(7);
    expect(row.score).toBe(3.5);
  });

  it("메타데이터가 없는 원본도 적재를 막지 않는다(전부 선택 필드)", () => {
    const draft = convertPastExamQuestion(
      { number: 1, contents: [{ type: "text", value: "본문" }] } as never,
      undefined,
      {} as never,
    );
    const { rows, skipped } = toLoadRows(
      [{ ...draft, unitId: "11111111-1111-4111-8111-111111111111" }],
      "22222222-2222-4222-8222-222222222222",
    );

    expect(skipped).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.school).toBeNull();
    expect(rows[0]!.questionNumber).toBe(1);
  });

  it("sourceFile(N드라이브 원본 경로)을 draft에 실어 보낼 수 있다", () => {
    const draft = convertPastExamQuestion(QUESTION as never, undefined, {
      ...PAPER,
      _sourceFile: "개인/기출/2023 기출모음/[동문고][2].hwp",
    } as never);
    expect(draft.sourceFile).toBe("개인/기출/2023 기출모음/[동문고][2].hwp");
  });
});

describe("[이관] externalId 기반 중복 차단", () => {
  it("정답이 백필돼 내용이 달라져도 externalId가 같으면 재삽입하지 않는다", async () => {
    // 2026-08-14 정답 백필로 answer가 바뀌었다. loadRowKey는 answer를 포함하므로
    // 내용 대조만으로는 같은 문항을 '새 것'으로 오인해 중복 삽입한다.
    const { selectMissingLoadRows } =
      await import("../../../scripts/import/load-classified");
    const base = {
      unitId: "11111111-1111-4111-8111-111111111111",
      source: "past_exam" as const,
      difficulty: "easy" as const,
      problemType: "계산" as const,
      content: "본문",
      solution: null,
      reviewStatus: "approved" as const,
      directUseAllowed: true,
      pool: "shared" as const,
      sourceFile: null,
      school: null,
      subject: null,
      examId: null,
      questionNumber: null,
      score: null,
      figureUrls: [],
      figureSource: null,
      figureDims: [],
    };

    const missing = selectMissingLoadRows(
      [{ ...base, userId: "u", answer: "(정답 없음)", externalId: "exam-7" }],
      [{ ...base, answer: "12", externalId: "exam-7" }],
    );

    expect(missing).toHaveLength(0);
  });

  it("externalId가 없으면 종전대로 내용 대조로 판별한다", async () => {
    const { selectMissingLoadRows } =
      await import("../../../scripts/import/load-classified");
    const base = {
      unitId: "11111111-1111-4111-8111-111111111111",
      source: "manual" as const,
      difficulty: "easy" as const,
      problemType: "계산" as const,
      content: "본문2",
      answer: "1",
      solution: null,
      reviewStatus: "approved" as const,
      directUseAllowed: true,
      pool: "shared" as const,
      externalId: null,
      sourceFile: null,
      school: null,
      subject: null,
      examId: null,
      questionNumber: null,
      score: null,
      figureUrls: [],
      figureSource: null,
      figureDims: [],
    };
    expect(selectMissingLoadRows([{ ...base, userId: "u" }], [])).toHaveLength(
      1,
    );
    expect(
      selectMissingLoadRows([{ ...base, userId: "u" }], [base]),
    ).toHaveLength(0);
  });
});
