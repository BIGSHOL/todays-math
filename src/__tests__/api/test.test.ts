/**
 * 🟢 GREEN — 대응 구현 태스크: Phase 4, T4.2 (자동 출제 API RED→GREEN)
 *
 * 구현: src/app/api/tests/**
 * (RED 단계의 `@ts-expect-error` 임시 주석은 구현 완료로 제거됨 — 이유는
 * src/__tests__/api/auth.test.ts 상단 주석 참조.)
 *
 * ⚠️ 이 API는 T4.1(출제 엔진 순수 함수, src/__tests__/unit/generator.test.ts)을 직접 import해
 *    쓰고, 진도(T2.2)/문제(T3.1) 조회는 테스트 DB 픽스처로 독립 실행한다(06-tasks.md 참조).
 *
 * 대응 계약: src/contracts/test.contract.ts
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

import { POST as generateTest } from "@/app/api/tests/generate/route";
import { GET as listTests } from "@/app/api/tests/route";
import { GET as getTest } from "@/app/api/tests/[id]/route";
import { PUT as replaceTestProblem } from "@/app/api/tests/[id]/problems/[seq]/route";
import { POST as confirmTest } from "@/app/api/tests/[id]/confirm/route";

import { errorResponseSchema } from "@/contracts/common.contract";
import {
  insufficientProblemsErrorResponseSchema,
  testConfirmResponseSchema,
  testDetailResponseSchema,
  testGenerateResponseSchema,
  testListResponseSchema,
  testProblemReplaceResponseSchema,
} from "@/contracts/test.contract";
import {
  CLASS_A_ID,
  CLASS_OTHER_ID,
  CLASS_STARVED_ID,
  TEST_CONFIRMED_ID,
  TEST_DRAFT_ID,
  TEST_NOT_FOUND_ID,
  TEST_PRINTED_ID,
  MOCK_UNITS,
} from "@/mocks/data";
import { db } from "@/lib/db";

function jsonRequest(url: string, method: string, body?: unknown) {
  return new NextRequest(url, {
    method,
    headers:
      body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function withId(id: string) {
  return { params: Promise.resolve({ id }) };
}

function withIdAndSeq(id: string, seq: number) {
  return { params: Promise.resolve({ id, seq: String(seq) }) };
}

describe("[T4.2] POST /api/tests/generate — draft TEST + TEST_PROBLEM 생성", () => {
  it("정상 요청이면 draft 테스트와 문항을 생성한다(201, shortfall=[])", async () => {
    const res = await generateTest(
      jsonRequest("http://localhost/api/tests/generate", "POST", {
        classId: CLASS_A_ID,
        testType: "daily",
        testDate: "2026-08-13",
      }),
    );
    expect(res.status).toBe(201);
    const body = testGenerateResponseSchema.parse(await res.json());
    expect(body.data.test.status).toBe("draft");
    expect(body.data.shortfall).toEqual([]);
  });

  it("확인테스트(review)인데 범위 단원이 없으면 VALIDATION_ERROR(400)를 반환한다", async () => {
    const res = await generateTest(
      jsonRequest("http://localhost/api/tests/generate", "POST", {
        classId: CLASS_A_ID,
        testType: "review",
        testDate: "2026-08-13",
      }),
    );
    expect(res.status).toBe(400);
    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  /**
   * 🔒 확인테스트가 부족할 때 화면이 「AI 생성」으로 보내는 단원은 **범위에서 가장
   * 얇은 곳**이어야 한다. 예전에는 `rangeEndUnitId`(그냥 범위의 끝)를 가리켰다 —
   * 그 단원이 이미 수백 건을 갖고 있어도 그리로 보냈고, 한 번 눌러도 안 채워졌다.
   *
   * 픽스처 실측(416~420, **최근 출제 제외 뒤**): 416 은 10건, 417·419·420 은 2건,
   * **418 은 1건**이다. 그래서 「가장 얇은 곳」과 「범위의 끝(420)」이 갈린다.
   *
   * ⚠️ 세는 기준이 **화면이 보는 「가용」과 같아야** 한다 — D-20(최근 14일) 제외를
   *    빼고 세면 418 이 2건이라 아무것도 안 갈린다. 실제로 이 픽스처를 처음엔
   *    제외 없이 계산했다가 틀렸다.
   */
  it("확인테스트가 부족하면 범위에서 가장 얇은 단원을 가리킨다", async () => {
    const res = await generateTest(
      jsonRequest("http://localhost/api/tests/generate", "POST", {
        classId: CLASS_A_ID,
        testType: "review",
        testDate: "2026-08-13",
        problemCount: 30,
        difficultyRatio: { easy: 10, mid: 15, hard: 5 },
        rangeStartUnitId: MOCK_UNITS[3]!.id,
        rangeEndUnitId: MOCK_UNITS[7]!.id,
      }),
    );

    expect(res.status).toBe(422);
    const body = insufficientProblemsErrorResponseSchema.parse(
      await res.json(),
    );
    expect(body.error.details.unitId).toBe(MOCK_UNITS[5]!.id);
    // 예전 동작(범위의 끝)이면 여기서 빨개진다.
    expect(body.error.details.unitId).not.toBe(MOCK_UNITS[7]!.id);
    expect(body.error.message).toBe("이 범위에 등록된 문제가 부족합니다.");
  });

  it("가용 문제가 필요 수보다 적으면 INSUFFICIENT_PROBLEMS(422, available/required 포함)를 반환한다", async () => {
    const res = await generateTest(
      jsonRequest("http://localhost/api/tests/generate", "POST", {
        classId: CLASS_STARVED_ID,
        testType: "daily",
        testDate: "2026-08-13",
      }),
    );
    expect(res.status).toBe(422);
    const body = insufficientProblemsErrorResponseSchema.parse(
      await res.json(),
    );
    expect(body.error.details.available).toBeLessThan(
      body.error.details.required,
    );
  });

  it("타 사용자 소유 반으로는 출제할 수 없다(FORBIDDEN 403)", async () => {
    const res = await generateTest(
      jsonRequest("http://localhost/api/tests/generate", "POST", {
        classId: CLASS_OTHER_ID,
        testType: "daily",
        testDate: "2026-08-13",
      }),
    );
    expect(res.status).toBe(403);
    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("내부 예외 메시지를 INTERNAL_ERROR 응답에 노출하지 않는다", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(db.progress, "findMany").mockRejectedValueOnce(
      new Error("DATABASE_URL=postgresql://user:secret@internal/db"),
    );

    const res = await generateTest(
      jsonRequest("http://localhost/api/tests/generate", "POST", {
        classId: CLASS_A_ID,
        testType: "daily",
        testDate: "2026-08-13",
      }),
    );
    expect(res.status).toBe(500);
    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.message).toBe("출제 중 오류가 발생했습니다.");
    expect(JSON.stringify(body)).not.toContain("postgresql://");
    log.mockRestore();
  });

  it("문제은행 기반 출제 응답은 3초 이내에 완료된다(성능 인수 조건)", async () => {
    const start = performance.now();
    await generateTest(
      jsonRequest("http://localhost/api/tests/generate", "POST", {
        classId: CLASS_A_ID,
        testType: "daily",
        testDate: "2026-08-13",
      }),
    );
    expect(performance.now() - start).toBeLessThan(3000);
  });
});

