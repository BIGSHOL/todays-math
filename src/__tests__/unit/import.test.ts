import { describe, expect, it } from "vitest";

import { blocksToLatex } from "@/lib/import/blocksToLatex";
import { classifyDrafts } from "@/lib/import/buildReport";
import { convertManualSeedQuestion } from "@/lib/import/convertManualSeed";
import { convertPastExamPaper } from "@/lib/import/convertPastExam";
import { convertRpmRow } from "@/lib/import/convertRpm";
import { mapNumericDifficulty } from "@/lib/import/mapDifficulty";
import { mapUnitHint } from "@/lib/import/mapUnit";
import { toLoadRows } from "@/lib/import/toLoadRows";

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

// 실제 완료본 시험지의 소단원 표기가 우리 트리와 어긋난 사례들(2026-08-15 실측).
// 부분문자열로는 하나도 안 붙던 것들이다.
const OVERLAP_UNITS = [
  {
    id: "unit-remainder",
    grade: "공통수학1",
    chapter: "1. 다항식",
    section: "나머지와 인수정리(1)",
  },
  {
    id: "unit-remainder-2",
    grade: "공통수학1",
    chapter: "1. 다항식",
    section: "나머지와 인수정리(2)",
  },
  {
    id: "unit-letter",
    grade: "중1",
    chapter: "3. 문자와 식",
    section: "문자의 사용과 식의 값",
  },
  {
    id: "unit-polymul",
    grade: "중3",
    chapter: "2. 다항식의 곱셈과 인수분해",
    section: "다항식의 곱셈",
  },
  {
    id: "unit-sqrt",
    grade: "중3",
    chapter: "1. 실수와 그 계산",
    section: "제곱근의 뜻과 성질",
  },
  {
    id: "unit-irrational",
    grade: "중3",
    chapter: "1. 실수와 그 계산",
    section: "무리수와 실수",
  },
  {
    id: "unit-sqrt-calc",
    grade: "중3",
    chapter: "1. 실수와 그 계산",
    section: "근호를 포함한 식의 계산",
  },
  {
    id: "unit-elem-graph",
    grade: "초2",
    chapter: "2-5 표와 그래프",
    section: "2-5-1 자료를 분류하여 표로 나타내기",
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

  it("OCR text 블록의 명백한 ASCII 대수식을 인라인 수식으로 감싼다", () => {
    const result = blocksToLatex([
      {
        type: "text",
        value: "포물선 y=x^2+2px+q일 때 p+q의 값은?",
      },
    ]);
    expect(result.content).toContain("$y=x^2+2px+q$");
    expect(result.content).toContain("$p+q$");
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

  it("ALLOW_SHARED_IMPORT=1 이면 Supabase만 공용 풀 적재를 연다", async () => {
    const { classifyDatabaseUrl, allowSharedImport } =
      await import("@/lib/import/classifyDatabaseUrl");
    const supabase = classifyDatabaseUrl(
      "postgresql://postgres.abc:secret@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres",
    );
    const local = classifyDatabaseUrl(
      "postgresql://postgres:postgres@localhost:5432/app",
    );
    expect(allowSharedImport(supabase, { ALLOW_SHARED_IMPORT: "1" })).toBe(
      true,
    );
    expect(allowSharedImport(supabase, {})).toBe(false);
    expect(allowSharedImport(local, { ALLOW_SHARED_IMPORT: "1" })).toBe(false);
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
    expect(rows[0]?.reviewStatus).toBe("approved");
    expect(rows[0]?.directUseAllowed).toBe(true);
    expect(rows[0]?.pool).toBe("shared");
    expect(skipped).toHaveLength(1);
  });
});

function figureDraft(externalId: string) {
  return {
    externalId,
    source: "past_exam" as const,
    directUseAllowed: true,
    difficulty: "mid" as const,
    problemType: "개념" as const,
    content: "[그림] 좌표평면\n\n다음 중 옳은 것은?",
    answer: "1",
    solution: null,
    unitHint: "유리수와 소수",
    hasFigure: true,
    sourceFile: "N:/기출/[중동중][2][25-1-중간](완료).PDF",
  };
}

describe("[T3.0] 단원 매핑 + 미분류 리포트", () => {
  it("섹션 이름이 힌트에 있으면 매핑한다", () => {
    const result = mapUnitHint("유한소수와 유리수와 소수", UNITS, "중2");
    expect(result.status).toBe("mapped");
    if (result.status === "mapped") expect(result.unitId).toBe("unit-finite");
  });

  it("표기가 다르면 단어 겹침으로 붙인다 — '나머지정리와 인수정리'", () => {
    const result = mapUnitHint(
      "나머지정리와 인수정리",
      OVERLAP_UNITS,
      "공통수학1",
    );
    expect(result.status).toBe("mapped");
    if (result.status === "mapped")
      expect(result.unitId).toBe("unit-remainder");
  });

  it("띄어쓰기가 달라도 같은 곳으로 간다 — '나머지 정리와 인수정리'", () => {
    const result = mapUnitHint(
      "나머지 정리와 인수정리",
      OVERLAP_UNITS,
      "공통수학1",
    );
    expect(result.status).toBe("mapped");
    if (result.status === "mapped")
      expect(result.unitId).toBe("unit-remainder");
  });

  it("꼬리만 다른 표기를 붙인다 — '문자의 사용과 식의 계산'", () => {
    const result = mapUnitHint("문자의 사용과 식의 계산", OVERLAP_UNITS, "중1");
    expect(result.status).toBe("mapped");
    if (result.status === "mapped") expect(result.unitId).toBe("unit-letter");
  });

  it("원본 오타를 붙인다 — '다항식의 곱셉'", () => {
    const result = mapUnitHint("다항식의 곱셉", OVERLAP_UNITS, "중3");
    expect(result.status).toBe("mapped");
    if (result.status === "mapped") expect(result.unitId).toBe("unit-polymul");
  });

  // 중단원급 힌트는 소단원 여러 개에 걸친다. 하나를 골라 붙이면 그 단원으로
  // 출제할 때 엉뚱한 문제가 섞인다 — 틀린 매핑보다 미분류가 낫다.
  it("여러 소단원에 걸치는 모호한 힌트는 붙이지 않는다 — '제곱근과 실수'", () => {
    const result = mapUnitHint("제곱근과 실수", OVERLAP_UNITS, "중3");
    expect(result.status).toBe("unclassified");
  });

  it("트리에 없는 개념은 억지로 붙이지 않는다 — '조립제법'", () => {
    const result = mapUnitHint("조립제법", OVERLAP_UNITS, "공통수학1");
    expect(result.status).toBe("unclassified");
  });

  // 실측 사고: 학년 힌트가 없으면 풀이 초1~고3 전체가 된다. 이때 "좌표와 그래프"가
  // 초2 "2-5 표와 그래프" 에 0.67 로 붙어 중등 문항이 초등 단원에 실렸다.
  it("학년을 모르면 유사도 매칭을 하지 않는다", () => {
    const result = mapUnitHint("좌표와 그래프", OVERLAP_UNITS);
    expect(result.status).toBe("unclassified");
  });

  // 장 이름은 소단원 여러 개를 묶은 이름이라 유사도로 붙이면 그중 아무 소단원에
  // 실린다. 장은 부분문자열이 정확히 맞을 때만 쓴다.
  it("장 이름에는 유사도 매칭을 하지 않는다", () => {
    const result = mapUnitHint("실수와 그 계신", OVERLAP_UNITS, "중3");
    expect(result.status).toBe("unclassified");
  });

  // 완료본 PDF 에는 그림이 이미지로 심겨 있다. 저쪽 컴퓨터가 오려 둔 것을
  // 붙일 수 있으면 이관하고, 못 붙이면 종전대로 제외한다 — 그림 없는
  // "[그림] ..." 만 남은 문항은 학생이 풀 수 없다.
  it("그림 파일을 찾으면 그림 문항도 이관하고 경로를 붙인다", () => {
    const { classified, report } = classifyDrafts(
      "past_exam",
      [figureDraft("4212-4"), figureDraft("4212-99")],
      UNITS,
      "중2",
      {
        resolveFigures: (id) =>
          id === "4212-4" ? ["/figures/4212/q04.jpeg"] : undefined,
      },
    );
    expect(report.ok).toBe(1);
    expect(report.skippedFigure).toBe(1);
    expect(classified[0]?.externalId).toBe("4212-4");
    expect(classified[0]?.figureUrls).toEqual(["/figures/4212/q04.jpeg"]);
    expect(classified[0]?.figureSource).toBe("source");
  });

  it("그림 경로는 적재 행까지 그대로 간다", () => {
    const { rows } = toLoadRows(
      [
        {
          ...figureDraft("4212-4"),
          unitId: "unit-finite",
          figureUrls: ["/figures/4212/q04.jpeg"],
          figureSource: "source" as const,
        },
      ],
      "user-1",
    );
    expect(rows[0]?.figureUrls).toEqual(["/figures/4212/q04.jpeg"]);
    expect(rows[0]?.figureSource).toBe("source");
  });

  it("그림이 없는 문항은 빈 배열로 남긴다", () => {
    const { rows } = toLoadRows(
      [{ ...figureDraft("4212-5"), hasFigure: false, unitId: "unit-finite" }],
      "user-1",
    );
    expect(rows[0]?.figureUrls).toEqual([]);
    expect(rows[0]?.figureSource).toBeNull();
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
