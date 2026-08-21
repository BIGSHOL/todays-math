/**
 * eywa 진도 원문 → 우리 단원 (연계 1단계).
 *
 * eywa 는 진도를 **차시 문자열**로 적는다(`lesson_reports.progress = "수학 <차시>"`).
 * 우리 `Unit` 트리는 eywa 와 **같은 `curriculum.ts`** 에서 생성했으므로(T0.3,
 * 2026-08-15 완전 일치 확인) 그 문자열이 그대로 열쇠다.
 *
 * ## 🔴 이 판정기가 지켜야 하는 것
 *
 * 1. **미분류를 반드시 출력한다.** 손으로 적은 어휘 목록은 샌다 — 못 푼 것을
 *    조용히 버리면 「진도가 멈춘 학생」이 아무에게도 안 보인다.
 * 2. **못 가르면 «애매»로 둔다.** 초6 「분수의 나눗셈」은 1학기·2학기에 **두 번**
 *    나온다(실측 5건: 초2 길이 재기 · 초3 나눗셈/곱셈 · 초6 분수/소수의 나눗셈).
 *    틀린 단원으로 출제하는 것은 조용한 오답이라 안 내는 것보다 나쁘다.
 * 3. **정본은 우리 `Unit` 테이블이다.** eywa `curriculum.ts` 를 런타임에 읽지 않는다.
 *
 * 픽스처는 **실제 DB 행**이다(지어낸 문자열은 무엇을 지키는지 알 수 없다 —
 * CLAUDE.md 2026-08-19).
 */
import { describe, expect, it } from "vitest";

import {
  buildUnitIndex,
  resolveProgressLine,
  resolveProgressText,
} from "@/lib/eywa/resolveProgress";
import type { UnitRow } from "@/lib/eywa/resolveProgress";

/** 실제 `unit` 행에서 뽑았다. 초6 분수의 나눗셈이 **두 번** 나오는 것이 핵심이다. */
const UNITS: UnitRow[] = [
  {
    id: "u305",
    grade: "초6",
    chapter: "1-1 분수의 나눗셈",
    section: "1-1-1 (자연수)÷(자연수)의 몫을 분수로 나타내기",
    orderIndex: 305,
  },
  {
    id: "u306",
    grade: "초6",
    chapter: "1-1 분수의 나눗셈",
    section: "1-1-2 (분수)÷(자연수) 알아보기",
    orderIndex: 306,
  },
  {
    id: "u307",
    grade: "초6",
    chapter: "1-1 분수의 나눗셈",
    section: "1-1-3 (대분수)÷(자연수) 알아보기",
    orderIndex: 307,
  },
  {
    id: "u332",
    grade: "초6",
    chapter: "2-1 분수의 나눗셈",
    section: "2-1-1 분모가 같은 (분수)÷(분수) 알아보기",
    orderIndex: 332,
  },
  {
    id: "u333",
    grade: "초6",
    chapter: "2-1 분수의 나눗셈",
    section: "2-1-2 분모가 다른 (분수)÷(분수) 알아보기",
    orderIndex: 333,
  },
  {
    id: "u160",
    grade: "중1",
    chapter: "7. 입체도형",
    section: "다면체",
    orderIndex: 160,
  },
  {
    id: "u161",
    grade: "중1",
    chapter: "7. 입체도형",
    section: "정다면체",
    orderIndex: 161,
  },
  {
    id: "u162",
    grade: "중1",
    chapter: "7. 입체도형",
    section: "회전체",
    orderIndex: 162,
  },
  {
    id: "u190",
    grade: "중2",
    chapter: "3. 방정식",
    section: "연립방정식의 풀이의 응용",
    orderIndex: 190,
  },
  {
    id: "u191",
    grade: "중2",
    chapter: "3. 방정식",
    section: "해가 특수한 연립방정식",
    orderIndex: 191,
  },
];

const index = buildUnitIndex(UNITS);
const 판정 = (line: string) => resolveProgressLine(index, line);

