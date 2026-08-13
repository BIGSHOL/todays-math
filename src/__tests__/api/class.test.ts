/**
 * 🟢 GREEN — 대응 구현 태스크: Phase 2, T2.1 (반/학생 CRUD API RED→GREEN)
 *
 * 구현: src/app/api/classes/**, src/app/api/students/**
 * (RED 단계의 `@ts-expect-error` 임시 주석은 구현 완료로 제거됨 — 이유는
 * src/__tests__/api/auth.test.ts 상단 주석 참조.)
 *
 * 대응 계약: src/contracts/class.contract.ts
 */
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

// T1.1(실제 Auth.js 세션) 병합 이후: 이 테스트는 인증 자체가 아니라 CRUD·소유권 검증이
// 목적이므로 세션을 고정 강사(USER_TEACHER_ID)로 모킹한다. (T2.1 당시에는 session.ts가
// 동일 UUID를 반환하는 임시 스텁이었음 — 병합 시 실제 구현으로 교체되며 이 모킹으로 대체)
vi.mock("@/lib/session", () => ({
  getSessionUser: vi.fn(async () => ({
    id: "10000000-0000-4000-8000-000000000001",
    email: "teacher@todaysmath.test",
    name: "테스트 강사",
  })),
}));

import { GET as listClasses } from "@/app/api/classes/route";
import { POST as createClass } from "@/app/api/classes/route";
import { GET as getClass } from "@/app/api/classes/[id]/route";
import { PATCH as patchClass } from "@/app/api/classes/[id]/route";
import { DELETE as deleteClass } from "@/app/api/classes/[id]/route";
import { GET as listStudents } from "@/app/api/students/route";
import { POST as createStudent } from "@/app/api/students/route";
import { PATCH as patchStudent } from "@/app/api/students/[id]/route";
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
