import { describe, expect, it } from "vitest";

import { blocksToLatex } from "@/lib/import/blocksToLatex";
import { classifyDrafts } from "@/lib/import/buildReport";
import { convertManualSeedQuestion } from "@/lib/import/convertManualSeed";
import { convertPastExamPaper } from "@/lib/import/convertPastExam";
import { convertRpmRow } from "@/lib/import/convertRpm";
import { mapNumericDifficulty } from "@/lib/import/mapDifficulty";
import { mapUnitHint } from "@/lib/import/mapUnit";

const UNITS = [
  {
    id: "unit-finite",
    grade: "중2",
    chapter: "1. 수와 식",
    section: "유리수와 소수",
  },
  {
    id: "unit-coord",
    grade: "공통수학2",
    chapter: "1. 도형의 방정식",
    section: "평면좌표",
  },
];

describe("[T3.0] blocksToLatex", () => {
  it("text/equation을 마크다운+LaTeX로 이어 붙인다", () => {
    const result = blocksToLatex([
      { type: "text", value: "무게중심의 좌표가" },
      { type: "equation", value: "a+b" },
    ]);
    expect(result.content).toContain("무게중심의 좌표가");
    expect(result.content).toContain("$a+b$");
    expect(result.hasFigure).toBe(false);
  });

  it("figure 블록은 [그림]으로 남기고 hasFigure=true", () => {
    const result = blocksToLatex([
      { type: "figure", value: "좌표평면 위 삼각형" },
    ]);
    expect(result.hasFigure).toBe(true);
    expect(result.content).toContain("[그림] 좌표평면 위 삼각형");
  });
});

describe("[T3.0] 난이도 매핑", () => {
  it("1~10을 easy/mid/hard로 나눈다", () => {
    expect(mapNumericDifficulty(2)).toBe("easy");
    expect(mapNumericDifficulty(5)).toBe("mid");
    expect(mapNumericDifficulty(9)).toBe("hard");
  });
});

describe("[T3.0] 기출 변환", () => {
  it("본문+선지+정답을 한 문항으로 합친다", () => {
    const drafts = convertPastExamPaper(
      {
        meta: { exam_id: 4209, subject: "공수2", unit: "평면좌표 ~ 명제" },
        questions: [
          {
            number: 1,
            score: 3,
            type: "객관식",
            contents: [{ type: "text", value: "무게중심의 좌표" }],
            choices: [
              { number: 1, contents: [{ type: "equation", value: "3" }] },
              { number: 2, contents: [{ type: "equation", value: "4" }] },
            ],
          },
        ],
      },
      [{ number: 1, answer: "⑤" }],
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.source).toBe("past_exam");
    expect(drafts[0]?.directUseAllowed).toBe(true);
    expect(drafts[0]?.answer).toBe("⑤");
    expect(drafts[0]?.content).toContain("1. $3$");
  });
});

describe("[T3.0] 자작 시드 변환", () => {
  it("객관식 옵션과 난이도 1~10을 변환한다", () => {
    const draft = convertManualSeedQuestion({
      id: "m2-1-1-1-co-001",
      concept_id: "m2-1-1-1",
      concept_name: "유한소수 판별",
      category: "computation",
      question_type: "multiple_choice",
      difficulty: 2,
      content: "분수 7/20을 소수로 나타낼 때",
      options: ["유한소수", "순환소수"],
      correct_answer: "A",
      explanation: "분모 20=2²×5",
    });
    expect(draft.source).toBe("manual");
    expect(draft.directUseAllowed).toBe(true);
    expect(draft.difficulty).toBe("easy");
    expect(draft.problemType).toBe("계산");
    expect(draft.content).toContain("유한소수");
  });
});

describe("[T3.0] RPM 변환", () => {
  it("전량 directUseAllowed=false 로 잠근다", () => {
    const draft = convertRpmRow({
      id: "rpm-1",
      stem: "원본 RPM 문항",
      answer: "1",
      topic: "유리수와 소수",
    });
    expect(draft.source).toBe("transformed");
    expect(draft.directUseAllowed).toBe(false);
  });
});

describe("[T3.0] equation_block과 리포트 파서", () => {
  it("equation_block을 equation과 같이 $...$로 감싼다", () => {
    const result = blocksToLatex([{ type: "equation_block", value: "x^2" }]);
    expect(result.content).toBe("$x^2$");
  });

  it("저장된 리포트를 검증하고 합계를 다시 계산한다", async () => {
    const { parseImportReport, summarizeImportReport, mergeImportReports } =
      await import("@/lib/import/parseReport");
    const report = parseImportReport({
      source: "past_exam",
      total: 3,
      ok: 1,
      unclassified: 1,
      skippedFigure: 1,
      items: [
        {
          externalId: "1",
          source: "past_exam",
          status: "ok",
          unitId: "u1",
          unitHint: "평면좌표",
        },
        {
          externalId: "2",
          source: "past_exam",
          status: "unclassified",
          unitId: null,
          unitHint: "없음",
        },
        {
          externalId: "3",
          source: "past_exam",
          status: "skipped_figure",
          unitId: null,
          unitHint: "평면좌표",
        },
      ],
    });
    expect(summarizeImportReport(report)).toMatchObject({
      total: 3,
      ok: 1,
      unclassified: 1,
      skippedFigure: 1,
      okRate: 1 / 3,
    });
    const merged = mergeImportReports("all", [report, report]);
    expect(merged.total).toBe(6);
    expect(merged.ok).toBe(2);
  });

  it("깨진 리포트는 파싱하지 않는다", async () => {
    const { parseImportReport } = await import("@/lib/import/parseReport");
    expect(() => parseImportReport({ source: "past_exam" })).toThrow(/items/);
  });
});

