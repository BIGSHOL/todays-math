// 기출 시험지의 **정체**를 정하는 규칙 — 파일명·문서 제목·단원 라벨 셋을 맞대어
// 「이 편은 어느 학교의 몇 년 몇 학기 무슨 시험인가」를 정한다.
//
// 표본은 전부 실제 데이터에서 가져왔다(2026-08-18 전수 조사, 2,701편).
// 근거: docs/planning/tracks/reports/exam-metadata.md
import { describe, expect, it } from "vitest";

import {
  buildExamKey,
  decideExamIdentity,
  isDegradedHeader,
  parseExamFileName,
  parseExamHeader,
  parseFolderPeriod,
  resolveCurriculumSubject,
} from "@/lib/import/examIdentity";

/** 실제 N드라이브 경로 모양. 폴더가 제3의 심판이 된다. */
const IN = (dir: string, name: string) => `N:\\개인\\기출\\${dir}\\${name}`;

describe("parseExamFileName — 파일명 구조 파싱", () => {
  it("고등: [학교][학년][과목][연-학기-회차][교과서]", () => {
    const p = parseExamFileName(
      "N:\\개인\\기출\\2023 기출모음\\[강동고][1][수하][23-2-중간][미래엔] (완료).hwp",
    );
    expect(p).toMatchObject({
      school: "강동고",
      grade: 1,
      subjectRaw: "수하",
      publisher: "미래엔",
      year: 2023,
      semester: 2,
      round: "중간",
      prepLabelled: false,
    });
  });

  it("중등: 과목 칸이 없다 — 지어내지 않고 null 로 둔다", () => {
    const p = parseExamFileName("[영남중][3][24-1-기말][동아강] ( 완료).PDF");
    expect(p).toMatchObject({
      school: "영남중",
      grade: 3,
      subjectRaw: null,
      publisher: "동아강",
      year: 2024,
      semester: 1,
      round: "기말",
    });
  });

  it("교과서 칸도 없는 편", () => {
    const p = parseExamFileName("[도원중][3][23-1-중간] (완료).hwp");
    expect(p).toMatchObject({ school: "도원중", grade: 3, publisher: null });
  });

  // 실측 37종의 기간 토큰 — 하이픈·공백·「년」·네자리 연도가 뒤섞여 있다.
  it.each([
    ["[대구일중][1][23-1기말] (완료).hwp", 2023, 1, "기말"],
    ["[노변중][3][24년-1기말][동아강] (완료).PDF", 2024, 1, "기말"],
    ["[계성고][2][수1][2025-1-중간][미래엔] (완료).PDF", 2025, 1, "중간"],
    ["[남산고][1][공수1][25-1 중간][동아] (완료).PDF", 2025, 1, "중간"],
    ["[사대부중][1][25-1 기말][비상] (완료).hwp", 2025, 1, "기말"],
  ])("기간 표기 흔들림을 흡수한다: %s", (name, year, semester, round) => {
    expect(parseExamFileName(name as string)).toMatchObject({
      year,
      semester,
      round,
    });
  });

  it("대괄호가 겹친 편도 읽는다", () => {
    expect(
      parseExamFileName("[대륜중][2][[23-1-중간] (완료).hwp"),
    ).toMatchObject({ school: "대륜중", grade: 2, year: 2023 });
  });

  it("「대비」가 붙은 파일명은 **표시만** 하고 시점 판단에 쓰지 않는다", () => {
    expect(
      parseExamFileName("[강북고][1][공수2][25-2-중간대비][비상] (완료).PDF"),
    ).toMatchObject({ year: 2025, round: "중간", prepLabelled: true });
    expect(
      parseExamFileName(
        "[대륜고][1][공수1][25-1 기말고사 대비][미래엔] (완료).PDF",
      ),
    ).toMatchObject({ year: 2025, round: "기말", prepLabelled: true });
  });

  it("과목이 기간 뒤에 온 편도 자리로 가른다 (실측 1편)", () => {
    expect(
      parseExamFileName("[화원고][2][25-2-기말][확통][미래엔] (완료).hwp"),
    ).toMatchObject({ subjectRaw: "확통", publisher: "미래엔" });
  });

  // 변이 시험(2026-08-19)에서 「둘이어도 첫 것을 쓴다」가 **살아남았다** — 규칙은 맞는데
  // 이 픽스처가 없었다. 실코퍼스 2,703편에는 이런 파일이 0건이지만, 생기면 어느 쪽이
  // 그 시험지의 시점인지 알 수 없으므로 고르면 안 된다.
  it("⭐ 기간 토큰이 둘이면 null — 어느 쪽인지 고르지 않는다", () => {
    expect(
      parseExamFileName("[화원고][2][25-1-중간][25-2-기말][미래엔] (완료).hwp"),
    ).toBeNull();
    expect(
      parseExamFileName("[대륜고][1][공수1][24-1-중간][24-1-기말] (완료).PDF"),
    ).toBeNull();
  });

  it("기간 토큰이 없으면 null — 지어내지 않는다", () => {
    expect(parseExamFileName("[정화중][1][비상] (완료).hwp")).toBeNull();
    expect(parseExamFileName("")).toBeNull();
  });
});