describe("[T4.2] GET /api/tests, GET /api/tests/{id}", () => {
  it("classId로 필터링한 테스트 목록을 반환한다", async () => {
    const res = await listTests(
      jsonRequest(`http://localhost/api/tests?classId=${CLASS_A_ID}`, "GET"),
    );
    expect(res.status).toBe(200);
    testListResponseSchema.parse(await res.json());
  });

  it("단건 조회는 문항 목록을 포함한다", async () => {
    const res = await getTest(
      jsonRequest(`http://localhost/api/tests/${TEST_DRAFT_ID}`, "GET"),
      withId(TEST_DRAFT_ID),
    );
    expect(res.status).toBe(200);
    const body = testDetailResponseSchema.parse(await res.json());
    expect(body.data.problems.length).toBeGreaterThan(0);
  });

  it("존재하지 않는 id는 NOT_FOUND(404)를 반환한다", async () => {
    const res = await getTest(
      jsonRequest(`http://localhost/api/tests/${TEST_NOT_FOUND_ID}`, "GET"),
      withId(TEST_NOT_FOUND_ID),
    );
    expect(res.status).toBe(404);
    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe("NOT_FOUND");
  });
});

describe("[T4.2] PUT /api/tests/{id}/problems/{seq} — 1클릭 교체(중복 제외 유지)", () => {
  it("교체하면 modified=true, 해당 문항 replaced=true가 된다", async () => {
    const res = await replaceTestProblem(
      jsonRequest(
        `http://localhost/api/tests/${TEST_DRAFT_ID}/problems/1`,
        "PUT",
      ),
      withIdAndSeq(TEST_DRAFT_ID, 1),
    );
    expect(res.status).toBe(200);
    const body = testProblemReplaceResponseSchema.parse(await res.json());
    expect(body.data.test.modified).toBe(true);
    expect(body.data.problem.replaced).toBe(true);
  });

  it("최근 14일 내 이미 출제된 문제는 교체 후보에서 제외된다(D-20)", async () => {
    const res = await replaceTestProblem(
      jsonRequest(
        `http://localhost/api/tests/${TEST_DRAFT_ID}/problems/2`,
        "PUT",
      ),
      withIdAndSeq(TEST_DRAFT_ID, 2),
    );
    const body = testProblemReplaceResponseSchema.parse(await res.json());
    expect(body.data.problem.problemId).toBeDefined();
    expect(body.data.problem.problemId).not.toBe(
      "50000000-0000-4000-8000-000000000111",
    );
  });

  it("confirmed/printed 테스트의 문항은 교체할 수 없다", async () => {
    for (const testId of [TEST_CONFIRMED_ID, TEST_PRINTED_ID]) {
      const res = await replaceTestProblem(
        jsonRequest(`http://localhost/api/tests/${testId}/problems/1`, "PUT"),
        withIdAndSeq(testId, 1),
      );
      expect(res.status).toBe(409);
      const body = errorResponseSchema.parse(await res.json());
      expect(body.error.code).toBe("CONFLICT");
    }
  });
});