describe("[T3.0] DATABASE_URL 안전 분류", () => {
  it("로컬 docker만 migrate/적재를 허용한다", async () => {
    const { classifyDatabaseUrl } =
      await import("@/lib/import/classifyDatabaseUrl");
    expect(
      classifyDatabaseUrl("postgresql://postgres:postgres@localhost:5432/app")
        .canMigrateOrLoad,
    ).toBe(true);
    expect(
      classifyDatabaseUrl(
        "postgresql://postgres.abc:secret@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres",
      ),
    ).toMatchObject({
      kind: "supabase",
      canMigrateOrLoad: false,
    });
    expect(classifyDatabaseUrl(undefined).kind).toBe("missing");
  });
});

describe("[T3.0] 기출 header 정규화 + RPM 구조화", () => {
  it("header/_source와 question.topic을 사용한다", async () => {
    const { normalizePastExamPaper, convertPastExamPaper } =
      await import("@/lib/import/convertPastExam");
    const paper = normalizePastExamPaper(
      {
        header: { title: "강동고" },
        questions: [
          {
            number: 1,
            type: "객관식",
            topic: "평면좌표",
            contents: [{ type: "text", value: "좌표" }],
          },
        ],
      },
      "4209",
    );
    const drafts = convertPastExamPaper(paper, []);
    expect(drafts[0]?.externalId).toBe("4209-1");
    expect(drafts[0]?.unitHint).toBe("평면좌표");
    expect(drafts[0]?.gradeHint).toBeUndefined();
  });

  it("범위 힌트는 잘린 토큰으로 매핑한다", () => {
    const result = mapUnitHint("평면좌표 ~ 명제", UNITS, "공수2");
    expect(result.status).toBe("mapped");
    if (result.status === "mapped") expect(result.unitId).toBe("unit-coord");
  });

  it("RPM 구조화 body는 잠근 채 펼친다", async () => {
    const { convertRpmExtractedRow } = await import("@/lib/import/convertRpm");
    const draft = convertRpmExtractedRow({
      id: "rpm-struct",
      kind: "multiple_choice",
      source_ref: { book: "중2-1", unit: "유리수와 소수" },
      body: [
        { type: "text", text: "다음 중" },
        { type: "inline_math", math: { latex: "0.25" } },
      ],
      answer: { text: "1" },
    });
    expect(draft.directUseAllowed).toBe(false);
    expect(draft.source).toBe("transformed");
    expect(draft.content).toContain("다음 중");
    expect(draft.content).toContain("$0.25$");
    expect(draft.unitHint).toBe("유리수와 소수");
    expect(draft.gradeHint).toBe("중2-1");
  });

  it("diagram 블록은 skipped_figure 대상이다", async () => {
    const { convertRpmExtractedRow } = await import("@/lib/import/convertRpm");
    const draft = convertRpmExtractedRow({
      id: "rpm-fig",
      body: [{ type: "diagram", altText: "삼각형" }],
    });
    expect(draft.hasFigure).toBe(true);
  });

  it("classified 행만 createMany 형태로 바꾼다", async () => {
    const { toLoadRows } = await import("@/lib/import/toLoadRows");
    const { rows, skipped } = toLoadRows(
      [
        {
          externalId: "ok-1",
          source: "manual",
          directUseAllowed: true,
          difficulty: "easy",
          problemType: "계산",
          content: "본문",
          answer: "1",
          solution: null,
          unitHint: "유리수와 소수",
          hasFigure: false,
          unitId: "unit-finite",
        },
        {
          externalId: "empty",
          source: "manual",
          directUseAllowed: true,
          difficulty: "easy",
          problemType: "계산",
          content: "   ",
          answer: "1",
          solution: null,
          unitHint: "유리수와 소수",
          hasFigure: false,
          unitId: "unit-finite",
        },
      ],
      "user-1",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.reviewStatus).toBe("pending");
    expect(rows[0]?.directUseAllowed).toBe(true);
    expect(skipped).toHaveLength(1);
  });
});

describe("[T3.0] 단원 매핑 + 미분류 리포트", () => {
  it("섹션 이름이 힌트에 있으면 매핑한다", () => {
    const result = mapUnitHint("유한소수와 유리수와 소수", UNITS, "중2");
    expect(result.status).toBe("mapped");
    if (result.status === "mapped") expect(result.unitId).toBe("unit-finite");
  });

  it("매핑 실패분은 unclassified로 남기고 버리지 않는다", () => {
    const { classified, report } = classifyDrafts(
      "past_exam",
      [
        {
          externalId: "1-1",
          source: "past_exam",
          directUseAllowed: true,
          difficulty: "mid",
          problemType: "개념",
          content: "ok",
          answer: "1",
          solution: null,
          unitHint: "평면좌표",
          hasFigure: false,
        },
        {
          externalId: "1-2",
          source: "past_exam",
          directUseAllowed: true,
          difficulty: "mid",
          problemType: "개념",
          content: "nope",
          answer: "1",
          solution: null,
          unitHint: "존재하지 않는 단원명",
          hasFigure: false,
        },
        {
          externalId: "1-3",
          source: "past_exam",
          directUseAllowed: true,
          difficulty: "mid",
          problemType: "개념",
          content: "fig",
          answer: "1",
          solution: null,
          unitHint: "평면좌표",
          hasFigure: true,
        },
      ],
      UNITS,
      "공수2",
    );

    expect(classified).toHaveLength(1);
    expect(report.ok).toBe(1);
    expect(report.unclassified).toBe(1);
    expect(report.skippedFigure).toBe(1);
    expect(report.items.map((item) => item.status)).toEqual([
      "ok",
      "unclassified",
      "skipped_figure",
    ]);
  });
});