describe("parseExamHeader — 문서 제목줄이 시점의 정본이다", () => {
  it("첫 줄에서 시점을, 다음 줄에서 학교·학년·과목을 읽는다", () => {
    const h = parseExamHeader([
      "2024년 2학기 중간고사",
      "강북고 1학년 수학",
      "학원 로고",
      "강북고 25년 2학기 중간고사 대비 (공통수학2)",
    ]);
    expect(h).toMatchObject({
      year: 2024,
      semester: 2,
      round: "중간",
      prep: false,
      school: "강북고",
      grade: 1,
    });
  });

  it("제목에 「대비」가 붙으면 그 편은 대비 시험지다", () => {
    expect(
      parseExamHeader([
        "2025년 2학기 중간고사 대비",
        "강동고 1학년 공통수학 2",
        "학원 로고",
      ]),
    ).toMatchObject({ year: 2025, prep: true });
  });

  it("⭐ 머리말(4줄)의 연도를 시점으로 읽지 않는다 — 머리말은 +1 년이다", () => {
    const h = parseExamHeader([
      "2024년 2학기 중간고사",
      "경상고 1학년 수학",
      "학원 로고",
      "경상고 25년 2학기 중간고사 대비 (공통수학2)",
    ]);
    expect(isDegradedHeader(h)).toBe(false);
    expect(h).toMatchObject({ year: 2024, prep: false });
  });

  it("제목줄이 없으면 null", () => {
    expect(parseExamHeader(["학원 로고", "1. 다음 중 옳은 것은?"])).toBeNull();
    expect(parseExamHeader([])).toBeNull();
  });

  it("⭐ 학기·회차 글자가 빠진 훼손 제목은 「없음」과 구분한다 (실측 8편)", () => {
    const h = parseExamHeader([
      "2024년 학기 고사",
      "고 2학년 수학1",
      "학원 로고",
      "동부고 25년 1학기  중간고사 대비 (수학1)",
    ]);
    expect(h).toEqual({ degraded: true, year: 2024, line: "2024년 학기 고사" });
  });

  it("⭐ 머리말은 훼손 제목으로도 잡히지 않는다 — 두 자리 연도에 학교명이 앞에 온다", () => {
    expect(
      parseExamHeader([
        "학원 로고",
        "동부고 25년 1학기  중간고사 대비 (수학1)",
      ]),
    ).toBeNull();
  });
});

describe("parseFolderPeriod — 원본이 놓인 폴더가 제3의 심판이다", () => {
  it("연·학기·회차를 폴더 이름에서 읽는다", () => {
    expect(
      parseFolderPeriod(
        IN("2023 기출모음\\2023년 2학기 중간 고사 모음\\##워드\\중3", "x.hwp"),
      ),
    ).toEqual({ year: 2023, semester: 2, round: "중간" });
  });

  it("두 자리 연도 폴더(`24 기출`)도 읽는다", () => {
    expect(
      parseFolderPeriod(
        IN("HWP 2 PDF\\기출\\24 기출\\2학기 중간\\고1", "x.PDF"),
      ),
    ).toEqual({ year: 2024, semester: 2, round: "중간" });
  });

  it("⭐ 더 깊은 폴더가 이긴다 — 바깥이 `1학기`여도 안쪽 `2학기 기말고사`가 답이다", () => {
    expect(
      parseFolderPeriod(
        IN(
          "2025 기출모음\\2025년 1학기 기말고사 모음\\워드\\확통\\2학기 기말고사",
          "x.hwp",
        ),
      ),
    ).toEqual({ year: 2025, semester: 2, round: "기말" });
  });

  it("폴더가 말하지 않는 항목은 null 이다 — 지어내지 않는다", () => {
    expect(parseFolderPeriod("N:\\개인\\기출\\기출작업\\x.hwp")).toEqual({
      year: null,
      semester: null,
      round: null,
    });
  });
});

