/**
 * 🔴 RED → 🟢 — **확인테스트 기본 범위는 진도가 정한다.**
 *
 * 원장님 확정(2026-08-19): **끝은 항상 현재 진도**, 시작은 **직전 확인테스트의 끝
 * 다음 소단원**. 직전 확인테스트가 없으면 그 반이 나간 진도의 **첫 단원**부터.
 *
 * ## 왜 필요한가
 *
 * 지금 화면은 시작을 `units[0]`(초1 첫 소단원), 끝을 `units[마지막]`(미적분2 마지막)로
 * 채운다. 그래서 원장이 손대지 않고 출제를 누르면 **전 교육과정 735단원**이 범위가
 * 되고, 실측으로 8문항이 초3·중1·중2·공통수학1·미적분2 다섯 학년에서 뽑혔다.
 * **오류도 경고도 없이** 그런 시험지가 나온다 — 눈치챌 신호가 없다.
 *
 * ## 무엇을 잠그나
 *
 * 1. 끝은 언제나 현재 진도다.
 * 2. 시작은 직전 확인테스트 **다음** 소단원 — 범위가 겹치지 않고 이어진다.
 * 3. 직전 확인테스트가 없으면 진도 이력의 첫 단원(그 반이 실제로 나간 데부터).
 * 4. 진도가 안 나갔으면(직전 확인 끝 == 현재 진도) 범위는 그 한 단원이다 —
 *    **거꾸로 된 범위를 만들지 않는다.**
 * 5. `orderIndex` 는 전역 연속값(D-27)이라 학년 경계를 넘는 범위도 그대로 만든다.
 */
import { describe, expect, it } from "vitest";

import { resolveDefaultReviewRange } from "@/lib/generator/defaultReviewRange";

/** 중2 앞부분 + 중3 첫 단원 — orderIndex 는 전역 연속값이다(D-27). */
const UNITS = [
  { id: "m2-1", orderIndex: 413 },
  { id: "m2-2", orderIndex: 414 },
  { id: "m2-3", orderIndex: 415 },
  { id: "m2-4", orderIndex: 416 },
  { id: "m3-1", orderIndex: 470 },
];

describe("[확인테스트] 기본 범위는 진도가 정한다", () => {
  it("직전 확인테스트가 있으면 그 끝 **다음** 단원부터 현재 진도까지", () => {
    expect(
      resolveDefaultReviewRange({
        units: UNITS,
        currentUnitId: "m2-4",
        lastReviewEndUnitId: "m2-2",
        progressUnitIds: ["m2-1", "m2-2", "m2-3", "m2-4"],
      }),
    ).toEqual({
      startUnitId: "m2-3",
      endUnitId: "m2-4",
      startedFrom: "last-review",
    });
  });

  it("직전 확인테스트가 없으면 그 반이 나간 진도의 첫 단원부터", () => {
    expect(
      resolveDefaultReviewRange({
        units: UNITS,
        currentUnitId: "m2-4",
        lastReviewEndUnitId: null,
        progressUnitIds: ["m2-2", "m2-3", "m2-4"],
      }),
    ).toEqual({
      startUnitId: "m2-2",
      endUnitId: "m2-4",
      startedFrom: "progress-start",
    });
  });

  /**
   * 이력 첫 단원이 곧 현재 진도인 경우다. 범위는 한 단원이지만 **사유는 그대로**
   * `progress-start` 다 — 「그 반이 나간 데부터」가 맞고, 한 단원인 것은
   * `unitCount` 가 말한다. `current-only` 는 시작을 **못 정했을 때**만 쓴다.
   */
  it("진도 이력이 현재 단원뿐이면 범위는 그 한 단원이다", () => {
    expect(
      resolveDefaultReviewRange({
        units: UNITS,
        currentUnitId: "m2-3",
        lastReviewEndUnitId: null,
        progressUnitIds: ["m2-3"],
      }),
    ).toEqual({
      startUnitId: "m2-3",
      endUnitId: "m2-3",
      startedFrom: "progress-start",
    });
  });

  /**
   * 🔒 **거꾸로 된 범위를 만들지 않는다.** 직전 확인테스트 뒤로 진도가 안 나갔으면
   * 「다음 단원」이 현재 진도보다 뒤에 있다. 그대로 두면 `resolveRange` 가 시작·끝을
   * 뒤바꿔 **직전에 이미 낸 범위를 통째로 다시** 낸다(그 함수는 큰·작은 값을 정렬한다).
   */
  it("직전 확인테스트 뒤로 진도가 안 나갔으면 현재 진도 한 단원만", () => {
    expect(
      resolveDefaultReviewRange({
        units: UNITS,
        currentUnitId: "m2-3",
        lastReviewEndUnitId: "m2-3",
        progressUnitIds: ["m2-1", "m2-2", "m2-3"],
      }),
    ).toEqual({
      startUnitId: "m2-3",
      endUnitId: "m2-3",
      startedFrom: "current-only",
    });
  });

  it("직전 확인테스트가 현재 진도보다 **앞서 있어도** 거꾸로 만들지 않는다", () => {
    expect(
      resolveDefaultReviewRange({
        units: UNITS,
        currentUnitId: "m2-2",
        lastReviewEndUnitId: "m2-4",
        progressUnitIds: ["m2-1", "m2-2"],
      }),
    ).toEqual({
      startUnitId: "m2-2",
      endUnitId: "m2-2",
      startedFrom: "current-only",
    });
  });

  it("학년 경계를 넘는 범위도 그대로 만든다 (D-27 전역 orderIndex)", () => {
    expect(
      resolveDefaultReviewRange({
        units: UNITS,
        currentUnitId: "m3-1",
        lastReviewEndUnitId: "m2-2",
        progressUnitIds: ["m2-1", "m2-2", "m2-3", "m2-4", "m3-1"],
      }),
    ).toEqual({
      startUnitId: "m2-3",
      endUnitId: "m3-1",
      startedFrom: "last-review",
    });
  });

  /**
   * 알 수 없는 id 는 «없는 것»으로 받는다 — 삭제된 단원을 가리키는 옛 시험지가
   * 있어도 화면이 멈추면 안 된다. 진도 이력도 비면 현재 진도 한 단원이다.
   */
  it("모르는 id·빈 이력은 현재 진도 한 단원으로 받는다", () => {
    expect(
      resolveDefaultReviewRange({
        units: UNITS,
        currentUnitId: "m2-3",
        lastReviewEndUnitId: "지워진-단원",
        progressUnitIds: [],
      }),
    ).toEqual({
      startUnitId: "m2-3",
      endUnitId: "m2-3",
      startedFrom: "current-only",
    });
  });

  it("현재 진도 단원 자체를 모르면 범위를 못 낸다", () => {
    expect(
      resolveDefaultReviewRange({
        units: UNITS,
        currentUnitId: "지워진-단원",
        lastReviewEndUnitId: null,
        progressUnitIds: ["m2-1"],
      }),
    ).toBeNull();
  });
});

