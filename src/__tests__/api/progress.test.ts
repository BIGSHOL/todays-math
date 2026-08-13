/**
 * 🟢 GREEN — 대응 구현 태스크: Phase 2, T2.2 (진도 기록/조회 API RED→GREEN)
 *
 * 구현: src/app/api/progress/route.ts, src/app/api/progress/advance/route.ts,
 *       src/lib/progressResolver.ts (반/개별 이중 구조 해석 순수 함수)
 * (RED 단계의 `@ts-expect-error` 임시 주석은 구현 완료로 제거됨 — 이유는
 * src/__tests__/api/auth.test.ts 상단 주석 참조.)
 *
 * 대응 계약: src/contracts/class.contract.ts (§진도)
 * ⚠️ PROGRESS는 이력 누적(append-only) 엔티티다 — 수정/삭제 엔드포인트가 없다(계약 주석 참조).
 *
 * ⚠️ RED 단계 원본에는 세션 모킹이 누락되어 있었다(버그) — class/student CRUD(T2.1)와 동일하게
 * 소유권 검증(반/학생 owner=USER_TEACHER_ID)이 필요하므로 src/__tests__/api/class.test.ts 상단의
 * vi.mock("@/lib/session") 패턴을 그대로 가져와 추가했다(테스트 기대값/시나리오는 변경하지 않음).
 */
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

// T1.1(실제 Auth.js 세션) 병합 이후 패턴 — src/__tests__/api/class.test.ts 상단 주석 참조.
vi.mock("@/lib/session", () => ({
  getSessionUser: vi.fn(async () => ({
    id: "10000000-0000-4000-8000-000000000001",
    email: "teacher@todaysmath.test",
    name: "테스트 강사",
  })),
}));

// ⚠️ named import를 문장별로 분리한 이유는 src/__tests__/api/class.test.ts 상단 주석 참조
//    (Prettier 줄바꿈으로 인한 @ts-expect-error 위치 어긋남 방지).
import { POST as createClass } from "@/app/api/classes/route";
import { GET as getProgress } from "@/app/api/progress/route";
import { POST as recordProgress } from "@/app/api/progress/route";
import { POST as advanceProgress } from "@/app/api/progress/advance/route";

import {
  classResponseSchema,
  progressResponseSchema,
} from "@/contracts/class.contract";
import { errorResponseSchema } from "@/contracts/common.contract";
import {
  CLASS_A_ID,
  CLASS_OTHER_ID,
  CLASS_STARVED_ID,
  MOCK_CURRENT_PROGRESS_UNIT,
  MOCK_UNITS,
  NOT_FOUND_ID,
  STUDENT_IDS,
} from "@/mocks/data";

