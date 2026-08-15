import { describe, expect, it } from "vitest";

import { blocksToLatex } from "@/lib/import/blocksToLatex";
import { classifyDrafts } from "@/lib/import/buildReport";
import { convertManualSeedQuestion } from "@/lib/import/convertManualSeed";
import { convertPastExamPaper } from "@/lib/import/convertPastExam";
import { convertRpmRow } from "@/lib/import/convertRpm";
import { mapNumericDifficulty } from "@/lib/import/mapDifficulty";
import { mapUnitHint, normalizeGrade } from "@/lib/import/mapUnit";
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
    section: "2-5-1 표와 그래프 읽기",
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

  // 원래는 중단원급 힌트를 미분류로 남겼다(틀린 매핑보다 미분류가 낫다).
  // 2026-08-15 원장님이 "합리적인 방향에서" 붙이라고 확정 — B단계에서 이
  // 부류가 2,500건을 넘었다. 대신 **중단원은 확정**하고 소단원만 그 안에서
  // 최근접을 고른다. 오차가 중단원 밖으로 나가지 않는 게 '합리적'의 기준이다.
  it("중단원급 힌트는 그 중단원 안으로 들어간다 — '제곱근과 실수'", () => {
    const result = mapUnitHint("제곱근과 실수", OVERLAP_UNITS, "중3");
    expect(result.status).toBe("mapped");
    if (result.status === "mapped") expect(result.unitId).toBe("unit-sqrt");
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

  // 학년이 해석되지 않으면 pool 이 초1~고3 전체가 된다. 그 상태로 유사도를
  // 재면 학년이 통째로 어긋난 곳에 붙는다 — 표기가 닮은 단원은 학년을 넘나든다.
  it("학년이 해석 안 되면 다른 학년의 닮은 소단원에 붙지 않는다", () => {
    const result = mapUnitHint("좌표와 그래프 읽기", OVERLAP_UNITS);
    expect(result.status).toBe("unclassified");
  });

  it("학년 힌트가 null 이어도 죽지 않는다", () => {
    expect(normalizeGrade(null as unknown as undefined)).toBeNull();
    const result = mapUnitHint(
      "나머지정리와 인수정리",
      OVERLAP_UNITS,
      null as unknown as undefined,
    );
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
        resolveFigures: (draft) =>
          draft.externalId === "4212-4"
            ? ["/figures/4212/q04.jpeg"]
            : undefined,
      },
    );
    expect(report.ok).toBe(1);
    expect(report.skippedFigure).toBe(1);
    expect(classified[0]?.externalId).toBe("4212-4");
    expect(classified[0]?.figureUrls).toEqual(["/figures/4212/q04.jpeg"]);
    expect(classified[0]?.figureSource).toBe("source");
  });

  // 2026-08-16 실측: 재연결 못 한 695건 중 690건이 이 구멍으로 샜다.
  // 추출기(textlayer)의 `figure` 블록 유무(`hasFigure`)로 대장 조회를 막으면,
  // 추출기가 그림을 못 본 문항은 **대장에 그림이 있어도** 영원히 안 붙는다.
  // 대장(map-figures, 좌표 기반)이 추출기보다 정확하다 — 대장을 먼저 본다.
  it("추출기가 그림을 못 봐도(hasFigure=false) 대장에 있으면 붙인다", () => {
    const { classified, report } = classifyDrafts(
      "past_exam",
      [{ ...figureDraft("4212-4"), hasFigure: false }],
      UNITS,
      "중2",
      { resolveFigures: () => ["/figures/4212/q04.jpeg"] },
    );
    expect(report.ok).toBe(1);
    expect(classified[0]?.figureUrls).toEqual(["/figures/4212/q04.jpeg"]);
    expect(classified[0]?.figureSource).toBe("source");
  });

  // 그림이 필요 없는 문항까지 대장 조회로 그림이 붙으면 오배치가 된다.
  // 대장에 없으면 종전대로 아무것도 붙지 않고, 제외 대상도 아니다.
  it("대장에 없는 비그림 문항은 그대로 통과시킨다", () => {
    const { classified, report } = classifyDrafts(
      "past_exam",
      [{ ...figureDraft("4212-7"), hasFigure: false }],
      UNITS,
      "중2",
      { resolveFigures: () => undefined },
    );
    expect(report.ok).toBe(1);
    expect(report.skippedFigure).toBe(0);
    expect(classified[0]?.figureUrls).toBeUndefined();
  });

  // 대장 조회 콜백은 초안 전체를 받는다 — 받는 쪽이 `source` 로 먼저 거를 수
  // 있어야 `externalId` 형식 가정이 조용히 깨지지 않는다.
  it("대장 조회 콜백은 초안을 그대로 받는다", () => {
    const seen: Array<{ source: string; externalId: string }> = [];
    classifyDrafts(
      "past_exam",
      [{ ...figureDraft("4212-4"), hasFigure: false }],
      UNITS,
      "중2",
      {
        resolveFigures: (draft) => {
          seen.push({ source: draft.source, externalId: draft.externalId });
          return undefined;
        },
      },
    );
    expect(seen).toEqual([{ source: "past_exam", externalId: "4212-4" }]);
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

  // exam_index 는 meta.grade 에 이미 우리 트리 라벨을 담아 준다("중3","공통수학1").
  // meta.subject 는 시험지 원본 표기("수학","수상")라 트리 라벨이 아니다 —
  // subject 를 먼저 보면 중등 시험지 3,599문항의 학년이 통째로 해석 실패한다(실측).
  it("학년 힌트는 트리 라벨인 meta.grade 를 먼저 쓴다", async () => {
    const { convertPastExamPaper } =
      await import("@/lib/import/convertPastExam");
    const drafts = convertPastExamPaper(
      {
        meta: { exam_id: 9001, grade: "중3", subject: "수학" },
        questions: [
          {
            number: 1,
            contents: [{ type: "text", value: "1+1은?" }],
            topic: "다항식의 곱셈",
          },
        ],
      },
      [],
    );
    expect(drafts[0]?.gradeHint).toBe("중3");
  });

  it("meta.grade 가 없으면 subject 로 떨어진다", async () => {
    const { convertPastExamPaper } =
      await import("@/lib/import/convertPastExam");
    const drafts = convertPastExamPaper(
      {
        meta: { exam_id: 9002, subject: "공수2" },
        questions: [
          {
            number: 1,
            contents: [{ type: "text", value: "1+1은?" }],
            topic: "평면좌표",
          },
        ],
      },
      [],
    );
    expect(drafts[0]?.gradeHint).toBe("공수2");
  });

  // 시험지 표기와 우리 소단원 이름이 아예 다른데 뜻은 1:1 로 같은 것들.
  // 유사도로는 안 붙고(0.13~0.46) 사람이 판단해야 한다. 학년까지 맞아야 쓴다.
  it("학년별 소단원 별칭으로 붙인다 — 미정계수법 = 항등식", () => {
    const units = [
      {
        id: "u-ident",
        grade: "공통수학1",
        chapter: "1. 다항식",
        section: "항등식",
      },
      {
        id: "u-mul",
        grade: "공통수학1",
        chapter: "1. 다항식",
        section: "다항식의 곱셈",
      },
    ];
    const result = mapUnitHint("미정계수법", units, "공통수학1");
    expect(result.status).toBe("mapped");
    if (result.status === "mapped") expect(result.unitId).toBe("u-ident");
  });

  it("별칭은 학년이 다르면 쓰지 않는다", () => {
    const units = [
      { id: "u-ident", grade: "중3", chapter: "1. 다항식", section: "항등식" },
    ];
    const result = mapUnitHint("미정계수법", units, "중3");
    expect(result.status).toBe("unclassified");
  });

  // 513건이 틀린 학년 단원에 실린 사고가 **조용히** 났다. 학년이 해석되지
  // 않으면 초1~고3 전체 풀에서 단원을 고르는데, 리포트에 그 사실이 안 찍혔다.
  // B단계로 4.3만 문항이 들어오므로 숫자로 보이게 만든다.
  it("학년이 해석 안 된 문항 수를 리포트에 남긴다", () => {
    const { report } = classifyDrafts(
      "past_exam",
      [
        { ...figureDraft("e-1"), hasFigure: false, gradeHint: "중2" },
        { ...figureDraft("e-2"), hasFigure: false, gradeHint: "수학" },
        { ...figureDraft("e-3"), hasFigure: false, gradeHint: undefined },
      ],
      UNITS,
    );
    expect(report.unresolvedGrade).toBe(2);
  });

  // 시험지가 중단원 이름으로만 태그한 경우(“일차함수와 그래프”, “제곱근과 실수”).
  // 소단원 여러 개에 걸치므로 1:1 별칭을 쓸 수 없다. 대신 **중단원은 확실히
  // 맞추고** 그 안에서 가장 가까운 소단원을 고른다 — 틀려도 같은 중단원 안이다.
  it("중단원급 힌트는 그 중단원 안의 최근접 소단원으로 간다", () => {
    const units = [
      {
        id: "u-sqrt",
        grade: "중3",
        chapter: "1. 실수와 그 계산",
        section: "제곱근의 뜻과 성질",
      },
      {
        id: "u-irr",
        grade: "중3",
        chapter: "1. 실수와 그 계산",
        section: "무리수와 실수",
      },
      { id: "u-far", grade: "중3", chapter: "6. 원의 성질", section: "원주각" },
    ];
    const result = mapUnitHint("제곱근과 실수", units, "중3");
    expect(result.status).toBe("mapped");
    if (result.status === "mapped") expect(result.unitId).toBe("u-sqrt");
  });

  it("중단원 별칭도 학년이 다르면 쓰지 않는다", () => {
    const units = [
      {
        id: "u-sqrt",
        grade: "중2",
        chapter: "1. 실수와 그 계산",
        section: "제곱근의 뜻과 성질",
      },
    ];
    expect(mapUnitHint("제곱근과 실수", units, "중2").status).toBe(
      "unclassified",
    );
  });

  it("중단원이 트리에 없으면 붙이지 않는다", () => {
    const units = [
      { id: "u-x", grade: "중3", chapter: "9. 통계", section: "대푯값" },
    ];
    expect(mapUnitHint("제곱근과 실수", units, "중3").status).toBe(
      "unclassified",
    );
  });

  // 실측 사고(2026-08-15): RPM 이관분 4,862행의 정답이 **전량** 비어 있었다.
  // flattenStructured 가 runs/content/choices/items/rows 만 훑고
  // `correctChoiceIds`(객관식)·`accepted`(주관식) 를 안 봐서 통째로 날아갔다.
  // 같은 경로를 타는 explanation 은 4,430건이 멀쩡해 정답만 유실된 게 드러났다.
  it("RPM 객관식 정답을 보기 번호로 되살린다", async () => {
    const { convertRpmExtractedRow } = await import("@/lib/import/convertRpm");
    const draft = convertRpmExtractedRow({
      id: "rpm-mc",
      kind: "multiple_choice",
      source_ref: { book: "중2-1", unit: "유리수와 소수" },
      body: [{ type: "text", text: "다음 중 옳은 것은?" }],
      choices: [
        {
          choiceId: "c1",
          marker: "①",
          order: 1,
          content: [{ type: "text", text: "가" }],
        },
        {
          choiceId: "c2",
          marker: "②",
          order: 2,
          content: [{ type: "text", text: "나" }],
        },
        {
          choiceId: "c3",
          marker: "③",
          order: 3,
          content: [{ type: "text", text: "다" }],
        },
      ],
      answer: { correctChoiceIds: ["c3"] },
    });
    expect(draft.answer).toBe("③");
  });

  it("RPM 주관식 정답을 accepted 값에서 되살린다", async () => {
    const { convertRpmExtractedRow } = await import("@/lib/import/convertRpm");
    const draft = convertRpmExtractedRow({
      id: "rpm-sa",
      kind: "short_answer",
      source_ref: { book: "중2-1", unit: "유리수와 소수" },
      body: [{ type: "text", text: "값을 구하시오." }],
      answer: { accepted: [{ value: "36" }] },
    });
    expect(draft.answer).toBe("36");
  });

  // 마커가 없으면 시험지에 보기 번호가 안 찍혀 학생이 정답과 대조할 수 없다.
  // 원본 body 꼬리에는 마커 없는 보기 값이 이미 한 벌 들어 있다(실측 1,884행 전부).
  // 그대로 두고 마커 보기를 또 붙이면 지면에 같은 보기가 두 번 인쇄된다.
  it("본문 꼬리에 겹쳐 있던 보기는 걷어 낸다", async () => {
    const { convertRpmExtractedRow } = await import("@/lib/import/convertRpm");
    const draft = convertRpmExtractedRow({
      id: "rpm-dup",
      kind: "multiple_choice",
      source_ref: { book: "중2-1", unit: "유리수와 소수" },
      body: [
        { type: "text", text: "다음 중 옳은 것은?" },
        { type: "text", text: "가" },
        { type: "text", text: "나" },
      ],
      choices: [
        {
          choiceId: "c1",
          marker: "①",
          order: 1,
          content: [{ type: "text", text: "가" }],
        },
        {
          choiceId: "c2",
          marker: "②",
          order: 2,
          content: [{ type: "text", text: "나" }],
        },
      ],
      answer: { correctChoiceIds: ["c2"] },
    });
    expect(draft.content).toBe("다음 중 옳은 것은?\n\n① 가\n② 나");
    expect(draft.answer).toBe("②");
  });

  it("RPM 보기에 마커를 붙여 본문에 싣는다", async () => {
    const { convertRpmExtractedRow } = await import("@/lib/import/convertRpm");
    const draft = convertRpmExtractedRow({
      id: "rpm-marker",
      kind: "multiple_choice",
      source_ref: { book: "중2-1", unit: "유리수와 소수" },
      body: [{ type: "text", text: "다음 중 옳은 것은?" }],
      choices: [
        {
          choiceId: "c1",
          marker: "①",
          order: 1,
          content: [{ type: "text", text: "가" }],
        },
        {
          choiceId: "c2",
          marker: "②",
          order: 2,
          content: [{ type: "text", text: "나" }],
        },
      ],
      answer: { correctChoiceIds: ["c1"] },
    });
    expect(draft.content).toContain("① 가");
    expect(draft.content).toContain("② 나");
  });

  // 실측 사고(2026-08-15): `물음에 답하시오.` 로 끝나고 ⑴⑵ 가 통째로 없는
  // 문항이 149건 나왔다. 원본에는 `sub_questions` 에 멀쩡히 들어 있는데
  // convertPastExam 이 그 키를 **타입에만 선언하고 읽지 않았다.**
  // 소문항이 없으면 문제가 성립하지 않아 풀 수도 출제할 수도 없다.
  it("소문항(sub_questions)을 본문에 싣는다", async () => {
    const { convertPastExamPaper } =
      await import("@/lib/import/convertPastExam");
    const drafts = convertPastExamPaper(
      {
        meta: { exam_id: 9100, grade: "중3", subject: "수학" },
        questions: [
          {
            number: 1,
            contents: [{ type: "text", value: "물음에 답하시오." }],
            topic: "다항식의 곱셈",
            sub_questions: [
              {
                number: 1,
                contents: [{ type: "text", value: "x를 구하시오." }],
              },
              {
                number: 2,
                contents: [{ type: "text", value: "y를 구하시오." }],
              },
            ],
          },
        ],
      },
      [],
    );
    expect(drafts[0]?.content).toContain("물음에 답하시오.");
    expect(drafts[0]?.content).toContain("⑴ x를 구하시오.");
    expect(drafts[0]?.content).toContain("⑵ y를 구하시오.");
  });

  it("소문항이 없으면 본문이 달라지지 않는다", async () => {
    const { convertPastExamPaper } =
      await import("@/lib/import/convertPastExam");
    const drafts = convertPastExamPaper(
      {
        meta: { exam_id: 9101, grade: "중3", subject: "수학" },
        questions: [
          {
            number: 1,
            contents: [{ type: "text", value: "다음을 계산하시오." }],
            topic: "다항식의 곱셈",
          },
        ],
      },
      [],
    );
    expect(drafts[0]?.content).toBe("다음을 계산하시오.");
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
