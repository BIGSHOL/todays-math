/**
 * 🔴 RED — 대응 구현 태스크: Phase 2, T2.1 (반/학생 CRUD API RED→GREEN)
 *
 * `src/app/api/classes/**`, `src/app/api/students/**`가 아직 존재하지 않으므로 아래 import들은
 * 런타임에 모듈 해석에 실패해 이 파일 전체가 FAILED로 보고된다 — RED의 정상 상태다.
 * (`@ts-expect-error` 사용 이유는 src/__tests__/api/auth.test.ts 상단 주석 참조.)
 *
 * 대응 계약: src/contracts/class.contract.ts
 */
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

// ⚠️ 아래 import는 각 named import마다 별도 문장으로 분리했다 — 여러 named import를 한
//    문장(중괄호 여러 줄)으로 묶으면 Prettier가 줄바꿈하는 위치에 따라 "Cannot find module"
//    진단이 찍히는 물리적 줄이 `@ts-expect-error` 바로 다음 줄과 어긋날 수 있기 때문이다.
// @ts-expect-error TODO(T2.1) — src/app/api/classes/route.ts 구현 전까지 모듈이 없다.
import { GET as listClasses } from "@/app/api/classes/route";
// @ts-expect-error TODO(T2.1) — src/app/api/classes/route.ts 구현 전까지 모듈이 없다.
import { POST as createClass } from "@/app/api/classes/route";
// @ts-expect-error TODO(T2.1) — src/app/api/classes/[id]/route.ts 구현 전까지 모듈이 없다.
import { GET as getClass } from "@/app/api/classes/[id]/route";
// @ts-expect-error TODO(T2.1) — src/app/api/classes/[id]/route.ts 구현 전까지 모듈이 없다.
import { PATCH as patchClass } from "@/app/api/classes/[id]/route";
// @ts-expect-error TODO(T2.1) — src/app/api/classes/[id]/route.ts 구현 전까지 모듈이 없다.
import { DELETE as deleteClass } from "@/app/api/classes/[id]/route";
// @ts-expect-error TODO(T2.1) — src/app/api/students/route.ts 구현 전까지 모듈이 없다.
import { GET as listStudents } from "@/app/api/students/route";
// @ts-expect-error TODO(T2.1) — src/app/api/students/route.ts 구현 전까지 모듈이 없다.
import { POST as createStudent } from "@/app/api/students/route";
// @ts-expect-error TODO(T2.1) — src/app/api/students/[id]/route.ts 구현 전까지 모듈이 없다.
import { PATCH as patchStudent } from "@/app/api/students/[id]/route";
// @ts-expect-error TODO(T2.1) — src/app/api/students/[id]/route.ts 구현 전까지 모듈이 없다.
import { DELETE as deleteStudent } from "@/app/api/students/[id]/route";