function jsonRequest(url: string, method: string, body?: unknown) {
  return new NextRequest(url, {
    method,
    headers:
      body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const STUDENT_1_ID = STUDENT_IDS[0]!;
const STUDENT_3_ID = STUDENT_IDS[2]!;
const STUDENT_4_ID = STUDENT_IDS[3]!;

describe("[T2.2] POST /api/progress — 이력 누적(append-only)", () => {
  it("반 전체 진도를 기록하면 201과 함께 새 진도 행을 반환한다", async () => {
    const res = await recordProgress(
      jsonRequest("http://localhost/api/progress", "POST", {
        classId: CLASS_A_ID,
        unitId: MOCK_UNITS[4]!.id,
      }),
    );
    expect(res.status).toBe(201);
    const body = progressResponseSchema.parse(await res.json());
    expect(body.data.studentId).toBeNull();
  });

  it("studentId를 지정하면 해당 학생의 개별 진도로 기록된다", async () => {
    const res = await recordProgress(
      jsonRequest("http://localhost/api/progress", "POST", {
        classId: CLASS_A_ID,
        studentId: STUDENT_3_ID,
        unitId: MOCK_UNITS[6]!.id,
      }),
    );
    expect(res.status).toBe(201);
    const body = progressResponseSchema.parse(await res.json());
    expect(body.data.studentId).toBe(STUDENT_3_ID);
  });

  it("필수 필드(classId/unitId) 누락 시 VALIDATION_ERROR(400)를 반환한다", async () => {
    const res = await recordProgress(
      jsonRequest("http://localhost/api/progress", "POST", {
        classId: CLASS_A_ID,
      }),
    );
    expect(res.status).toBe(400);
    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("타 사용자 소유 반에는 진도를 기록할 수 없다(FORBIDDEN 403)", async () => {
    const res = await recordProgress(
      jsonRequest("http://localhost/api/progress", "POST", {
        classId: CLASS_OTHER_ID,
        unitId: MOCK_UNITS[0]!.id,
      }),
    );
    expect(res.status).toBe(403);
    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("같은 반에 여러 번 기록해도 이전 진도 기록은 삭제되지 않고 이력으로 남는다", async () => {
    // 이 검증은 GREEN 단계에서 테스트 DB의 진도 이력 테이블 row 수 증가로 확인한다
    // (append-only 원칙 — PROGRESS는 PATCH/DELETE 엔드포인트를 갖지 않는다).
    const before = await recordProgress(
      jsonRequest("http://localhost/api/progress", "POST", {
        classId: CLASS_A_ID,
        unitId: MOCK_UNITS[0]!.id,
      }),
    );
    const after = await recordProgress(
      jsonRequest("http://localhost/api/progress", "POST", {
        classId: CLASS_A_ID,
        unitId: MOCK_UNITS[1]!.id,
      }),
    );
    const beforeBody = progressResponseSchema.parse(await before.json());
    const afterBody = progressResponseSchema.parse(await after.json());
    expect(beforeBody.data.id).not.toBe(afterBody.data.id);
  });

  it("존재하지 않는 소단원이면 NOT_FOUND(404)를 반환한다", async () => {
    const res = await recordProgress(
      jsonRequest("http://localhost/api/progress", "POST", {
        classId: CLASS_A_ID,
        unitId: NOT_FOUND_ID,
      }),
    );
    expect(res.status).toBe(404);
    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("다른 반 소속 학생에게는 진도를 기록할 수 없다(NOT_FOUND 404)", async () => {
    const res = await recordProgress(
      jsonRequest("http://localhost/api/progress", "POST", {
        classId: CLASS_A_ID,
        studentId: STUDENT_4_ID,
        unitId: MOCK_UNITS[0]!.id,
      }),
    );
    expect(res.status).toBe(404);
    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe("NOT_FOUND");
  });
});

describe("[T2.2] GET /api/progress — 현재 진도 조회(개별 우선 적용)", () => {
  it("classId만 지정하면 반 전체의 최신 진도를 반환한다", async () => {
    const res = await getProgress(
      jsonRequest(`http://localhost/api/progress?classId=${CLASS_A_ID}`, "GET"),
    );
    expect(res.status).toBe(200);
    const body = progressResponseSchema.parse(await res.json());
    expect(body.data.studentId).toBeNull();
  });

  it("useIndividualProgress=true인 학생은 반 진도가 아닌 개별 진도가 우선 적용된다", async () => {
    const res = await getProgress(
      jsonRequest(
        `http://localhost/api/progress?classId=${CLASS_A_ID}&studentId=${STUDENT_3_ID}`,
        "GET",
      ),
    );
    expect(res.status).toBe(200);
    const body = progressResponseSchema.parse(await res.json());
    expect(body.data.studentId).toBe(STUDENT_3_ID);
  });

  it("useIndividualProgress=false인 학생은 반 전체 진도를 반환한다", async () => {
    const res = await getProgress(
      jsonRequest(
        `http://localhost/api/progress?classId=${CLASS_A_ID}&studentId=${STUDENT_1_ID}`,
        "GET",
      ),
    );
    expect(res.status).toBe(200);
    const body = progressResponseSchema.parse(await res.json());
    expect(body.data.studentId).toBeNull();
    expect(body.data.unitId).toBe(MOCK_CURRENT_PROGRESS_UNIT.id);
  });

  it("다른 반 소속 학생을 조회하면 NOT_FOUND(404)를 반환한다", async () => {
    const res = await getProgress(
      jsonRequest(
        `http://localhost/api/progress?classId=${CLASS_A_ID}&studentId=${STUDENT_4_ID}`,
        "GET",
      ),
    );
    expect(res.status).toBe(404);
    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("진도 이력이 없는 반을 조회하면 NOT_FOUND(404)를 반환한다", async () => {
    const created = await createClass(
      jsonRequest("http://localhost/api/classes", "POST", {
        name: "진도없는반",
        grade: "중2",
      }),
    );
    const createdBody = classResponseSchema.parse(await created.json());
    const res = await getProgress(
      jsonRequest(
        `http://localhost/api/progress?classId=${createdBody.data.id}`,
        "GET",
      ),
    );
    expect(res.status).toBe(404);
    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("classId 없이 조회하면 VALIDATION_ERROR(400)를 반환한다", async () => {
    const res = await getProgress(
      jsonRequest("http://localhost/api/progress", "GET"),
    );
    expect(res.status).toBe(400);
    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("[T2.2] POST /api/progress/advance — 다음 소단원 1클릭 진행(D-19, order_index 기준)", () => {
  it("현재 진도 소단원의 orderIndex+1에 해당하는 다음 소단원으로 진행한다", async () => {
    const res = await advanceProgress(
      jsonRequest("http://localhost/api/progress/advance", "POST", {
        classId: CLASS_A_ID,
      }),
    );
    expect(res.status).toBe(201);
    const body = progressResponseSchema.parse(await res.json());
    const nextUnit = MOCK_UNITS.find(
      (u) => u.orderIndex === MOCK_CURRENT_PROGRESS_UNIT.orderIndex + 1,
    );
    expect(body.data.unitId).toBe(nextUnit?.id);
  });

  it("개별 진도 학생은 자기 소단원 기준으로 다음 차시에 기록된다", async () => {
    const res = await advanceProgress(
      jsonRequest("http://localhost/api/progress/advance", "POST", {
        classId: CLASS_A_ID,
        studentId: STUDENT_3_ID,
      }),
    );
    expect(res.status).toBe(201);
    const body = progressResponseSchema.parse(await res.json());
    const studentCurrent = MOCK_UNITS[5]!;
    const nextUnit = MOCK_UNITS.find(
      (u) => u.orderIndex === studentCurrent.orderIndex + 1,
    );
    expect(body.data.studentId).toBe(STUDENT_3_ID);
    expect(body.data.unitId).toBe(nextUnit?.id);
  });

  it("마지막 소단원이면 NOT_FOUND(404)를 반환한다", async () => {
    const res = await advanceProgress(
      jsonRequest("http://localhost/api/progress/advance", "POST", {
        classId: CLASS_STARVED_ID,
      }),
    );
    expect(res.status).toBe(404);
    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("다른 반 소속 학생으로 진행하면 NOT_FOUND(404)를 반환한다", async () => {
    const res = await advanceProgress(
      jsonRequest("http://localhost/api/progress/advance", "POST", {
        classId: CLASS_A_ID,
        studentId: STUDENT_4_ID,
      }),
    );
    expect(res.status).toBe(404);
    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe("NOT_FOUND");
  });
});