/**
 * 🔴 D-63 (원장님 확정 2026-08-21): **첫 회는 현재 대단원을 넘지 않는다.**
 *
 * eywa 연계 실측(92명)에서 「이력 첫 단원부터」가 첫 회에 350단원짜리 범위를
 * 만들었다(이력이 1년치라서). 시작은 **이력 첫 단원과 현재 대단원 첫 단원 중
 * 뒤의 것** — 안 배운 단원도, 대단원 밖도 들어오지 않는 쪽으로 좁힌다.
 * 직전 확인테스트가 생기면 이 제한은 안 탄다(확정 규칙이 이어받는다).
 */
describe("[확인테스트] 첫 회는 현재 대단원을 넘지 않는다 (D-63)", () => {
  const CH_UNITS = [
    { id: "c1-1", orderIndex: 100, grade: "중2", chapter: "2. 부등식" },
    { id: "c1-2", orderIndex: 101, grade: "중2", chapter: "2. 부등식" },
    { id: "c2-1", orderIndex: 102, grade: "중2", chapter: "3. 방정식" },
    { id: "c2-2", orderIndex: 103, grade: "중2", chapter: "3. 방정식" },
    { id: "c2-3", orderIndex: 104, grade: "중2", chapter: "3. 방정식" },
  ];

  it("이력이 앞 대단원까지 걸쳐도 시작은 현재 대단원 첫 단원", () => {
    expect(
      resolveDefaultReviewRange({
        units: CH_UNITS,
        currentUnitId: "c2-3",
        lastReviewEndUnitId: null,
        progressUnitIds: ["c1-1", "c1-2", "c2-1", "c2-2", "c2-3"],
      }),
    ).toEqual({
      startUnitId: "c2-1",
      endUnitId: "c2-3",
      startedFrom: "chapter-start",
    });
  });

  it("대단원 중간부터 나간 이력이면 이력 첫 단원이 이긴다 — 안 배운 단원 금지", () => {
    expect(
      resolveDefaultReviewRange({
        units: CH_UNITS,
        currentUnitId: "c2-3",
        lastReviewEndUnitId: null,
        progressUnitIds: ["c2-2", "c2-3"],
      }),
    ).toEqual({
      startUnitId: "c2-2",
      endUnitId: "c2-3",
      startedFrom: "progress-start",
    });
  });

  it("직전 확인테스트가 있으면 대단원 제한을 안 탄다 — 지난 시험 다음부터 잇는다", () => {
    expect(
      resolveDefaultReviewRange({
        units: CH_UNITS,
        currentUnitId: "c2-3",
        lastReviewEndUnitId: "c1-1",
        progressUnitIds: ["c1-1", "c1-2", "c2-1", "c2-2", "c2-3"],
      }),
    ).toEqual({
      startUnitId: "c1-2",
      endUnitId: "c2-3",
      startedFrom: "last-review",
    });
  });

  it("대단원 정보가 없는 단원 목록이면 기존 동작 그대로(이력 첫 단원)", () => {
    expect(
      resolveDefaultReviewRange({
        units: UNITS,
        currentUnitId: "m2-4",
        lastReviewEndUnitId: null,
        progressUnitIds: ["m2-2", "m2-3", "m2-4"],
      }),
    ).toEqual({
      startUnitId: "m2-2",
      endUnitId: "m2-4",
      startedFrom: "progress-start",
    });
  });
});
