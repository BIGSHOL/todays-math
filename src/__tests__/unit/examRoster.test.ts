/**
 * 🔴 RED → 🟢 GREEN — 회차 응시 명단 규칙 (`src/lib/predictor/examRoster.ts`).
 *
 * ## 왜 이 규칙이 따로 있어야 하는가
 *
 * 예전에는 "이 학생이 이 회차의 대상인가"를 `PredictionRun.predictedScores` Json 에 그 학생이
 * 들어 있는가로 판정했다. 그런데 엔진(L3 학생 능력 추정)이 아직 없어 그 Json 은 **항상 빈
 * 배열**이다. 그래서 판정이 늘 거짓이 되고, 원장이 실점수를 넣을 수 없었다(적대적 리뷰 🔴1).
 *
 * 설계 SSOT 는 반대 방향이다 — 11 §3 L5-b "실제 시험이 끝나면 시험지와 학생 점수를 **입력**
 * → 잔차를 저장", §4 "환산 계수를 학생 데이터로 구하기 **전에는** 답할 수 없다".
 * 즉 실점수가 예측보다 먼저 들어온다. 명단은 예측이 아니라 **학생의 재학 정보**로 정해야 한다.
 *
 * ## 규칙 — "아는 것만 막고, 모르는 것으로는 막지 않는다"
 *
 * `Student.schoolName/schoolLevel/schoolGrade` 는 아직 어떤 화면도 채우지 않아 실데이터가
 * 전부 NULL 이다(2026-08-16 확인). 일치를 요구하면 **전원이 조용히 사라진다** —
 * `loadRounds.ts` 가 회차 필터에서 똑같은 이유로 학교 좁히기를 거부했던 그 함정이다.
 * 그래서 **채워진 항목만** 대조하고, 비어 있는 항목은 통과시킨다.
 * 정보가 늘수록 명단이 좁아지는 단조 규칙이라 나중에 학교 입력이 붙어도 규칙을 안 바꿔도 된다.
 *
 * 🔴 이 규칙은 **서버 가드와 화면이 같은 것을 써야 한다.** 한쪽만 고치면 화면은 입력칸을
 *    내주는데 서버가 422 로 거절하는(또는 그 반대) 어긋남이 조용히 생긴다.
 */
import { describe, expect, it } from "vitest";

import { takesExam, type RosterSeries, type RosterStudent } from "@/lib/predictor/examRoster";

const RUN: RosterSeries = { school: "정화중", level: "중", grade: 3 };

function student(over: Partial<RosterStudent> = {}): RosterStudent {
  return {
    schoolName: null,
    schoolLevel: null,
    schoolGrade: null,
    ...over,
  };
}

describe("[명단] 아는 것만 막는다", () => {
  it("학교 정보가 하나도 없으면 대상으로 본다 — 모르는 것으로 막지 않는다", () => {
    expect(takesExam(RUN, student())).toBe(true);
  });

  /**
   * Prisma 타입은 `string | null` 이지만 부분 select·테스트 대역은 키를 통째로 뺀다.
   * `undefined` 를 "값이 있는데 안 맞는 것"으로 보면 명단에서 조용히 빠진다.
   */
  it("항목이 아예 없어도(undefined) 모르는 것으로 본다", () => {
    expect(takesExam(RUN, {} as RosterStudent)).toBe(true);
    expect(takesExam(RUN, { schoolName: undefined })).toBe(true);
  });

  it("세 항목이 모두 일치하면 대상이다", () => {
    expect(
      takesExam(
        RUN,
        student({ schoolName: "정화중", schoolLevel: "중", schoolGrade: 3 }),
      ),
    ).toBe(true);
  });

  it("학교가 다르면 대상이 아니다", () => {
    expect(takesExam(RUN, student({ schoolName: "가람중" }))).toBe(false);
  });

  it("학년이 다르면 대상이 아니다", () => {
    expect(takesExam(RUN, student({ schoolGrade: 1 }))).toBe(false);
  });

  it("학교급이 다르면 대상이 아니다", () => {
    expect(takesExam(RUN, student({ schoolLevel: "고" }))).toBe(false);
  });

  it("일부만 채워져 있으면 채워진 것만 본다", () => {
    // 학교만 안다 → 학년을 모른다고 막지 않는다.
    expect(takesExam(RUN, student({ schoolName: "정화중" }))).toBe(true);
    // 학교는 맞는데 학년이 다르다 → 막는다.
    expect(
      takesExam(RUN, student({ schoolName: "정화중", schoolGrade: 2 })),
    ).toBe(false);
  });

  /**
   * 정보가 늘어날수록 명단은 **좁아지기만** 해야 한다. 넓어지는 조합이 있으면
   * "학교를 입력했더니 없던 학생이 생겼다"는 일이 벌어진다.
   */
  it("항목을 채울수록 대상이 넓어지는 일은 없다", () => {
    const partial = student({ schoolName: "정화중" });
    const full = student({
      schoolName: "정화중",
      schoolLevel: "고",
      schoolGrade: 3,
    });
    expect(takesExam(RUN, partial)).toBe(true);
    expect(takesExam(RUN, full)).toBe(false);
  });
});
