/**
 * 회차 응시 명단 규칙 — **서버 가드와 화면이 공유하는 단 하나의 판정**.
 *
 * ## 왜 이 파일이 생겼나
 *
 * "이 학생이 이 회차의 대상인가"를 예전에는 `PredictionRun.predictedScores` Json 안에
 * 그 학생이 있는가로 판정했다. 그런데 학생 능력 엔진(11 §3 L3)이 아직 없어서 그 Json 은
 * `predictionRunService` 가 **항상 빈 배열로** 저장한다. 그 결과 판정이 늘 거짓이 되어
 * 원장이 실점수를 한 건도 넣을 수 없었다(적대적 리뷰 🔴1 — 보정 루프가 통째로 닫혀 있었다).
 *
 * 설계 SSOT 의 순서는 반대다.
 *   - 11 §3 L5-b — "실제 시험이 끝나면 시험지와 학생 점수를 **입력** → 잔차를 저장"
 *   - 11 §4     — "**환산 계수(난이도 지수 → 점수)를 학생 데이터로 구하기 전에는**
 *                  이 질문에 답할 수 없다"
 * 즉 실점수가 예측보다 **먼저** 들어온다. 그러니 명단은 예측 결과가 아니라
 * 학생의 재학 정보(`Student.schoolName/schoolLevel/schoolGrade`)로 정해야 한다.
 *
 * ## 규칙 — 아는 것만 막고, 모르는 것으로는 막지 않는다
 *
 * 위 세 컬럼은 마이그레이션 `20260816090000_add_exam_and_school_fields` 로 생겼지만
 * **아직 어떤 화면도 채우지 않는다**(2026-08-16 전수 확인). 일치를 요구하면 실데이터의
 * 학생이 전원 명단에서 사라진다 — `loadRounds.ts` 가 회차 필터에서 학교 좁히기를 거부하며
 * "조용한 누락"이라고 적어 둔 그 함정이다. 그래서 **채워진 항목만** 대조한다.
 *
 * 정보가 늘수록 명단이 좁아지기만 하는 단조 규칙이라, 나중에 학교 입력 화면이 붙어도
 * 이 파일을 고치지 않는다.
 *
 * ⚠️ 이 판정을 복제하지 말 것. 서버(`actualScoreService`)와 화면(`composeRounds`)이
 *    같은 함수를 부른다. 한쪽만 고치면 화면은 입력칸을 내주는데 서버가 422 로 거절하는
 *    어긋남이 조용히 생긴다.
 */

/** 회차가 겨냥한 시험. `PredictionRun` 의 school/level/grade 를 그대로 받는다. */
export interface RosterSeries {
  school: string;
  level: string;
  grade: number;
}

/**
 * 학생의 재학 정보. 모르는 항목은 null 이다 — 그 상태가 정상이다.
 *
 * `undefined` 도 받는다. Prisma 타입은 `string | null` 이지만 부분 select·테스트 대역·
 * 옛 픽스처는 키 자체를 빼고 넘긴다. 그때 `undefined` 를 "값이 있는데 안 맞는 것"으로
 * 보면 **명단에서 조용히 빠진다** — 이 규칙이 막으려는 바로 그 사고라서 같이 막는다.
 */
export interface RosterStudent {
  schoolName?: string | null;
  schoolLevel?: string | null;
  schoolGrade?: number | null;
}

/** 아직 모르는 값인가. null 과 undefined 를 **같게** 본다. */
function unknown(value: string | number | null | undefined): boolean {
  return value === null || value === undefined;
}

/**
 * 이 학생이 이 회차의 시험을 보는가.
 *
 * 채워진 항목이 하나라도 어긋나면 false. 비어 있는 항목은 판단 근거가 아니므로 통과시킨다.
 * (= 정보가 하나도 없으면 true)
 */
export function takesExam(
  series: RosterSeries,
  student: RosterStudent,
): boolean {
  if (!unknown(student.schoolName) && student.schoolName !== series.school) {
    return false;
  }
  if (!unknown(student.schoolLevel) && student.schoolLevel !== series.level) {
    return false;
  }
  if (!unknown(student.schoolGrade) && student.schoolGrade !== series.grade) {
    return false;
  }
  return true;
}