describe("resolveCurriculumSubject — 과목은 문항이 붙은 단원에서 나온다", () => {
  it("단원 라벨 최빈값을 쓰고 그 비율을 같이 낸다", () => {
    expect(resolveCurriculumSubject({ 공통수학1: 16, 공통수학2: 2 })).toEqual({
      subject: "공통수학1",
      ratio: 16 / 18,
      level: "고",
    });
  });

  it("중학 라벨이면 학교급이 중이다", () => {
    expect(resolveCurriculumSubject({ 중3: 21 })).toMatchObject({
      subject: "중3",
      level: "중",
    });
  });

  it("단원이 하나도 없으면 null — 과목을 지어내지 않는다", () => {
    expect(resolveCurriculumSubject({})).toBeNull();
  });
});

describe("buildExamKey — 색인 재구축을 견디는 자연키", () => {
  it("같은 시험지는 같은 키, 회차가 다르면 다른 키", () => {
    const base = {
      school: "덕원고",
      level: "고" as const,
      grade: 3,
      subject: "확률과 통계",
      year: 2025,
      semester: 1,
      round: "중간" as const,
    };
    expect(buildExamKey(base)).toBe(buildExamKey({ ...base }));
    expect(buildExamKey(base)).not.toBe(
      buildExamKey({ ...base, round: "기말" }),
    );
  });

  it("⭐ 학년이 키에 들어간다 — 빠지면 같은 학교 중1/중2/중3 이 한 칸에 겹친다", () => {
    const base = {
      school: "동부중",
      level: "중" as const,
      grade: 1,
      subject: "중1",
      year: 2024,
      semester: 1,
      round: "중간" as const,
    };
    const other = { ...base, grade: 2, subject: "중2" };
    expect(buildExamKey(base)).not.toBe(buildExamKey(other));
  });

  it("Exam.externalExamId 의 길이 한도(120자)를 넘지 않는다", () => {
    const key = buildExamKey({
      school: "가".repeat(50),
      level: "고",
      grade: 3,
      subject: "나".repeat(50),
      year: 2025,
      semester: 2,
      round: "기말",
    });
    expect(key.length).toBeLessThanOrEqual(120);
  });
});

