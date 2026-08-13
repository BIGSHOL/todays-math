/**
 * MSW 핸들러 — 반/학생/진도 (T0.5.2).
 * 대응 계약: src/contracts/class.contract.ts
 * 대응 API 경로:
 *   POST/GET /api/classes, GET/PATCH/DELETE /api/classes/{id}
 *   POST/GET /api/students, PATCH/DELETE /api/students/{id}
 *   POST/GET /api/progress, POST /api/progress/advance
 *
 * ⚠️ 아래 핸들러는 상태를 갖지 않는다(stateless) — POST/PATCH/DELETE도 src/mocks/data의
 *    고정 픽스처 배열을 직접 변형(mutate)하지 않고, "요청이 반영되었다면 이런 모양"을 매번
 *    새로 계산해 반환한다. 테스트 실행 순서에 따라 Mock 데이터가 누적/오염되는 것을 막기 위함.
 */
import { http, type HttpHandler } from "msw";

import {
  classCreateRequestSchema,
  classListResponseSchema,
  classResponseSchema,
  classUpdateRequestSchema,
  progressAdvanceRequestSchema,
  progressQuerySchema,
  progressRecordRequestSchema,
  progressResponseSchema,
  studentCreateRequestSchema,
  studentListQuerySchema,
  studentListResponseSchema,
  studentResponseSchema,
  studentUpdateRequestSchema,
} from "@/contracts/class.contract";
import {
  deleteResponseSchema,
  paginationParamsSchema,
} from "@/contracts/common.contract";
import { getCurrentProgress, nextOrderIndex } from "@/lib/progressResolver";

import {
  CLASS_OTHER_ID,
  MOCK_CLASS_OTHER_USER,
  MOCK_CLASSES,
  MOCK_PROGRESS,
  MOCK_STUDENTS,
  MOCK_UNITS,
  USER_TEACHER_ID,
} from "../data";
import {
  forbiddenError,
  jsonOk,
  notFoundError,
  paginate,
  validationError,
} from "./_helpers";

function findClass(id: string) {
  if (id === CLASS_OTHER_ID)
    return { entity: MOCK_CLASS_OTHER_USER, owned: false };
  const entity = MOCK_CLASSES.find((c) => c.id === id);
  return entity ? { entity, owned: true } : { entity: undefined, owned: false };
}

