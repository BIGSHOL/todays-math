/**
 * 🔴 RED → 🟢 — GET /api/tests/default-range (확인테스트 기본 범위).
 *
 * 구현: src/app/api/tests/default-range/route.ts
 * 판정: src/lib/generator/defaultReviewRange.ts (순수 함수 — 규칙 자체는 그쪽 테스트가 잠근다)
 * 대응 계약: src/contracts/test.contract.ts
 *
 * 여기서 보는 것은 **배선**이다: 어느 진도를 보는가(반/개별), 직전 확인테스트를
 * 어디서 찾는가, 「소단원 N개」를 출제와 같은 함수로 세는가, 남의 반을 막는가.
 */
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({
  getSessionUser: vi.fn(async () => ({
    id: "10000000-0000-4000-8000-000000000001",
    email: "teacher@todaysmath.test",
    name: "테스트 강사",
  })),
}));

import { GET as defaultRange } from "@/app/api/tests/default-range/route";
import { POST as generateTest } from "@/app/api/tests/generate/route";
import { errorResponseSchema } from "@/contracts/common.contract";
import { defaultReviewRangeResponseSchema } from "@/contracts/test.contract";
import {
  CLASS_A_ID,
  CLASS_B_ID,
  CLASS_OTHER_ID,
  MOCK_CURRENT_PROGRESS_UNIT,
  MOCK_REVIEW_RANGE_END_UNIT,
  MOCK_UNITS,
  STUDENT_IDS,
} from "@/mocks/data";

function get(query: string) {
  return defaultRange(
    new NextRequest(`http://localhost/api/tests/default-range?${query}`),
  );
}

describe("[S-04] GET /api/tests/default-range — 확인테스트 기본 범위", () => {
  /**
   * 반 A 는 확인테스트를 낸 적이 없고 진도가 413 → 416 으로 나갔다.
   * 그러니 **진도 이력 첫 단원(413)부터 현재 진도(416)까지**, 소단원 4개다.
   */
  it("확인테스트를 안 낸 반은 진도 이력 첫 단원부터 현재 진도까지", async () => {
    const res = await get(`classId=${CLASS_A_ID}`);
    expect(res.status).toBe(200);

    const body = defaultReviewRangeResponseSchema.parse(await res.json());
    expect(body.data).toEqual({
      rangeStartUnitId: MOCK_UNITS[0]!.id,
      rangeEndUnitId: MOCK_CURRENT_PROGRESS_UNIT.id,
      unitCount: 4,
      startedFrom: "progress-start",
    });
  });

  /**
   * 🔒 반 B 는 확인테스트를 **이미 냈고**(끝 = orderIndex 420) 그 뒤로 진도가 안 나갔다
   * (현재 진도 414). 「다음 단원(421)」이 현재 진도보다 뒤라 **거꾸로 된 범위**가 된다 —
   * 그대로 두면 직전에 낸 범위를 통째로 다시 낸다. 현재 진도 한 단원으로 접는다.
   */
  it("직전 확인테스트 뒤로 진도가 안 나갔으면 현재 진도 한 단원만", async () => {
    const res = await get(`classId=${CLASS_B_ID}`);
    const body = defaultReviewRangeResponseSchema.parse(await res.json());

    expect(MOCK_REVIEW_RANGE_END_UNIT.orderIndex).toBeGreaterThan(
      MOCK_UNITS[1]!.orderIndex,
    );
    expect(body.data).toEqual({
      rangeStartUnitId: MOCK_UNITS[1]!.id,
      rangeEndUnitId: MOCK_UNITS[1]!.id,
      unitCount: 1,
      startedFrom: "current-only",
    });
  });

  /**
   * 개별 진도를 쓰는 학생(STUDENT_IDS[2])은 반보다 앞서 418 까지 나갔다.
   * 끝이 **그 학생의** 진도여야 한다 — 반 진도(416)를 보면 안 된다.
   */
  it("개별 진도 학생은 그 학생의 진도가 끝이다", async () => {
    const res = await get(`classId=${CLASS_A_ID}&studentId=${STUDENT_IDS[2]!}`);
    const body = defaultReviewRangeResponseSchema.parse(await res.json());

    expect(body.data?.rangeEndUnitId).toBe(MOCK_UNITS[5]!.id);
    expect(body.data?.rangeStartUnitId).toBe(MOCK_UNITS[5]!.id);
    // 개별 이력이 그 한 건뿐이라 시작도 그 단원이다(범위 1개).
    expect(body.data?.unitCount).toBe(1);
  });

  /**
   * 🔴 적대적 리뷰에서 나온 결함 — **초안(draft)이 기본 범위를 밀어냈다.**
   *
   * 출제를 누르면 그 순간 draft TEST 가 만들어진다. 검수만 하고 버려도 「직전
   * 확인테스트」로 세어져, 다음 기본 범위가 그 끝 **다음**부터가 된다. 끝은 곧 현재
   * 진도이므로 시작이 진도보다 뒤가 되고 — 범위가 **현재 진도 한 단원으로 접힌다.**
   * 실측: 4단원(유리수와 소수~순환소수를 포함한 식의 계산) → **1단원**.
   *
   * 그러면 D-54(단원을 고루)가 통째로 무력해진다. 「진도 기준 자동」이라는 라벨을 달고
   * 8문항이 한 단원에서만 나간다 — 원장이 눈치챌 신호가 없다.
   *
   * 고침: **확정(confirmed)·인쇄(printed)한 시험만** 직전 확인테스트로 센다.
   */
  it("확정하지 않은 초안 확인테스트는 기본 범위를 밀어내지 않는다", async () => {
    const before = defaultReviewRangeResponseSchema.parse(
      await (await get(`classId=${CLASS_A_ID}`)).json(),
    );

    const generated = await generateTest(
      new NextRequest("http://localhost/api/tests/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          classId: CLASS_A_ID,
          testType: "review",
          testDate: "2026-08-13",
          problemCount: 4,
          difficultyRatio: { easy: 2, mid: 2, hard: 0 },
          rangeStartUnitId: MOCK_UNITS[0]!.id,
          rangeEndUnitId: MOCK_UNITS[3]!.id,
        }),
      }),
    );
    expect(generated.status).toBe(201);

    const after = defaultReviewRangeResponseSchema.parse(
      await (await get(`classId=${CLASS_A_ID}`)).json(),
    );
    expect(after.data).toEqual(before.data);
  });

  it("남의 반이면 403 — 범위를 알려 주지 않는다", async () => {
    const res = await get(`classId=${CLASS_OTHER_ID}`);
    expect(res.status).toBe(403);
    errorResponseSchema.parse(await res.json());
  });

  it("classId 가 없으면 VALIDATION_ERROR(400)", async () => {
    const res = await get("");
    expect(res.status).toBe(400);
    errorResponseSchema.parse(await res.json());
  });
});