import {
  classListResponseSchema,
  classResponseSchema,
  studentResponseSchema,
} from "@/contracts/class.contract";
import { errorResponseSchema } from "@/contracts/common.contract";
import {
  CLASS_A_ID,
  CLASS_OTHER_ID,
  MOCK_STUDENT_1,
  NOT_FOUND_ID,
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

describe("[T2.1] POST /api/classes", () => {
  it("유효한 요청으로 반을 생성하면 201과 함께 반 정보를 반환한다", async () => {
    const res = await createClass(
      jsonRequest("http://localhost/api/classes", "POST", {
        name: "중2 심화반",
        grade: "중2",
      }),
    );
    expect(res.status).toBe(201);
    classResponseSchema.parse(await res.json());
  });

  it("반 이름이 없으면 VALIDATION_ERROR(400)를 반환한다", async () => {
    const res = await createClass(
      jsonRequest("http://localhost/api/classes", "POST", {
        name: "",
        grade: "중2",
      }),
    );
    expect(res.status).toBe(400);
    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("[T2.1] GET /api/classes", () => {
  it("본인 소유 반만 페이지네이션하여 반환한다(타 사용자 반 제외)", async () => {
    const res = await listClasses(
      jsonRequest("http://localhost/api/classes", "GET"),
    );
    expect(res.status).toBe(200);
    const body = classListResponseSchema.parse(await res.json());
    expect(body.data.every((c) => c.id !== CLASS_OTHER_ID)).toBe(true);
  });
});

describe("[T2.1] GET /api/classes/{id} — 소유권 검증", () => {
  it("존재하지 않는 id는 NOT_FOUND(404)를 반환한다", async () => {
    const res = await getClass(
      jsonRequest(`http://localhost/api/classes/${NOT_FOUND_ID}`, "GET"),
      withId(NOT_FOUND_ID),
    );
    expect(res.status).toBe(404);
    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("타 사용자 소유 반에 접근하면 FORBIDDEN(403)을 반환한다", async () => {
    const res = await getClass(
      jsonRequest(`http://localhost/api/classes/${CLASS_OTHER_ID}`, "GET"),
      withId(CLASS_OTHER_ID),
    );
    expect(res.status).toBe(403);
    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe("FORBIDDEN");
  });
});

describe("[T2.1] PATCH /api/classes/{id}", () => {
  it("빈 본문(수정할 값 없음)은 VALIDATION_ERROR(400)를 반환한다", async () => {
    const res = await patchClass(
      jsonRequest(`http://localhost/api/classes/${CLASS_A_ID}`, "PATCH", {}),
      withId(CLASS_A_ID),
    );
    expect(res.status).toBe(400);
    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("[T2.1] DELETE /api/classes/{id}", () => {
  it("성공 시 삭제된 반의 id를 반환한다", async () => {
    const res = await deleteClass(
      jsonRequest(`http://localhost/api/classes/${CLASS_A_ID}`, "DELETE"),
      withId(CLASS_A_ID),
    );
    expect(res.status).toBe(200);
  });
});

describe("[T2.1] POST /api/students — 최소 수집 원칙(이름만)", () => {
  it("classId와 이름만으로 학생을 등록한다", async () => {
    const res = await createStudent(
      jsonRequest("http://localhost/api/students", "POST", {
        classId: CLASS_A_ID,
        name: "홍길동",
      }),
    );
    expect(res.status).toBe(201);
    studentResponseSchema.parse(await res.json());
  });

  it("타 사용자 소유 반에는 학생을 등록할 수 없다(FORBIDDEN 403)", async () => {
    const res = await createStudent(
      jsonRequest("http://localhost/api/students", "POST", {
        classId: CLASS_OTHER_ID,
        name: "홍길동",
      }),
    );
    expect(res.status).toBe(403);
    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe("FORBIDDEN");
  });
});

describe("[T2.1] GET /api/students", () => {
  it("classId 쿼리 없이 조회하면 VALIDATION_ERROR(400)를 반환한다", async () => {
    const res = await listStudents(
      jsonRequest("http://localhost/api/students", "GET"),
    );
    expect(res.status).toBe(400);
    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("[T2.1] PATCH/DELETE /api/students/{id}", () => {
  it("PATCH — 빈 본문은 VALIDATION_ERROR(400)를 반환한다", async () => {
    const res = await patchStudent(
      jsonRequest(
        `http://localhost/api/students/${MOCK_STUDENT_1.id}`,
        "PATCH",
        {},
      ),
      withId(MOCK_STUDENT_1.id),
    );
    expect(res.status).toBe(400);
    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("DELETE — 존재하지 않는 id는 NOT_FOUND(404)를 반환한다", async () => {
    const res = await deleteStudent(
      jsonRequest(`http://localhost/api/students/${NOT_FOUND_ID}`, "DELETE"),
      withId(NOT_FOUND_ID),
    );
    expect(res.status).toBe(404);
    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe("NOT_FOUND");
  });
});