describe("[T4.2] POST /api/tests/{id}/confirm — 확정(draft → confirmed)", () => {
  it("draft 테스트를 confirmed로 전환한다", async () => {
    const res = await confirmTest(
      jsonRequest(
        `http://localhost/api/tests/${TEST_DRAFT_ID}/confirm`,
        "POST",
      ),
      withId(TEST_DRAFT_ID),
    );
    expect(res.status).toBe(200);
    const body = testConfirmResponseSchema.parse(await res.json());
    expect(body.data.status).toBe("confirmed");
  });

  it("존재하지 않는 테스트는 NOT_FOUND(404)를 반환한다", async () => {
    const res = await confirmTest(
      jsonRequest(
        `http://localhost/api/tests/${TEST_NOT_FOUND_ID}/confirm`,
        "POST",
      ),
      withId(TEST_NOT_FOUND_ID),
    );
    expect(res.status).toBe(404);
    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("confirmed/printed 테스트를 다시 confirmed로 되돌릴 수 없다", async () => {
    for (const testId of [TEST_CONFIRMED_ID, TEST_PRINTED_ID]) {
      const res = await confirmTest(
        jsonRequest(`http://localhost/api/tests/${testId}/confirm`, "POST"),
        withId(testId),
      );
      expect(res.status).toBe(409);
      const body = errorResponseSchema.parse(await res.json());
      expect(body.error.code).toBe("CONFLICT");
    }
  });

  it("상태 확인 뒤 동시 변경으로 조건부 확정에 실패하면 덮어쓰지 않는다", async () => {
    vi.spyOn(db.test, "updateMany").mockResolvedValueOnce({ count: 0 });

    const res = await confirmTest(
      jsonRequest(
        `http://localhost/api/tests/${TEST_DRAFT_ID}/confirm`,
        "POST",
      ),
      withId(TEST_DRAFT_ID),
    );
    expect(res.status).toBe(409);
    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe("CONFLICT");
  });
});
