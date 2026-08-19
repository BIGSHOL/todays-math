/**
 * 확인테스트 범위 Hi-fi 시안용 픽스처 (D-07 시안 제시용, 실데이터 없음).
 * 실제 중2 소단원 이름·순서를 그대로 옮겼다 — 글자 길이가 지면 판단에 영향을 준다.
 */
import { CURRICULUM_UNITS } from "../../../../prisma/seed-data/units";
import type { UnitNode } from "@/lib/units/groupUnits";

/**
 * **실제 시드 전량(735개)** — 시안이 이걸 안 쓰면 높이 문제가 안 드러난다.
 * 처음 시안은 중2 17개만 넣었고, 그래서 「학년 열이 16행이라 피커 하나가 750px」이라는
 * 것을 원장님이 실제 화면에서 발견하셨다. 시안은 **가장 큰 데이터**로 보여야 한다.
 */
export const ALL_UNITS: UnitNode[] = CURRICULUM_UNITS.map((unit, index) => ({
  id: `seed-${index + 1}`,
  grade: unit.grade,
  chapter: unit.chapter,
  section: unit.section,
  orderIndex: unit.orderIndex,
}));

/** 중2 진도 범위 예시 — 「유리수와 소수 ~ 일차부등식의 풀이」. */
export const ALL_START =
  ALL_UNITS.find((u) => u.section === "유리수와 소수") ?? ALL_UNITS[0]!;
export const ALL_END =
  ALL_UNITS.find((u) => u.section === "일차부등식의 풀이") ?? ALL_UNITS[0]!;

export const HIFI_UNITS: UnitNode[] = [
  {
    id: "u-01",
    grade: "중2",
    chapter: "1. 수와 식",
    section: "유리수와 소수",
    orderIndex: 413,
  },
  {
    id: "u-02",
    grade: "중2",
    chapter: "1. 수와 식",
    section: "순환소수",
    orderIndex: 414,
  },
  {
    id: "u-03",
    grade: "중2",
    chapter: "1. 수와 식",
    section: "순환소수의 분수 표현",
    orderIndex: 415,
  },
  {
    id: "u-04",
    grade: "중2",
    chapter: "1. 수와 식",
    section: "순환소수를 포함한 식의 계산",
    orderIndex: 416,
  },
  {
    id: "u-05",
    grade: "중2",
    chapter: "1. 수와 식",
    section: "지수법칙",
    orderIndex: 417,
  },
  {
    id: "u-06",
    grade: "중2",
    chapter: "1. 수와 식",
    section: "단항식의 곱셈과 나눗셈",
    orderIndex: 418,
  },
  {
    id: "u-07",
    grade: "중2",
    chapter: "1. 수와 식",
    section: "다항식의 덧셈과 뺄셈",
    orderIndex: 419,
  },
  {
    id: "u-08",
    grade: "중2",
    chapter: "1. 수와 식",
    section: "다항식의 곱셈과 나눗셈",
    orderIndex: 420,
  },
  {
    id: "u-09",
    grade: "중2",
    chapter: "2. 부등식",
    section: "부등식",
    orderIndex: 421,
  },
  {
    id: "u-10",
    grade: "중2",
    chapter: "2. 부등식",
    section: "일차부등식의 풀이",
    orderIndex: 422,
  },
  {
    id: "u-11",
    grade: "중2",
    chapter: "2. 부등식",
    section: "일차부등식의 활용",
    orderIndex: 423,
  },
  {
    id: "u-12",
    grade: "중2",
    chapter: "3. 연립방정식",
    section: "연립일차방정식",
    orderIndex: 424,
  },
  {
    id: "u-13",
    grade: "중2",
    chapter: "3. 연립방정식",
    section: "연립방정식의 풀이",
    orderIndex: 425,
  },
  {
    id: "u-14",
    grade: "중2",
    chapter: "3. 연립방정식",
    section: "연립방정식의 활용",
    orderIndex: 426,
  },
  {
    id: "u-15",
    grade: "중1",
    chapter: "1. 수와 연산",
    section: "소인수분해",
    orderIndex: 357,
  },
  {
    id: "u-16",
    grade: "중1",
    chapter: "1. 수와 연산",
    section: "최대공약수와 최소공배수",
    orderIndex: 358,
  },
  {
    id: "u-17",
    grade: "중1",
    chapter: "2. 문자와 식",
    section: "문자의 사용과 식의 계산",
    orderIndex: 359,
  },
];

/** 지금 화면이 자동으로 잡는 범위 — 직전 확인테스트 다음(u-01) ~ 현재 진도(u-10). */
export const HIFI_RANGE_START = HIFI_UNITS[0]!;
export const HIFI_RANGE_END = HIFI_UNITS[9]!;
/** 범위 안 소단원 수. */
export const HIFI_RANGE_COUNT = 10;
/** 그 학년의 전체 소단원 수 — ④안 막대의 분모. */
export const HIFI_GRADE_TOTAL = 56;