describe("decideExamIdentity — 셋을 맞대어 정한다", () => {
  const group = {
    examId: "3222",
    sourceFile: "N:\\기출\\[덕원고][3][확통][25-1-중간][미래엔] (완료).hwp",
    unitGrades: { "확률과 통계": 20 },
  };

  it("문서 제목이 없으면 파일명으로 확정한다", () => {
    const d = decideExamIdentity({ group, header: null });
    expect(d.status).toBe("확정");
    if (d.status !== "확정") return;
    expect(d.exam).toMatchObject({
      school: "덕원고",
      level: "고",
      grade: 3,
      subject: "확률과 통계",
      subjectRaw: "확통",
      year: 2025,
      semester: 1,
      round: "중간",
    });
    expect(d.periodSource).toBe("파일명");
  });

  it("⭐ 문서 제목과 파일명이 다르고 **폴더가 제목 편이면** 제목을 쓴다 (실측 35편)", () => {
    const d = decideExamIdentity({
      group: {
        examId: "3300",
        sourceFile: IN(
          "HWP 2 PDF\\기출\\24 기출\\2학기 중간\\고1",
          "[강북고][1][공수2][25-2-중간대비][비상] (완료).PDF",
        ),
        unitGrades: { 공통수학2: 20 },
      },
      header: parseExamHeader([
        "2024년 2학기 중간고사",
        "강북고 1학년 수학",
        "학원 로고",
        "강북고 25년 2학기 중간고사 대비 (공통수학2)",
      ]),
    });
    expect(d.status).toBe("확정");
    if (d.status !== "확정") return;
    expect(d.exam.year).toBe(2024);
    expect(d.periodSource).toBe("문서제목");
    expect(d.filenameDisagreed).toBe(true);
  });

  it("⭐ 폴더가 **파일명 편이면 파일명을 쓴다** — 문서 제목도 틀린다 (실측 21편)", () => {
    // 실측: [영진고][1][수상][24-1-중간] 의 제목줄이 「2024년 2학기 기말고사」였다.
    const d = decideExamIdentity({
      group: {
        examId: "3400",
        sourceFile: IN(
          "HWP 2 PDF\\기출\\24 기출\\1학기 중간\\수상",
          "[영진고][1][수상][24-1-중간][미래엔] (완료).PDF",
        ),
        unitGrades: { 공통수학1: 20 },
      },
      header: parseExamHeader(["2024년 2학기 기말고사", "영진고 1학년 수학"]),
    });
    expect(d.status).toBe("확정");
    if (d.status !== "확정") return;
    expect(d.exam).toMatchObject({ year: 2024, semester: 1, round: "중간" });
    expect(d.periodSource).toBe("파일명");
    expect(d.headerDisagreed).toBe(true);
  });

  it("⭐ 폴더가 갈라 주지 못하면 미분류 — 둘 중 하나를 고르지 않는다", () => {
    const d = decideExamIdentity({
      group: {
        examId: "3401",
        sourceFile:
          "N:\\개인\\기출\\기출작업\\[월배중][1][23-2-중간] (완료).hwp",
        unitGrades: { 중1: 20 },
      },
      header: parseExamHeader(["2023년 1학기 중간고사", "월배중 1학년 수학"]),
    });
    expect(d.status).toBe("미분류");
  });

  // 변이 시험에서 「폴더 투표에 전 항목을 세게 한다」가 살아남았다. 실제 코퍼스로 재 보니
  // 두 변이가 **2편에서 갈렸고**, 그 2편은 폴더가 «둘이 합의한 학기»를 반박하는 경우였다.
  // 그런 폴더 이름은 그 시험지의 시점이 아니라 **묶음의 이름**이라(실측: 25-2 기말 시험지가
  // `2025년 1학기 기말고사 모음/` 아래 있다) 회차만 골라 믿을 근거가 없다.
  it("⭐ 폴더가 «둘이 합의한 항목»을 반박하면 심판에서 뺀다 → 미분류 (실측 2편)", () => {
    const sourceFile = IN(
      "2025 기출모음\\2025년 1학기 기말고사 모음\\pdf\\중2",
      "[소선여중][2][25-2-기말][미래엔] (완료).PDF",
    );
    // ⚠️ 셋업부터 못 박는다 — 경로가 깨져 폴더가 아무 말도 못 하면 이 테스트는
    //    «엉뚱한 이유로» 초록이 된다(실제로 한 번 그랬다: `\2025` 가 8진 이스케이프였다).
    expect(parseFolderPeriod(sourceFile)).toEqual({
      year: 2025,
      semester: 1,
      round: "기말",
    });

    const d = decideExamIdentity({
      group: { examId: "5500", sourceFile, unitGrades: { 중2: 20 } },
      // 파일명 2025-2-기말 · 제목 2025-2-중간 — 다투는 항목은 회차뿐이고
      // 폴더는 회차를 「기말」이라 하지만 **학기를 1이라 한다**(둘 다 2라고 한다).
      header: parseExamHeader(["2025년 2학기 중간고사", "소선여중 2학년 수학"]),
    });
    expect(d.status).toBe("미분류");
  });

  it("문서 제목이 「대비」면 실제 시험이 아니다 — 제외한다", () => {
    const d = decideExamIdentity({
      group: {
        examId: "3301",
        sourceFile: IN(
          "HWP 2 PDF\\기출\\24 기출\\2학기 중간\\고1",
          "[강동고][1][공수2][25-2-중간대비][비상] (완료).PDF",
        ),
        unitGrades: { 공통수학2: 20 },
      },
      header: parseExamHeader([
        "2025년 2학기 중간고사 대비",
        "강동고 1학년 공통수학 2",
      ]),
    });
    expect(d.status).toBe("제외");
    if (d.status !== "제외") return;
    expect(d.reason).toBe("대비 시험지");
  });

  it("⭐ 제목의 시점이 다수결에서 **졌으면** 그 제목의 「대비」 표기도 못 믿는다 → 미분류", () => {
    // 실측 8편: 파일명엔 대비가 없는데 제목만 「2025년 … 대비」이고, 폴더는 파일명 편이다.
    const d = decideExamIdentity({
      group: {
        examId: "3402",
        sourceFile: IN(
          "HWP 2 PDF\\기출\\24 기출\\2학기 중간\\고1",
          "[효성여고][1][공수2][24-2-중간][천재이] (완료).PDF",
        ),
        unitGrades: { 공통수학2: 20 },
      },
      header: parseExamHeader([
        "2025년 2학기 중간고사 대비",
        "효성여고 1학년 공통수학2",
      ]),
    });
    expect(d.status).toBe("미분류");
    if (d.status !== "미분류") return;
    expect(d.reason).toContain("대비");
  });

  it("⭐ 문서를 못 봤는데 폴더가 파일명과 다르면 미분류 (실측 20편)", () => {
    const d = decideExamIdentity({
      group: {
        examId: "3403",
        sourceFile: IN(
          "2023 기출모음\\2023년 2학기 중간 고사 모음\\##워드\\고1",
          "[수성고][1][수하][23-1-중간][비상] (완료).hwp",
        ),
        unitGrades: { 공통수학2: 20 },
      },
      header: null,
    });
    expect(d.status).toBe("미분류");
  });

  it("⭐ 문서를 못 봤는데 파일명에 「대비」가 있으면 미분류 — 파일명의 대비 표기는 못 믿는다", () => {
    const d = decideExamIdentity({
      group: {
        examId: "3302",
        sourceFile:
          "N:\\기출\\[강북고][1][공수2][25-2-중간대비][비상] (완료).PDF",
        unitGrades: { 공통수학2: 20 },
      },
      header: null,
    });
    expect(d.status).toBe("미분류");
  });

  it("파일명을 못 읽으면 미분류 — 버리지 않고 사유를 남긴다", () => {
    const d = decideExamIdentity({
      group: {
        examId: "1",
        sourceFile: "이상한이름.pdf",
        unitGrades: { 중3: 20 },
      },
      header: null,
    });
    expect(d.status).toBe("미분류");
    if (d.status !== "미분류") return;
    expect(d.reason).toContain("파일명");
  });

  it("sourceFile 이 없으면 미분류", () => {
    const d = decideExamIdentity({
      group: { examId: "1", sourceFile: null, unitGrades: { 중3: 20 } },
      header: null,
    });
    expect(d.status).toBe("미분류");
  });

  it("단원이 없으면 미분류 — 과목을 파일명에서 추측하지 않는다", () => {
    const d = decideExamIdentity({
      group: { ...group, unitGrades: {} },
      header: null,
    });
    expect(d.status).toBe("미분류");
    if (d.status !== "미분류") return;
    expect(d.reason).toContain("단원");
  });

  it("훼손 제목의 연도가 파일명과 맞으면 파일명으로 확정한다", () => {
    const d = decideExamIdentity({
      group: {
        examId: "3165",
        sourceFile: "N:\\기출\\[동부고][2][수1][24-1-중간][신사고] (완료).PDF",
        unitGrades: { 대수: 20 },
      },
      header: parseExamHeader(["2024년 학기 고사", "고 2학년 수학1"]),
    });
    expect(d.status).toBe("확정");
    if (d.status !== "확정") return;
    expect(d.periodSource).toBe("파일명");
    expect(d.exam.year).toBe(2024);
  });

  it("⭐ 훼손 제목의 연도가 파일명과 다르면 미분류 — 머리말로 메우지 않는다", () => {
    const d = decideExamIdentity({
      group: {
        examId: "3166",
        sourceFile: "N:\\기출\\[동부고][2][수1][25-1-중간][신사고] (완료).PDF",
        unitGrades: { 대수: 20 },
      },
      header: parseExamHeader(["2024년 학기 고사", "동부고 2학년 수학1"]),
    });
    expect(d.status).toBe("미분류");
  });

  it("학교급이 학교명 접미사와 단원 라벨에서 어긋나면 미분류", () => {
    const d = decideExamIdentity({
      group: {
        examId: "9",
        sourceFile: "N:\\기출\\[덕원고][3][확통][25-1-중간][미래엔] (완료).hwp",
        unitGrades: { 중3: 20 },
      },
      header: null,
    });
    expect(d.status).toBe("미분류");
  });
});