describe("[픽스처] 이 단원들이 **실제로** 경계를 가른다", () => {
  /**
   * 🔴 이 시험이 없으면 아래 전부가 장식이 될 수 있다. 초6 「분수의 나눗셈」이
   *    한 번만 있는 픽스처를 쓰면 «애매» 갈래가 구조적으로 안 나온다.
   */
  it("초6 「분수의 나눗셈」은 픽스처 안에서 두 대단원에 걸쳐 있다", () => {
    const 같은이름 = new Set(
      UNITS.filter(
        (u) => u.grade === "초6" && u.chapter.includes("분수의 나눗셈"),
      ).map((u) => u.chapter),
    );
    expect(같은이름.size).toBe(2);
  });

  it("초등 차시는 세 토막 접두사, 중등 차시는 접두사가 없다", () => {
    expect(UNITS.find((u) => u.id === "u332")!.section).toMatch(
      /^\d+-\d+-\d+ /,
    );
    expect(UNITS.find((u) => u.id === "u160")!.section).not.toMatch(/^\d/);
  });
});

describe("[resolveProgressLine] 한 줄 판정", () => {
  it("중등 차시는 그대로 맞는다 — 「수학 」 라벨을 벗긴다", () => {
    const v = 판정("수학 회전체");
    expect(v.kind).toBe("차시");
    expect(v.units.map((u) => u.id)).toEqual(["u162"]);
  });

  it("라벨 없이 와도 맞는다", () => {
    expect(판정("정다면체").units.map((u) => u.id)).toEqual(["u161"]);
  });

  it("초등 차시는 **세 토막 접두사**가 붙어 있어도 벗겨서 맞춘다", () => {
    // 실측: 진도엔 「1.분모가 같은 (분수)÷(분수) 알아보기」로 적히는데
    //       우리 section 은 「2-1-1 분모가 같은 …」이다. 양쪽 다 벗겨야 만난다.
    expect(
      판정("1.분모가 같은 (분수)÷(분수) 알아보기").units.map((u) => u.id),
    ).toEqual(["u332"]);
    expect(
      판정("2-1-1 분모가 같은 (분수)÷(분수) 알아보기").units.map((u) => u.id),
    ).toEqual(["u332"]);
  });

  it("앞에 붙은 「N.」 번호는 벗긴다 (edutrix 이관 포맷)", () => {
    expect(판정("1.회전체").units.map((u) => u.id)).toEqual(["u162"]);
  });

  it("대단원 이름이면 그 대단원의 차시를 전부 준다", () => {
    const v = 판정("수학 입체도형");
    expect(v.kind).toBe("대단원");
    expect(v.units.map((u) => u.id)).toEqual(["u160", "u161", "u162"]);
  });

  it("「대단원 총괄」은 그 대단원을 가리킨다 — **확인테스트를 낼 때다**", () => {
    const v = 판정("1.입체도형 대단원 총괄");
    expect(v.kind).toBe("총괄");
    expect(v.units.map((u) => u.id)).toEqual(["u160", "u161", "u162"]);
  });

  it("「(단원) 총괄」 표기도 같다", () => {
    expect(판정("방정식(단원) 총괄").kind).toBe("총괄");
  });

  /** 🔴 이름이 겹치면 **자동으로 고르지 않는다.** 틀린 단원 출제는 조용한 오답이다. */
  it("한 학년에 같은 이름의 대단원이 둘이면 «애매»다", () => {
    const v = 판정("1.분수의 나눗셈 (단원) 총괄");
    expect(v.kind).toBe("애매");
    expect(new Set(v.units.map((u) => u.chapter))).toEqual(
      new Set(["1-1 분수의 나눗셈", "2-1 분수의 나눗셈"]),
    );
  });

  it("직전 위치를 알려 주면 «애매»가 풀린다 — 가까운 쪽", () => {
    // 본문 밖 근거(그 학생이 지금 어디까지 왔나)로만 가른다.
    const v = 판정("1.분수의 나눗셈 (단원) 총괄");
    expect(v.kind).toBe("애매");
    const 풀린 = resolveProgressLine(index, "1.분수의 나눗셈 (단원) 총괄", {
      nearOrderIndex: 330,
    });
    expect(풀린.kind).toBe("총괄");
    expect(new Set(풀린.units.map((u) => u.chapter))).toEqual(
      new Set(["2-1 분수의 나눗셈"]),
    );
  });

  it("시험 기간은 진도가 아니다 — 따로 표시한다", () => {
    for (const s of [
      "수학 월말평가",
      "수학 내신대비",
      "수학 시험대비",
      "수학 모의고사",
    ])
      expect(판정(s).kind).toBe("시험기간");
  });

  /** 🔴 목록에 없는 것을 **조용히 버리지 않는다.** */
  it("교육과정에 없는 교재 어휘는 «미분류»로 남긴다", () => {
    const v = 판정("1.문자의 사용과 식의 계산");
    expect(v.kind).toBe("미분류");
    expect(v.units).toEqual([]);
    expect(v.raw).toBe("1.문자의 사용과 식의 계산");
  });

  it("빈 줄은 판정하지 않는다", () => {
    expect(판정("   ").kind).toBe("빈줄");
  });
});