export const classHandlers: HttpHandler[] = [
  // POST /api/classes — 반 생성
  http.post("/api/classes", async ({ request }) => {
    const parsed = classCreateRequestSchema.safeParse(await request.json());
    if (!parsed.success) return validationError(parsed.error);

    return jsonOk(
      classResponseSchema,
      {
        data: {
          id: crypto.randomUUID(),
          userId: USER_TEACHER_ID,
          ...parsed.data,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      },
      { status: 201 },
    );
  }),

  // GET /api/classes — 본인 소유 반 목록(페이지네이션)
  http.get("/api/classes", ({ request }) => {
    const url = new URL(request.url);
    const params = paginationParamsSchema.parse(
      Object.fromEntries(url.searchParams),
    );
    return jsonOk(classListResponseSchema, paginate(MOCK_CLASSES, params));
  }),

  // GET /api/classes/:id — 단건 조회
  http.get("/api/classes/:id", ({ params }) => {
    const { entity, owned } = findClass(String(params.id));
    if (entity && !owned) return forbiddenError();
    if (!entity) return notFoundError("반");
    return jsonOk(classResponseSchema, { data: entity });
  }),

  // PATCH /api/classes/:id — 반 수정
  http.patch("/api/classes/:id", async ({ params, request }) => {
    const { entity, owned } = findClass(String(params.id));
    if (entity && !owned) return forbiddenError();
    if (!entity) return notFoundError("반");

    const parsed = classUpdateRequestSchema.safeParse(await request.json());
    if (!parsed.success) return validationError(parsed.error);

    return jsonOk(classResponseSchema, {
      data: {
        ...entity,
        ...parsed.data,
        updatedAt: new Date().toISOString(),
      },
    });
  }),

  // DELETE /api/classes/:id — 반 삭제
  http.delete("/api/classes/:id", ({ params }) => {
    const { entity, owned } = findClass(String(params.id));
    if (entity && !owned) return forbiddenError();
    if (!entity) return notFoundError("반");
    return jsonOk(deleteResponseSchema, { data: { id: entity.id } });
  }),

  // POST /api/students — 학생 등록(이름만 — 최소 수집)
  http.post("/api/students", async ({ request }) => {
    const parsed = studentCreateRequestSchema.safeParse(await request.json());
    if (!parsed.success) return validationError(parsed.error);

    const { entity, owned } = findClass(parsed.data.classId);
    if (entity && !owned) return forbiddenError();
    if (!entity) return notFoundError("반");

    return jsonOk(
      studentResponseSchema,
      {
        data: {
          id: crypto.randomUUID(),
          classId: parsed.data.classId,
          name: parsed.data.name,
          useIndividualProgress: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      },
      { status: 201 },
    );
  }),

  // GET /api/students?classId=... — 학생 목록 조회(classId 필수)
  http.get("/api/students", ({ request }) => {
    const url = new URL(request.url);
    const parsed = studentListQuerySchema.safeParse(
      Object.fromEntries(url.searchParams),
    );
    if (!parsed.success) return validationError(parsed.error);

    const { entity, owned } = findClass(parsed.data.classId);
    if (entity && !owned) return forbiddenError();

    const students = MOCK_STUDENTS.filter(
      (s) => s.classId === parsed.data.classId,
    );
    return jsonOk(studentListResponseSchema, paginate(students, parsed.data));
  }),

  // PATCH /api/students/:id — 학생 수정(이름/개별 진도 사용 여부)
  http.patch("/api/students/:id", async ({ params, request }) => {
    const entity = MOCK_STUDENTS.find((s) => s.id === params.id);
    if (!entity) return notFoundError("학생");

    const parsed = studentUpdateRequestSchema.safeParse(await request.json());
    if (!parsed.success) return validationError(parsed.error);

    return jsonOk(studentResponseSchema, {
      data: { ...entity, ...parsed.data, updatedAt: new Date().toISOString() },
    });
  }),

  // DELETE /api/students/:id — 학생 삭제
  http.delete("/api/students/:id", ({ params }) => {
    const entity = MOCK_STUDENTS.find((s) => s.id === params.id);
    if (!entity) return notFoundError("학생");
    return jsonOk(deleteResponseSchema, { data: { id: entity.id } });
  }),

  // POST /api/progress — 진도 기록(반 전체 또는 개별 학생)
  http.post("/api/progress", async ({ request }) => {
    const parsed = progressRecordRequestSchema.safeParse(await request.json());
    if (!parsed.success) return validationError(parsed.error);

    const { entity, owned } = findClass(parsed.data.classId);
    if (entity && !owned) return forbiddenError();
    if (!entity) return notFoundError("반");

    if (parsed.data.studentId) {
      const student = MOCK_STUDENTS.find((s) => s.id === parsed.data.studentId);
      if (!student || student.classId !== parsed.data.classId) {
        return notFoundError("학생");
      }
    }

    const unit = MOCK_UNITS.find((u) => u.id === parsed.data.unitId);
    if (!unit) return notFoundError("소단원");

    return jsonOk(
      progressResponseSchema,
      {
        data: {
          id: crypto.randomUUID(),
          classId: parsed.data.classId,
          studentId: parsed.data.studentId ?? null,
          unitId: parsed.data.unitId,
          recordedAt:
            parsed.data.recordedAt ?? new Date().toISOString().slice(0, 10),
          createdAt: new Date().toISOString(),
        },
      },
      { status: 201 },
    );
  }),

  // GET /api/progress?classId=&studentId= — 현재 진도 조회(개별 우선)
  http.get("/api/progress", ({ request }) => {
    const url = new URL(request.url);
    const parsed = progressQuerySchema.safeParse(
      Object.fromEntries(url.searchParams),
    );
    if (!parsed.success) return validationError(parsed.error);

    const { entity, owned } = findClass(parsed.data.classId);
    if (entity && !owned) return forbiddenError();

    let useIndividualProgress = false;
    if (parsed.data.studentId) {
      const student = MOCK_STUDENTS.find((s) => s.id === parsed.data.studentId);
      if (!student || student.classId !== parsed.data.classId) {
        return notFoundError("학생");
      }
      useIndividualProgress = student.useIndividualProgress;
    }

    const current = getCurrentProgress({
      classProgress: MOCK_PROGRESS.filter(
        (p) => p.classId === parsed.data.classId && p.studentId === null,
      ),
      studentProgress: parsed.data.studentId
        ? MOCK_PROGRESS.filter(
            (p) =>
              p.classId === parsed.data.classId &&
              p.studentId === parsed.data.studentId,
          )
        : [],
      useIndividualProgress,
    });
    if (!current) return notFoundError("진도 기록");
    return jsonOk(progressResponseSchema, { data: current });
  }),

  // POST /api/progress/advance — "다음 소단원 1클릭 진행"(order_index 기준, D-19)
  http.post("/api/progress/advance", async ({ request }) => {
    const parsed = progressAdvanceRequestSchema.safeParse(await request.json());
    if (!parsed.success) return validationError(parsed.error);

    const { entity, owned } = findClass(parsed.data.classId);
    if (entity && !owned) return forbiddenError();
    if (!entity) return notFoundError("반");

    let useIndividualProgress = false;
    if (parsed.data.studentId) {
      const student = MOCK_STUDENTS.find((s) => s.id === parsed.data.studentId);
      if (!student || student.classId !== parsed.data.classId) {
        return notFoundError("학생");
      }
      useIndividualProgress = student.useIndividualProgress;
    }

    const current = getCurrentProgress({
      classProgress: MOCK_PROGRESS.filter(
        (p) => p.classId === parsed.data.classId && p.studentId === null,
      ),
      studentProgress: parsed.data.studentId
        ? MOCK_PROGRESS.filter(
            (p) =>
              p.classId === parsed.data.classId &&
              p.studentId === parsed.data.studentId,
          )
        : [],
      useIndividualProgress,
    });
    if (!current) return notFoundError("진도 기록");

    const currentUnit = MOCK_UNITS.find((u) => u.id === current.unitId);
    const nextUnit = MOCK_UNITS.find(
      (u) => u.orderIndex === nextOrderIndex(currentUnit?.orderIndex ?? -1),
    );
    if (!nextUnit) return notFoundError("다음 소단원");

    return jsonOk(
      progressResponseSchema,
      {
        data: {
          id: crypto.randomUUID(),
          classId: parsed.data.classId,
          studentId: parsed.data.studentId ?? null,
          unitId: nextUnit.id,
          recordedAt: new Date().toISOString().slice(0, 10),
          createdAt: new Date().toISOString(),
        },
      },
      { status: 201 },
    );
  }),
];
