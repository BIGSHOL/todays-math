/**
 * 진도 판정기가 **실제로 무엇을 내놓는가** — 변이 하네스가 「동작이 바뀌었나」를 보는 자리.
 *
 *   npx tsx scripts/qa/probe-eywa-resolve.ts
 *
 * 변이 시험의 순서는 ⑴ 파일이 바뀌었나 ⑵ **산출물이 바뀌었나** ⑶ 그제서야 시험이
 * 빨개지나 다. ⑵ 를 건너뛰면 **멀쩡한 가드를 의심하고 고치러 간다**
 * (CLAUDE.md 2026-08-21).
 *
 * 🔴 표본은 **모든 갈래를 건드린다.** 한 갈래만 넣으면 그 갈래를 안 건드리는
 *    변이가 「산출물이 그대로」로 나와 판정이 거부되는데, 그건 변이가 무해해서가
 *    아니라 표본이 그 자리를 안 봐서다.
 */
import {
  buildUnitIndex,
  resolveProgressLine,
  resolveProgressText,
  type UnitRow,
} from "@/lib/eywa/resolveProgress";

/** 실제 `unit` 행에서 뽑았다 — 지어낸 픽스처는 무엇을 지키는지 알 수 없다. */
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
    id: "u170",
    grade: "중1",
    chapter: "1. 문자와 식",
    section: "일차식의 뜻Ⅰ",
    orderIndex: 170,
  },
  {
    id: "u171",
    grade: "중1",
    chapter: "1. 문자와 식",
    section: "문자의 사용과 식의 값",
    orderIndex: 171,
  },
  {
    id: "u180",
    grade: "중2",
    chapter: "6. 도형의 닮음",
    section: "삼각형의 닮음 조건",
    orderIndex: 180,
  },
  /**
   * 🔴 **이 둘은 일부러 만든 짝이다.** 「정확이 느슨을 이긴다」는 순서는 이런
   *    짝이 없으면 **관찰되지 않는다**(변이를 걸어도 산출물이 그대로다). 지금
   *    실데이터엔 이런 짝이 없지만, 생기는 순간 순서가 답을 가른다.
   */
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

const index = buildUnitIndex(UNITS);

/** 실제 진도 원문에서 뽑았다. 갈래를 하나씩 건드린다. */
const LINES = [
  "수학 회전체", //                                   차시(라벨 벗기기)
  "정다면체", //                                      차시(라벨 없음)
  "1.회전체", //                                      차시(번호 벗기기)
  "1.분모가 같은 (분수)÷(분수) 알아보기", //          차시(초등 세 토막 접두사)
  "수학 입체도형", //                                 대단원
  "1.입체도형 대단원 총괄", //                        총괄
  "방정식(단원) 총괄", //                             총괄(못 찾음 → 미분류)
  "1.분수의 나눗셈 (단원) 총괄", //                    애매(1·2학기)
  "2.일차식의 뜻 1", //                               느슨(로마숫자)
  "1.삼각형의 닮음조건", //                           느슨(띄어쓰기)
  "일차식의 뜻Ⅰ", //                                  정확이 느슨을 이긴다
  "1.문자의 사용과 식의 계산", //                     미분류(닮았지만 다른 차시)
  "수학 월말평가", //                                 시험기간
  "수학 내신대비", //                                 시험기간
  "   ", //                                           빈줄
  "제곱근의 뜻 1", //                                 정확이 이긴다(느슨하면 둘 다 걸려 애매)
];

const 한줄 = LINES.map((line) => {
  const v = resolveProgressLine(index, line);
  return [line.trim(), v.kind, v.units.map((u) => u.id).join(",")];
});

const 여러줄 = [
  { text: "수학 다면체\n정다면체\n회전체", near: null },
  { text: "1.분수의 나눗셈 (단원) 총괄", near: 306 },
  { text: "1.분수의 나눗셈 (단원) 총괄", near: 333 },
  // 🔴 306 과 332 에서 **똑같이 13** 떨어진 자리 — 못 가르므로 애매로 남아야 한다.
  { text: "1.분수의 나눗셈 (단원) 총괄", near: 319 },
  { text: "수학 월말평가", near: null },
  { text: "수학 다면체\n알 수 없는 교재 단원\n회전체", near: null },
].map(({ text, near }) => {
  const v = resolveProgressText(index, text, { nearOrderIndex: near });
  return {
    text: text.replace(/\n/g, " / "),
    near,
    kinds: v.lines.map((l) => l.kind),
    current: v.current?.units.map((u) => u.id) ?? null,
    furthest: v.furthestOrderIndex,
    unresolved: v.unresolved,
    exam: v.examPeriod,
  };
});

console.log(JSON.stringify(한줄));
console.log(JSON.stringify(여러줄));