describe("[resolveProgressText] 하루치 원문 — 여러 줄", () => {
  /** 실측: 하루에 차시 세 개를 적는 것이 보통이다. */
  it("여러 줄을 다 판정하고 **마지막 진도**를 현재 위치로 준다", () => {
    const v = resolveProgressText(index, "수학 다면체\n정다면체\n회전체");
    expect(v.lines.map((l) => l.kind)).toEqual(["차시", "차시", "차시"]);
    expect(v.current?.units.map((u) => u.id)).toEqual(["u162"]);
    expect(v.furthestOrderIndex).toBe(162);
  });

  it("한 줄이 미분류여도 나머지는 살린다", () => {
    const v = resolveProgressText(
      index,
      "수학 다면체\n알 수 없는 교재 단원\n회전체",
    );
    expect(v.lines.map((l) => l.kind)).toEqual(["차시", "미분류", "차시"]);
    expect(v.current?.units.map((u) => u.id)).toEqual(["u162"]);
    expect(v.unresolved).toEqual(["알 수 없는 교재 단원"]);
  });

  /** 🔴 시험 기간은 «진도 없음»이지 «진도 뒤로»가 아니다. */
  it("시험기간만 적힌 날은 현재 위치가 없다 — 그날은 진도를 안 옮긴다", () => {
    const v = resolveProgressText(index, "수학 월말평가");
    expect(v.current).toBeNull();
    expect(v.examPeriod).toBe(true);
    expect(v.furthestOrderIndex).toBeNull();
  });

  it("앞선 위치를 알려 주면 그 줄들의 «애매»가 풀린다", () => {
    const v = resolveProgressText(index, "1.분수의 나눗셈 (단원) 총괄", {
      nearOrderIndex: 306,
    });
    expect(v.current?.kind).toBe("총괄");
    expect(new Set(v.current!.units.map((u) => u.chapter))).toEqual(
      new Set(["1-1 분수의 나눗셈"]),
    );
  });

  it("빈 진도는 아무것도 아니다", () => {
    for (const s of ["", null, undefined]) {
      const v = resolveProgressText(index, s);
      expect(v.current).toBeNull();
      expect(v.lines).toEqual([]);
    }
  });
});

describe("[느슨한 일치] 띄어쓰기·로마숫자만 다른 것", () => {
  /**
   * eywa 차시는 「일차식의 뜻Ⅰ」인데 진도엔 「일차식의 뜻 1」로 적힌다.
   * 학년 라벨(`미적분Ⅰ` ↔ `미적분1`)에서 이미 겪은 그 표기 차이다.
   *
   * 🔴 여기까지만 한다 — 「문자의 사용과 식의 **계산**」은 우리 「문자의 사용과
   *    식의 **값**」과 80% 닮았지만 **다른 차시**다. 닮음으로 이으면 틀린 단원으로
   *    조용히 출제된다. 그 부류는 미분류로 남겨 화면에 찍는다.
   */
  const LOOSE: UnitRow[] = [
    {
      id: "L1",
      grade: "중1",
      chapter: "1. 문자와 식",
      section: "일차식의 뜻Ⅰ",
      orderIndex: 10,
    },
    {
      id: "L2",
      grade: "중1",
      chapter: "1. 문자와 식",
      section: "일차식의 뜻Ⅱ",
      orderIndex: 11,
    },
    {
      id: "L3",
      grade: "중1",
      chapter: "1. 문자와 식",
      section: "문자의 사용과 식의 값",
      orderIndex: 12,
    },
    {
      id: "L4",
      grade: "중2",
      chapter: "6. 도형의 닮음",
      section: "삼각형의 닮음 조건",
      orderIndex: 20,
    },
    {
      id: "L5",
      grade: "초5",
      chapter: "1-1 자연수의 혼합 계산",
      section: "1-1-1 덧셈과 뺄셈이 섞여 있는 식",
      orderIndex: 30,
    },
  ];
  const loose = buildUnitIndex(LOOSE);

  it("로마숫자 ↔ 아라비아 숫자", () => {
    expect(
      resolveProgressLine(loose, "2.일차식의 뜻 1").units.map((u) => u.id),
    ).toEqual(["L1"]);
    expect(
      resolveProgressLine(loose, "3.일차식의 뜻 2").units.map((u) => u.id),
    ).toEqual(["L2"]);
  });

  it("띄어쓰기만 다른 것", () => {
    expect(
      resolveProgressLine(loose, "1.삼각형의 닮음조건").units.map((u) => u.id),
    ).toEqual(["L4"]);
    expect(
      resolveProgressLine(loose, "자연수의 혼합계산(단원) 총괄").kind,
    ).toBe("총괄");
  });

  /** 🔴 닮았다고 잇지 않는다. */
  it("낱말이 다르면 «미분류»로 남는다 — 「식의 계산」 ≠ 「식의 값」", () => {
    const v = resolveProgressLine(loose, "1.문자의 사용과 식의 계산");
    expect(v.kind).toBe("미분류");
    expect(v.units).toEqual([]);
  });

  /** 🔴 정확 일치가 **언제나** 느슨한 일치를 이긴다. */
  it("정확히 있는 이름은 느슨한 쪽으로 새지 않는다", () => {
    expect(
      resolveProgressLine(loose, "일차식의 뜻Ⅰ").units.map((u) => u.id),
    ).toEqual(["L1"]);
  });
});

