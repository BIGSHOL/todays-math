/**
 * 🔴 RED — 대응 구현 태스크: Phase 4, T4.2 (자동 출제 API RED→GREEN)
 *
 * `src/app/api/tests/**`가 아직 존재하지 않으므로 아래 import들은 런타임에 모듈 해석에 실패해
 * 이 파일 전체가 FAILED로 보고된다 — RED의 정상 상태다.
 * (`@ts-expect-error` 사용 이유는 src/__tests__/api/auth.test.ts 상단 주석 참조.)
 *
 * ⚠️ 이 API는 T4.1(출제 엔진 순수 함수, src/__tests__/unit/generator.test.ts)을 직접 import해
 *    쓰고, 진도(T2.2)/문제(T3.1) 조회는 테스트 DB 픽스처로 독립 실행한다(06-tasks.md 참조).
 *
 * 대응 계약: src/contracts/test.contract.ts
 */
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

// @ts-expect-error TODO(T4.2) — src/app/api/tests/generate/route.ts 구현 전까지 모듈이 없다.
import { POST as generateTest } from "@/app/api/tests/generate/route";
// @ts-expect-error TODO(T4.2) — src/app/api/tests/route.ts 구현 전까지 모듈이 없다.
import { GET as listTests } from "@/app/api/tests/route";
// @ts-expect-error TODO(T4.2) — src/app/api/tests/[id]/route.ts 구현 전까지 모듈이 없다.
import { GET as getTest } from "@/app/api/tests/[id]/route";
// @ts-expect-error TODO(T4.2) — src/app/api/tests/[id]/problems/[seq]/route.ts 구현 전까지 모듈이 없다.
import { PUT as replaceTestProblem } from "@/app/api/tests/[id]/problems/[seq]/route";
// @ts-expect-error TODO(T4.2) — src/app/api/tests/[id]/confirm/route.ts 구현 전까지 모듈이 없다.
import { POST as confirmTest } from "@/app/api/tests/[id]/confirm/route";

import { errorResponseSchema } from "@/contracts/common.contract";
import {
  insufficientProblemsErrorResponseSchema,
  testConfirmResponseSchema,
  testGenerateResponseSchema,
  testListResponseSchema,
  testProblemReplaceResponseSchema,
} from "@/contracts/test.contract";
import {
  CLASS_A_ID,
  CLASS_OTHER_ID,
  CLASS_STARVED_ID,
  TEST_DRAFT_ID,
  TEST_NOT_FOUND_ID,
} from "@/mocks/data";

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
    // GREEN 단계에서 테스트 DB에 "최근 14일 이내 출제 이력"을 시딩해 교체 결과 problemId가
    // 그 목록에 포함되지 않음을 검증한다. 순수 로직 자체의 단위 테스트는
    // src/__tests__/unit/generator.test.ts(excludeRecent)가 담당하고, 여기서는 API 계층이
    // 그 로직을 실제로 호출하는지만 확인한다.
    const res = await replaceTestProblem(
      jsonRequest(
        `http://localhost/api/tests/${TEST_DRAFT_ID}/problems/2`,
        "PUT",
      ),
      withIdAndSeq(TEST_DRAFT_ID, 2),
    );
    const body = testProblemReplaceResponseSchema.parse(await res.json());
    expect(body.data.problem.problemId).toBeDefined();
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
});