describe("[순서·동점] 변이가 아니면 안 보이는 자리", () => {
  /**
   * 🔴 이 두 시험은 **변이 하네스가 「판정불가」를 내서** 추가된 것이다.
   *    가드를 망가뜨렸는데 산출물이 그대로였다 — 가드가 없어서가 아니라
   *    **표본이 그 자리를 안 봤기 때문**이다(CLAUDE.md 2026-08-21).
   */
  it("정확 일치가 느슨한 일치를 이긴다 — 느슨하면 둘 다 걸려 «애매»가 된다", () => {
    // 이 짝은 일부러 만든 것이다. 실데이터엔 아직 없지만, 생기는 순간
    // 순서가 답을 가른다. 이런 짝이 없으면 순서는 관찰되지 않는다.
    const PAIR: UnitRow[] = [
      {
        id: "x400",
        grade: "중3",
        chapter: "1. 제곱근",
        section: "제곱근의 뜻 1",
        orderIndex: 400,
      },
      {
        id: "x401",
        grade: "중3",
        chapter: "1. 제곱근",
        section: "제곱근의 뜻Ⅰ",
        orderIndex: 401,
      },
    ];
    const v = resolveProgressLine(buildUnitIndex(PAIR), "제곱근의 뜻 1");
    expect(v.kind).toBe("차시");
    expect(v.units.map((u) => u.id)).toEqual(["x400"]);
  });

  /**
   * 🔴 **못 가른 것을 가른 척하지 않는다.**
   *
   * 동점을 만들려면 픽스처를 따로 둬야 한다 — 위 `UNITS` 의 두 무리는 305~307 과
   * 332~333 이라 **어떤 정수에서도 동점이 안 된다**(가장 가까운 것끼리 307·332는
   * 25 떨어져 홀수다). 처음엔 그걸 안 세고 319 를 썼다가 12 대 13 으로 갈렸다.
   */
  it("직전 위치가 두 후보에서 **똑같이** 떨어져 있으면 «애매»로 남는다", () => {
    const TIE: UnitRow[] = [
      {
        id: "t100",
        grade: "초6",
        chapter: "1-1 분수의 나눗셈",
        section: "1-1-1 가",
        orderIndex: 100,
      },
      {
        id: "t200",
        grade: "초6",
        chapter: "2-1 분수의 나눗셈",
        section: "2-1-1 나",
        orderIndex: 200,
      },
    ];
    const tie = buildUnitIndex(TIE);
    // 150 은 100 과 200 에서 **똑같이 50** 떨어져 있다.
    const 동점 = resolveProgressLine(tie, "1.분수의 나눗셈 (단원) 총괄", {
      nearOrderIndex: 150,
    });
    expect(동점.kind).toBe("애매");
    expect(new Set(동점.units.map((u) => u.chapter))).toEqual(
      new Set(["1-1 분수의 나눗셈", "2-1 분수의 나눗셈"]),
    );
    // 한 칸만 옮겨도 갈린다 — 「동점일 때만」이 실제로 경계다.
    const 갈림 = resolveProgressLine(tie, "1.분수의 나눗셈 (단원) 총괄", {
      nearOrderIndex: 151,
    });
    expect(갈림.kind).toBe("총괄");
    expect(갈림.units.map((u) => u.id)).toEqual(["t200"]);
  });
});
